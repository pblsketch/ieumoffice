/**
 * 민감정보 가리기 in the Hangul editor: hiding the selection, renaming and undoing a hiding,
 * the candidate list of 민감정보 찾기, and what the AI panel's first send counts.
 *
 * A hidden span is a memo `[<prefix>] <label>` on the words (spec 2), put in by the plugin
 * (`hidingSelection`, `hideRanges`) in one undo step, by the product as its author. Un-hiding
 * is removing that memo; the words stay. Finding runs the shared rules on this PC through the
 * plugin (`sensitiveCandidates`); a dismissed candidate is remembered for the document by the
 * main process by kind and keyed hash only. Nothing here calls a model or the network.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  buildHidingMemoText,
  readHidingMemoLabel,
  relabelHidingMemoText,
} from '@genoffice/agent-core/hiding-memo'
import { detectSensitive } from '@genoffice/agent-core/sensitive-detect'
import { createCandidateLabeler } from '@genoffice/agent-core/sensitive-labels'
import { PRODUCT_NAME, type Lang, type Params } from '@genoffice/i18n'
import {
  SensitiveCandidateList,
  SensitiveLabelDialog,
  createSensitiveSendCheck,
  type SensitiveCandidateRow,
  type SensitiveSendCheck,
  type SensitiveSendCounts,
} from '@genoffice/ui'
import type {
  AgentMemo,
  AgentMemoAnchor,
  AgentSensitiveCandidate,
} from '../../studio-plugin/agent-plugin.mjs'
import type { AgentBridge } from './ai/agent-bridge'
import type { StringKey } from './i18n/locale'
import { ATTACHMENT_IMAGE_EXTS, type AttachmentMeta } from '../shared/ipc'

/** Why a selection cannot be hidden, as the message shown for it. */
export function hidingErrorKey(reason: string | undefined): StringKey {
  switch (reason) {
    case 'none':
      return 'hidingErrNone'
    case 'overlap':
    case 'memo_overlap':
      return 'hidingErrOverlap'
    case 'unsupported_place':
    case 'too_long':
    case 'memo_invalid_range':
      return 'hidingErrPlace'
    case 'protected':
    case 'memo_read_only':
      return 'hidingErrProtected'
    default:
      return 'hidingErrFailed'
  }
}

/** Whether a memo of the list is a hiding mark. */
export const isHidingMemo = (memo: Pick<AgentMemo, 'text'>): boolean =>
  readHidingMemoLabel(memo.text) !== null

/** The label a hiding memo stands for, as the rename dialog starts with it. */
export const hidingLabelOfMemo = (memo: Pick<AgentMemo, 'text'>): string =>
  readHidingMemoLabel(memo.text) ?? ''

/** A memo anchor as the editor's reveal takes it. */
export function placeOfAnchor(anchor: AgentMemoAnchor) {
  return {
    sec: anchor.sectionIndex,
    para: anchor.paraIndex,
    ...(anchor.path ? { path: anchor.path } : {}),
    offset: anchor.startCharIdx,
    length: anchor.endCharIdx - anchor.startCharIdx,
  }
}

/**
 * The candidate list's rows: dismissed ones left out, each with the label the model would
 * see, numbered after the labels the document already has (same value, same number).
 */
export function candidateRowsOf(
  candidates: readonly AgentSensitiveCandidate[],
  options: {
    lang: Lang
    excluded: readonly boolean[]
    marks: readonly { label: string; value: string }[]
    location: (page: number) => string
  },
): { rows: SensitiveCandidateRow[]; byId: Map<string, AgentSensitiveCandidate> } {
  const labeler = createCandidateLabeler({ lang: options.lang, existingMarks: options.marks })
  const rows: SensitiveCandidateRow[] = []
  const byId = new Map<string, AgentSensitiveCandidate>()
  candidates.forEach((candidate, index) => {
    if (options.excluded[index]) return
    const id = `c${index}`
    byId.set(id, candidate)
    rows.push({
      id,
      kind: candidate.kind,
      value: candidate.value,
      before: candidate.before,
      after: candidate.after,
      location: options.location(candidate.page),
      label: labeler.labelFor(candidate.kind, candidate.value),
      hideable: candidate.hideable && candidate.anchor !== null,
      ...(candidate.reason ? { reason: candidate.reason } : {}),
    })
  })
  return { rows, byId }
}

/** How many candidates the text of the attachments holds, found by the same rules. */
export function attachmentCandidateCount(texts: readonly string[]): number {
  return detectSensitive(texts.map((text, index) => ({ text, location: index }))).length
}

/** Longest stretch of an attachment read at once for the count. */
const ATTACHMENT_CHUNK = 200_000

