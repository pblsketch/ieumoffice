// The Text box tool (spec 3.7, PC "insert text" and "edit text"): a tap on empty page
// area opens a new text box (PC textInserts), a tap on document text opens its block
// (PC text-block.ts) for editing in place (PC textEdits). Pending inserts and edits
// preview on the page the PC way and can be reopened; inserts also move and delete.
// Nothing here writes outside `services.dispatch`, and nothing changes unless the
// document is in edit mode with this tool on.
import './text.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { viewToPdf } from '../../../../../../../pdf/src/renderer/annotations'
import {
  isBlockEditOf,
  patchPendingEdits,
  planAiTextEdit,
  visibleInk,
  type LocalTextEdit,
} from '../../../../../../../pdf/src/renderer/text-edit-preview'
import type { TextBlock } from '../../../../../../../pdf/src/renderer/text-block'
import { joinBlockLines, spliceBlockText } from '../../../../../../../pdf/src/renderer/text-wrap'
import type { TextEditInput } from '../../../../../../../pdf/src/shared/ipc'
import { useBackLayer } from '../../../../shell/backStack'
import type { Op, PdfFeatureChrome, PdfFeatureContext, PdfFeaturePage } from '../../edit/types'
import { createPageText, type PageText } from './pageText'
import { TextPageLayer } from './TextPageLayer'
import { TextStyleBar } from './TextStyleBar'
import {
  blockAt,
  charList,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT,
  DEFAULT_TEXT_SIZE,
  draftFromPendingEdit,
  draftFromPendingInsert,
  editDraftFor,
  editDraftIsOriginal,
  editDraftUnchanged,
  editInputOf,
  fontIdsIn,
  insertDraftAt,
  insertInputOf,
  insertStyleOf,
  lineDraftFor,
  pageHasText,
  predictEditFont,
  stepTextSize,
  textEditListOps,
  uncoverableChars,
  type EditDraft,
  type InsertDraft,
  type TextDraft,
  type TextFontId,
} from './textModel'

/** Finger tolerance around text blocks, CSS px. */
const BLOCK_SLOP_PX = 8

type InsertStyle = Pick<InsertDraft, 'fontSize' | 'color' | 'font' | 'bold'>