/**
 * An attachment's text as the files skill reads it (other files are read with their own
 * hiding applied, file-parse), whole; null for a picture or one that cannot be read.
 */
async function attachmentText(att: AttachmentMeta): Promise<string | null> {
  if (ATTACHMENT_IMAGE_EXTS.has(att.ext)) return null
  let text = ''
  let offset = 0
  for (;;) {
    const read = await window.hwpApi.readAttachment(att.path, offset, ATTACHMENT_CHUNK)
    if (!read.ok) return text || null
    const piece = read.text ?? ''
    text += piece
    offset = (read.offset ?? offset) + piece.length
    if (piece.length === 0 || offset >= (read.totalChars ?? 0)) return text
  }
}

/** What the AI panel needs for its first send: the tab's check, the counts, the list. */
export interface HwpSensitiveGuard {
  /** lives as long as the tab: asked once, on its first send */
  check: SensitiveSendCheck
  count(attachments: readonly AttachmentMeta[]): Promise<SensitiveSendCounts>
  /** "Review": open the candidate list (the composer keeps its text) */
  review(): void
}

interface LabelAsk {
  /** where the new hiding goes, or the memo whose label changes */
  anchors: AgentMemoAnchor[] | null
  memo: AgentMemo | null
  seed: string
}

export interface HwpSensitiveArgs {
  /** the plain plugin bridge: these are the person's own edits, not the AI's */
  bridge: AgentBridge
  lang: Lang
  t: (key: StringKey, params?: Params) => string
  notify(notice: { key: StringKey; params?: Params; tone?: 'info' | 'error' }): void
  /** bring the memo column out, where the candidate list is shown */
  openMemos(): void
}

export interface HwpSensitive {
  /** hide the editor's selection: ask for a label, then put the memos in */
  startHide(): Promise<void>
  /** give a hiding memo another label */
  relabel(memo: AgentMemo): void
  /** open the candidate list */
  openFinder(): Promise<void>
  dialog: ReactElement | null
  /** the candidate list, while it is open */
  finder: ReactElement | null
  guard: HwpSensitiveGuard
}