export function useTextFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { editing, toolActive, services, model, edits, t } = ctx
  const active = editing && toolActive
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const activeRef = useRef(active)
  activeRef.current = active

  const [draft, setDraftState] = useState<TextDraft | null>(null)
  const draftRef = useRef<TextDraft | null>(null)
  /** Bumped by every change the person makes to the open box (not by background probes):
      a commit that awaited the engine applies only if nothing was typed meanwhile. */
  const userRevRef = useRef(0)
  const setDraft = useCallback((next: TextDraft | null) => {
    draftRef.current = next
    setDraftState(next)
  }, [])
  const setUserDraft = useCallback(
    (next: TextDraft | null) => {
      userRevRef.current += 1
      setDraft(next)
    },
    [setDraft],
  )
  const cancelDraft = useCallback(() => setUserDraft(null), [setUserDraft])
  useBackLayer(active && draft !== null, cancelDraft)
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (b: boolean) => {
    busyRef.current = b
    setBusyState(b)
  }
  /** The style new text boxes start with (the last one confirmed, this session). */
  const insertStyleRef = useRef<InsertStyle>({
    fontSize: DEFAULT_TEXT_SIZE,
    color: DEFAULT_TEXT_COLOR,
    font: DEFAULT_TEXT_FONT,
    bold: false,
  })
  /** Scanned pages already told about, per document. */
  const scannedToldRef = useRef(new Set<number>())

  // Page text is per document: a save reloads the document and starts over
  const pageText = useMemo<PageText>(() => createPageText(model), [model])
  const pageTextRef = useRef(pageText)
  pageTextRef.current = pageText
  useEffect(() => {
    scannedToldRef.current = new Set()
    setDraft(null)
  }, [model, setDraft])

  const toast = useCallback(
    (message: string, tone: 'info' | 'error' = 'info') => services.showToast({ message, tone }),
    [services],
  )
  const canDraw = useCallback(
    (text: string, font?: string, bold?: boolean, italic?: boolean) =>
      services.engine().canDrawText(text, font, bold, italic),
    [services],
  )

  // ── opening drafts ────────────────────────────────────────────────────────

  /** Dry-run the draft's run once (PC startBlockEdit probe) and read its fonts' names. */
  const probeEditDraft = useCallback(
    (d: EditDraft) => {
      const sameDraft = (cur: TextDraft | null): cur is EditDraft =>
        !!cur && cur.kind === 'edit' && cur.rect === d.rect && cur.pageIndex === d.pageIndex
      const pt = pageTextRef.current
      void runFontNamesOf(pt, d).then((runFontNames) => {
        const cur = draftRef.current
        if (sameDraft(cur)) setDraft({ ...cur, runFontNames })
      })
      if (d.editId) return
      const probe: TextEditInput = {
        pageIndex: d.pageIndex,
        rect: d.rect,
        oldText: d.oldText,
        newText: d.oldText,
        fontSize: d.fontSize,
      }
      void services
        .engine()
        .validateTextEdits(services.getModel().originalBytes, [probe])
        .then(([v]) => {
          const cur = draftRef.current
          if (!v || !sameDraft(cur)) return
          if (v.invisible) {
            // An OCR layer over a page picture: nothing visible to edit (scan edits are 2nd edition)
            setDraft(null)
            toast(t('pdfTextScannedPage'))
            return
          }
          if (v.reason) {
            // The block cannot be matched as one unit: the tapped line instead (PC fallback),
            // only while the draft is untouched
            if (cur.block && cur.tapLine && cur.value === (cur.foldBase ?? cur.oldText)) {
              void pageTextRef.current.entry(cur.pageIndex).then((entry) => {
                if (!sameDraft(draftRef.current) || !cur.tapLine) return
                const line = lineDraftFor(cur.pageIndex, cur.tapLine, entry)
                setDraft(line)
                probeEditDraftRef.current(line)
              })
            }
            return
          }
          const ink = v.baseColor ? visibleInk(v.baseColor, undefined) : undefined
          setDraft({
            ...cur,
            ...(v.bounds ? { cover: v.bounds } : {}),
            ...(ink && !cur.seedInk ? { seedInk: ink } : {}),
          })
        })
        .catch(() => {
          // the cover falls back to the run's rect; the commit validates again
        })
    },
    [services, setDraft, t, toast],
  )
  const probeEditDraftRef = useRef(probeEditDraft)
  probeEditDraftRef.current = probeEditDraft

  const openEditDraft = useCallback(
    (d: EditDraft) => {
      setUserDraft(d)
      probeEditDraft(d)
    },
    [probeEditDraft, setUserDraft],
  )

  const openInsertAt = useCallback(
    (pageIndex: number, vx: number, vy: number) => {
      const geom = ctxRef.current.pageGeom(pageIndex)
      setUserDraft(insertDraftAt(pageIndex, geom, vx, vy, insertStyleRef.current))
    },
    [setUserDraft],
  )

  /** Document text under a tap: a pending edit of the block, a fold of pending line
      edits inside it (PC foldBlockValue), or a fresh draft. */
  const openBlock = useCallback(
    (pageIndex: number, block: TextBlock, py: number) => {
      const pt = pageTextRef.current
      void pt.entry(pageIndex).then((entry) => {
        if (!activeRef.current || draftRef.current) return
        const pending = services.getEdits().textEdits.filter((e) => e.input.pageIndex === pageIndex)
        const owner = pending.find((e) => isBlockEditOf(e, block))
        if (owner) {
          openEditDraft(draftFromPendingEdit(owner, entry))
          return
        }
        const fresh = editDraftFor(pageIndex, block, entry, py)
        const inside = pending.filter((e) => {
          if (e.input.blockSource !== undefined || e.input.translate) return false
          const r = e.input.rect
          const cx = (r[0] + r[2]) / 2
          const cy = (r[1] + r[3]) / 2
          return (
            cx >= block.rect[0] && cx <= block.rect[2] && cy >= block.rect[1] && cy <= block.rect[3]
          )
        })
        if (inside.length === 0) {
          openEditDraft(fresh)
          return
        }
        if (!fresh.block) {
          // One line with a pending edit: reopen it
          openEditDraft(draftFromPendingEdit(inside[0]!, entry))
          return
        }
        const folded = spliceBlockText(
          joinBlockLines(block.lines.map((l) => l.text)),
          inside.map((e) => ({ oldText: e.input.oldText, newText: e.input.newText })),
        )
        if (folded === null) {
          openEditDraft(draftFromPendingEdit(inside[0]!, entry))
          return
        }
        openEditDraft({
          ...fresh,
          value: folded,
          foldBase: folded,
          foldedIds: inside.map((e) => e.id),
        })
      })
    },
    [openEditDraft, services],
  )

  // ── committing ────────────────────────────────────────────────────────────

  const dispatch = useCallback(
    (ops: Op[]): boolean => {
      if (ops.length === 0) return true
      const plan = services.dispatch(ops)
      if (plan.failures.length > 0) {
        toast(plan.failures[0]!.error, 'error')
        return false
      }
      return true
    },
    [services, toast],
  )

  const commitInsert = useCallback(
    async (d: InsertDraft): Promise<boolean> => {
      const rev = userRevRef.current
      if (d.value.trim() === '') {
        if (d.insertId && !dispatch([{ op: 'removeTextInsert', id: d.insertId }])) return false
        setDraft(null)
        return true
      }
      // Gate on a face the save can embed now, not at save time (PC confirmTextInsert)
      const bad = await uncoverableChars(canDraw, d.value, d.font, d.bold).catch(() => [])
      if (userRevRef.current !== rev || !draftRef.current) return false
      if (bad.length > 0) {
        toast(t('pdfTextCannotDraw', { chars: charList(bad) }), 'error')
        return false
      }
      const ok = d.insertId
        ? dispatch([{ op: 'patchTextInsert', id: d.insertId, input: insertStyleOf(d) }])
        : dispatch([
            {
              op: 'addTextInsert',
              id: services.newId(),
              input: insertInputOf(d, ctxRef.current.pageGeom(d.pageIndex)),
            },
          ])
      if (!ok) return false
      insertStyleRef.current = { fontSize: d.fontSize, color: d.color, font: d.font, bold: d.bold }
      setDraft(null)
      return true
    },
    [canDraw, dispatch, services, setDraft, t, toast],
  )

  const commitEdit = useCallback(
    async (d: EditDraft): Promise<boolean> => {
      const rev = userRevRef.current
      const prev = services.getEdits().textEdits
      const existing = d.editId ? prev.find((e) => e.id === d.editId) : undefined
      if (editDraftUnchanged(d, existing)) {
        setDraft(null)
        return true
      }
      const owned = [...(existing ? [existing.id] : []), ...(d.foldedIds ?? [])]
      if (editDraftIsOriginal(d)) {
        // Back to what the document says: the pending edits are moot
        if (!dispatch(owned.map((id): Op => ({ op: 'removeTextEdit', id })))) return false
        setDraft(null)
        return true
      }
      const input = editInputOf(d, pageTextRef.current.blocksNow(d.pageIndex))
      if (input === 'overflow') {
        toast(t('pdfTextOverflow'), 'error')
        return false
      }
      const outcome =
        input.newText === ''
          ? ({ kind: 'ok' } as const)
          : await predictEditFont(
              canDraw,
              input.newText,
              d.knownChars,
              d.font,
              !!d.bold,
              d.runFontNames ?? (await runFontNamesOf(pageTextRef.current, d)),
            ).catch(() => ({ kind: 'ok' }) as const)
      if (userRevRef.current !== rev || !draftRef.current) return false
      if (outcome.kind === 'blocked') {
        toast(t('pdfTextCannotDraw', { chars: charList(outcome.chars) }), 'error')
        return false
      }
      const bytes = services.getModel().originalBytes
      const planned = await planAiTextEdit(
        () => services.getEdits().textEdits.filter((e) => !owned.includes(e.id)),
        input,
        async (e) => (await services.engine().validateTextEdits(bytes, [e]))[0],
      )
      if (userRevRef.current !== rev || !draftRef.current) return false
      if ('reason' in planned) {
        toast(t('pdfTextNoMatch'), 'error')
        return false
      }
      const id = d.editId ?? planned.owner?.id ?? services.newId()
      const baseInk =
        d.seedInk ?? (planned.baseColor ? visibleInk(planned.baseColor, undefined) : undefined)
      const te: LocalTextEdit = {
        id,
        input: planned.input,
        ...((planned.cover ?? d.cover) ? { cover: planned.cover ?? d.cover } : {}),
        ...(planned.moveBy ? { moveBy: planned.moveBy } : {}),
        ...(baseInk ? { baseInk } : {}),
      }
      const gone = new Set([...planned.gone, ...owned])
      gone.delete(id)
      const now = services.getEdits().textEdits
      if (!dispatch(textEditListOps(now, patchPendingEdits(now, te, gone)))) return false
      if (outcome.kind === 'substitute')
        toast(t('pdfTextFontSubstituted', { chars: charList(outcome.chars) }))
      setDraft(null)
      return true
    },
    [canDraw, dispatch, services, setDraft, t, toast],
  )

  const commit = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current
    if (!d) return true
    if (busyRef.current) return false
    setBusy(true)
    try {
      return d.kind === 'insert' ? await commitInsert(d) : await commitEdit(d)
    } finally {
      setBusy(false)
    }
  }, [commitEdit, commitInsert])

  // An open box is part of the document: it counts as unsaved, and a save or share commits it first
  const hasDraft = draft !== null
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (!hasDraft) return
    return services.registerDraft(async () => {
      await commitRef.current()
    })
  }, [hasDraft, services])

  // Leaving the tool or edit mode commits the open box; text that cannot be kept is dropped
  useEffect(() => {
    if (active || !draftRef.current) return
    void commit().then((ok) => {
      if (!ok) setDraft(null)
    })
  }, [active, commit, setDraft])

  // ── taps ──────────────────────────────────────────────────────────────────

  const onTap = useCallback(
    (pageIndex: number, vx: number, vy: number) => {
      if (!activeRef.current || busyRef.current) return
      if (draftRef.current) {
        // A tap elsewhere confirms the open box (PC: the editor commits on blur)
        void commit()
        return
      }
      const c = ctxRef.current
      const geom = c.pageGeom(pageIndex)
      const [px, py] = viewToPdf(geom, vx, vy)
      const pt = pageTextRef.current
      void pt.entry(pageIndex).then(async (entry) => {
        if (!activeRef.current || draftRef.current) return
        if (!pageHasText(entry)) {
          if (!scannedToldRef.current.has(pageIndex)) {
            scannedToldRef.current.add(pageIndex)
            toast(t('pdfTextScannedPage'))
          }
          openInsertAt(pageIndex, vx, vy)
          return
        }
        const blocks = await pt.blocks(pageIndex)
        if (!activeRef.current || draftRef.current) return
        const scale = c.viewer?.getScale() ?? 1
        const block = blockAt(blocks, px, py, BLOCK_SLOP_PX / Math.max(scale, 0.01))
        if (block) openBlock(pageIndex, block, py)
        else openInsertAt(pageIndex, vx, vy)
      })
    },
    [commit, openBlock, openInsertAt, t, toast],
  )

  const onOpenInsert = useCallback(
    (id: string) => {
      if (!activeRef.current || busyRef.current) return
      if (draftRef.current) {
        void commit()
        return
      }
      const insert = services.getEdits().textInserts.find((e) => e.id === id)
      if (insert) setUserDraft(draftFromPendingInsert(insert))
    },
    [commit, services, setUserDraft],
  )

  const onMoveInsert = useCallback(
    (id: string, origin: [number, number]) => {
      if (!activeRef.current) return
      dispatch([{ op: 'patchTextInsert', id, input: { origin } }])
    },
    [dispatch],
  )

  const onOpenEdit = useCallback(
    (id: string) => {
      if (!activeRef.current || busyRef.current) return
      if (draftRef.current) {
        void commit()
        return
      }
      const te = services.getEdits().textEdits.find((e) => e.id === id)
      if (!te) return
      void pageTextRef.current
        .entry(te.input.pageIndex)
        .then((entry) => openEditDraft(draftFromPendingEdit(te, entry)))
    },
    [commit, openEditDraft, services],
  )

  const patchDraft = useCallback(
    (patch: (d: TextDraft) => TextDraft) => {
      const d = draftRef.current
      if (d) setUserDraft(patch(d))
    },
    [setUserDraft],
  )

  const onDelete = useCallback(() => {
    const d = draftRef.current
    if (!d || busyRef.current) return
    if (d.kind === 'insert') {
      if (d.insertId && !dispatch([{ op: 'removeTextInsert', id: d.insertId }])) return
      setDraft(null)
      return
    }
    // Delete the whole run, as if the box was emptied and confirmed (PC deleteDraftRun)
    setUserDraft({ ...d, value: '' })
    void commit()
  }, [commit, dispatch, setDraft, setUserDraft])

  // ── chrome ────────────────────────────────────────────────────────────────

  const renderPageOverlay = useCallback(
    (page: PdfFeaturePage) => (
      <TextPageLayer
        page={page}
        inserts={edits.textInserts}
        edits={edits.textEdits}
        draft={draft && draft.pageIndex === page.pageIndex ? draft : null}
        active={active}
        inputLabel={t(draft?.kind === 'edit' ? 'pdfTextEditLabel' : 'pdfTextInputLabel')}
        onTap={onTap}
        onOpenInsert={onOpenInsert}
        onMoveInsert={onMoveInsert}
        onOpenEdit={onOpenEdit}
        onDraftValue={(value) => patchDraft((d) => ({ ...d, value }))}
      />
    ),
    [
      active,
      draft,
      edits.textEdits,
      edits.textInserts,
      onMoveInsert,
      onOpenEdit,
      onOpenInsert,
      onTap,
      patchDraft,
      t,
    ],
  )

  const bar =
    draft && active ? (
      <TextStyleBar
        t={t}
        busy={busy}
        state={
          draft.kind === 'insert'
            ? {
                bold: draft.bold,
                size: draft.fontSize,
                color: draft.color,
                font: draft.font,
                documentStyle: false,
              }
            : {
                bold: !!draft.bold,
                size: draft.size ?? draft.fontSize,
                color: draft.color,
                font: draft.font,
                documentStyle: true,
                ...(draft.seedInk ? { documentInk: draft.seedInk } : {}),
              }
        }
        onBold={() =>
          patchDraft((d) =>
            d.kind === 'insert'
              ? { ...d, bold: !d.bold }
              : withOptional(d, 'bold', d.bold ? undefined : (true as const)),
          )
        }
        onSize={(dir) =>
          patchDraft((d) =>
            d.kind === 'insert'
              ? { ...d, fontSize: stepTextSize(d.fontSize, dir) }
              : withOptional(d, 'size', stepTextSize(d.size ?? d.fontSize, dir)),
          )
        }
        onColor={(color) =>
          patchDraft((d) =>
            d.kind === 'insert'
              ? { ...d, color: color ?? DEFAULT_TEXT_COLOR }
              : withOptional(d, 'color', color),
          )
        }
        onFont={(font: TextFontId | undefined) =>
          patchDraft((d) =>
            d.kind === 'insert'
              ? { ...d, font: font ?? DEFAULT_TEXT_FONT }
              : withOptional(d, 'font', font),
          )
        }
        onDelete={onDelete}
        onConfirm={() => void commit()}
      />
    ) : null

  return {
    onToolPress: (on) => {
      if (on) toast(t('pdfTextHint'))
    },
    renderPageOverlay,
    ...(bar ? { stageExtras: bar } : {}),
  }
}

/** BaseFont names of the fonts the draft's run is drawn with. */
async function runFontNamesOf(pt: PageText, d: EditDraft): Promise<string[]> {
  const [entry, names] = await Promise.all([pt.entry(d.pageIndex), pt.fontNames(d.pageIndex)])
  return fontIdsIn(entry, d.rect).flatMap((id) => {
    const n = names.get(id)
    return n ? [n] : []
  })
}

/** Set or clear an optional draft field (undefined removes it, so "unchanged" checks hold). */
function withOptional<K extends 'bold' | 'size' | 'color' | 'font'>(
  d: EditDraft,
  key: K,
  value: EditDraft[K] | undefined,
): EditDraft {
  const next = { ...d } as Record<string, unknown>
  if (value === undefined) delete next[key]
  else next[key] = value
  return next as unknown as EditDraft
}