export function useHwpSensitive({
  bridge,
  lang,
  t,
  notify,
  openMemos,
}: HwpSensitiveArgs): HwpSensitive {
  const [ask, setAsk] = useState<LabelAsk | null>(null)
  const [finderOpen, setFinderOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<SensitiveCandidateRow[]>([])
  const byIdRef = useRef(new Map<string, AgentSensitiveCandidate>())
  /** dismissed in a document without a file: remembered for this tab only */
  const dismissedRef = useRef(new Set<string>())
  const checkRef = useRef<SensitiveSendCheck | null>(null)
  checkRef.current ??= createSensitiveSendCheck()
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const startHide = useCallback(async () => {
    try {
      const where = await bridge.hidingSelection()
      if (!where.ok) {
        notifyRef.current({ key: hidingErrorKey(where.reason), tone: 'error' })
        return
      }
      setAsk({ anchors: where.anchors, memo: null, seed: '' })
    } catch {
      notifyRef.current({ key: 'hidingErrFailed', tone: 'error' })
    }
  }, [bridge])

  const relabel = useCallback((memo: AgentMemo) => {
    if (!isHidingMemo(memo)) return
    setAsk({ anchors: null, memo, seed: hidingLabelOfMemo(memo) })
  }, [])

  /** read the candidates again, without the dismissed ones */
  const load = useCallback(async (): Promise<SensitiveCandidateRow[]> => {
    const [{ candidates }, state] = await Promise.all([
      bridge.sensitiveCandidates(),
      bridge.hidingState().catch(() => null),
    ])
    const items = candidates.map((one) => ({ kind: one.kind, value: one.value }))
    const remembered = await window.hwpApi
      .sensitiveExcluded(items)
      .catch(() => items.map(() => false))
    const excluded = candidates.map(
      (one, index) =>
        remembered[index] === true || dismissedRef.current.has(`${one.kind}\u0000${one.value}`),
    )
    const made = candidateRowsOf(candidates, {
      lang,
      excluded,
      marks: state?.ok ? (state.marks ?? []) : [],
      location: (page) => (page > 0 ? t('memoPage', { page }) : ''),
    })
    byIdRef.current = made.byId
    return made.rows
  }, [bridge, lang, t])

  const openFinder = useCallback(async () => {
    openMemos()
    setFinderOpen(true)
    setBusy(true)
    try {
      setRows(await load())
    } catch {
      notifyRef.current({ key: 'sensitiveFindFailed', tone: 'error' })
      setFinderOpen(false)
    } finally {
      setBusy(false)
    }
  }, [load, openMemos])

  const confirm = useCallback(
    async (ids: string[]) => {
      const chosen = ids
        .map((id) => ({
          id,
          candidate: byIdRef.current.get(id),
          row: rows.find((r) => r.id === id),
        }))
        .filter((one) => one.candidate?.anchor && one.row)
      if (chosen.length === 0) return
      setBusy(true)
      try {
        // one memo text per label: the spots of one label go in together
        const byLabel = new Map<string, AgentMemoAnchor[]>()
        for (const one of chosen) {
          const list = byLabel.get(one.row!.label) ?? []
          list.push(one.candidate!.anchor!)
          byLabel.set(one.row!.label, list)
        }
        let done = 0
        for (const [label, anchors] of byLabel) {
          const made = await bridge.hideRanges(
            anchors,
            PRODUCT_NAME,
            buildHidingMemoText(label, lang),
          )
          if (!made.ok) {
            notifyRef.current({ key: hidingErrorKey(made.reason), tone: 'error' })
            break
          }
          done += made.count
        }
        if (done > 0) notifyRef.current({ key: 'hidingDone', params: { count: done } })
        setRows(await load())
      } catch {
        notifyRef.current({ key: 'hidingErrFailed', tone: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [bridge, lang, load, rows],
  )

  const exclude = useCallback(async (id: string) => {
    const candidate = byIdRef.current.get(id)
    if (!candidate) return
    dismissedRef.current.add(`${candidate.kind}\u0000${candidate.value}`)
    setRows((current) => current.filter((row) => row.id !== id))
    await window.hwpApi
      .sensitiveExclude({ kind: candidate.kind, value: candidate.value })
      .catch(() => {})
  }, [])

  const locate = useCallback(
    (id: string) => {
      const anchor = byIdRef.current.get(id)?.anchor
      if (anchor) void bridge.reveal(placeOfAnchor(anchor)).catch(() => {})
    },
    [bridge],
  )

  const submit = useCallback(
    async (label: string) => {
      const current = ask
      setAsk(null)
      if (!current) return
      try {
        if (current.memo) {
          const text = relabelHidingMemoText(current.memo.text, label, lang)
          if (text === null) return
          const done = await bridge.setMemo(current.memo.id, text)
          if (!done.ok) notifyRef.current({ key: 'hidingErrFailed', tone: 'error' })
          return
        }
        if (!current.anchors) return
        const made = await bridge.hideRanges(
          current.anchors,
          PRODUCT_NAME,
          buildHidingMemoText(label, lang),
        )
        if (!made.ok) {
          notifyRef.current({ key: hidingErrorKey(made.reason), tone: 'error' })
          return
        }
        notifyRef.current({ key: 'hidingDone', params: { count: made.count } })
      } catch {
        notifyRef.current({ key: 'hidingErrFailed', tone: 'error' })
      }
    },
    [ask, bridge, lang],
  )

  // a list left open follows the document: hiding elsewhere or an undo changes it
  useEffect(() => {
    if (!finderOpen) setRows([])
  }, [finderOpen])

  const count = useCallback(
    async (attachments: readonly AttachmentMeta[]): Promise<SensitiveSendCounts> => {
      const [documentRows, texts] = await Promise.all([
        load(),
        Promise.all(attachments.map((att) => attachmentText(att).catch(() => null))),
      ])
      return {
        documentCount: documentRows.length,
        attachmentCount: attachmentCandidateCount(
          texts.filter((text): text is string => typeof text === 'string'),
        ),
      }
    },
    [load],
  )

  const guardRef = useRef<HwpSensitiveGuard | null>(null)
  const countRef = useRef(count)
  countRef.current = count
  const openRef = useRef(openFinder)
  openRef.current = openFinder
  guardRef.current ??= {
    check: checkRef.current,
    count: (attachments) => countRef.current(attachments),
    review: () => void openRef.current(),
  }

  const dialog = ask ? (
    <SensitiveLabelDialog
      lang={lang}
      seed={ask.seed}
      {...(ask.anchors && ask.anchors.length > 1 ? { memoCount: ask.anchors.length } : {})}
      onSubmit={(label) => void submit(label)}
      onCancel={() => setAsk(null)}
    />
  ) : null

  const finder = finderOpen ? (
    <SensitiveCandidateList
      lang={lang}
      candidates={rows}
      busy={busy}
      memoNote
      onConfirm={(ids) => void confirm(ids)}
      onExclude={(id) => void exclude(id)}
      onLocate={locate}
      onClose={() => setFinderOpen(false)}
    />
  ) : null

  return { startHide, relabel, openFinder, dialog, finder, guard: guardRef.current }
}
