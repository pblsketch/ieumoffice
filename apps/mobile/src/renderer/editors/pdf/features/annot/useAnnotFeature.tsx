// The annotation feature (spec 3.4) behind the [Highlighter] bar button: touch text
// selection and its bar (three highlighter pens, underline, squiggly, strikeout, note),
// the color row, the sheet of an existing markup (recolor / delete), sticky notes with
// replies, edits and deletes, and the author name. Every change goes through the PC op
// registry (`services.dispatch`) and only while editing.
import './annot.css'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { MARKUP_PALETTE, quadToRect } from '../../../../../../../pdf/src/renderer/annotations'
import {
  findThreadRoot,
  flattenThread,
  type NoteThreadItem,
} from '../../../../../../../pdf/src/renderer/note-threads'
import {
  sameColor,
  type LineMarkupType,
  type Rgb,
} from '../../../../../../../pdf/src/renderer/selection-colors'
import type { MarkupType } from '../../../../../../../pdf/src/shared/ipc'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import type { Op, PdfFeatureChrome, PdfFeatureContext } from '../../edit/types'
import { AnnotPageLayer } from './AnnotPageLayer'
import { createAnnotCatalog, readSubjects } from './catalog'
import {
  IconAnnotClose,
  IconAnnotNote,
  IconAnnotSelectText,
  IconAnnotSquiggly,
  IconAnnotStrikeout,
  IconAnnotUnderline,
} from './icons'
import {
  deleteMarkupOps,
  highlightPenAction,
  isLineMarkup,
  markupAt,
  markupColorOf,
  markupTypeOf,
  paintOps,
  recolorTargets,
  savedOf,
  selectionMarkupState,
  toggleMarkupOps,
  type MarkupMatch,
  type MarkupWorld,
} from './markupOps'
import { newNoteOp, noteDeleteOps, noteEditOps, pageThreads, replyOp } from './noteOps'
import {
  loadAuthor,
  loadHighlightPens,
  loadLineMarkupColors,
  saveAuthor,
  saveHighlightPens,
  saveLineMarkupColors,
} from './prefs'

interface Selection {
  readonly pageIndex: number
  readonly quads: number[][]
  /** A finger is still dragging it: the bar waits. */
  readonly dragging: boolean
}

type ColorRow = MarkupType | null

const LINE_TOOLS: readonly {
  type: LineMarkupType
  label: MobileStringKey
  Icon: typeof IconAnnotUnderline
}[] = [
  { type: 'underline', label: 'pdfAnnotUnderline', Icon: IconAnnotUnderline },
  { type: 'squiggly', label: 'pdfAnnotSquiggly', Icon: IconAnnotSquiggly },
  { type: 'strikeout', label: 'pdfAnnotStrikeout', Icon: IconAnnotStrikeout },
]

const MARKUP_LABEL: Readonly<Record<MarkupType, MobileStringKey>> = {
  highlight: 'pdfAnnotHighlight',
  underline: 'pdfAnnotUnderline',
  squiggly: 'pdfAnnotSquiggly',
  strikeout: 'pdfAnnotStrikeout',
}

const cssRgb = (c: readonly number[]): string =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`

function Swatches(props: {
  readonly current: Rgb | null
  readonly label: (n: number) => string
  readonly onPick: (color: Rgb) => void
  readonly testId: string
}) {
  return (
    <>
      {MARKUP_PALETTE.map((p, i) => (
        <button
          key={p.hex}
          type="button"
          className="m-pdf-annot-swatch"
          aria-label={props.label(i + 1)}
          aria-pressed={props.current ? sameColor(props.current, p.color) : false}
          data-testid={`${props.testId}-${i}`}
          onClick={() => props.onPick([...p.color])}
        >
          <span className="m-pdf-annot-swatch-face" style={{ background: p.hex }} />
        </button>
      ))}
    </>
  )
}

export function useAnnotFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { model, editing, toolActive, activeTool, services, t, edits } = ctx
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const catalog = useMemo(() => createAnnotCatalog(model, bump), [model])
  const [surfaceMode, setSurfaceMode] = useState<'select' | 'note'>('select')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [colorRow, setColorRow] = useState<ColorRow>(null)
  const [pens, setPens] = useState<Rgb[]>(loadHighlightPens)
  const [penIndex, setPenIndex] = useState(0)
  const [lineColors, setLineColors] = useState(loadLineMarkupColors)
  const [markupSheet, setMarkupSheet] = useState<MarkupMatch | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ pageIndex: number; at: [number, number] } | null>(
    null,
  )
  const [thread, setThread] = useState<{ pageIndex: number; rootKey: string } | null>(null)
  const [savedAuthor, setSavedAuthor] = useState(loadAuthor)
  const [author, setAuthor] = useState(savedAuthor)
  const [text, setText] = useState('')
  const [editingItem, setEditingItem] = useState<string | null>(null)

  const editingRef = useRef(editing)
  editingRef.current = editing

  // /T of every new markup and note: the device's memo name, else the PC default
  useEffect(() => {
    if (savedAuthor) services.setRequestExtras({ annotationAuthor: savedAuthor })
  }, [savedAuthor, services])

  // the tool going off ends its selection and surface; leaving edit closes the editors
  useEffect(() => {
    if (toolActive) return
    setSelection(null)
    setColorRow(null)
    setSurfaceMode('select')
    catalog.dropRuns()
  }, [toolActive, catalog])
  useEffect(() => {
    if (editing) return
    setMarkupSheet(null)
    setNoteDraft(null)
    setEditingItem(null)
  }, [editing])
  // a reloaded document (after a save) has new annotations and object numbers
  useEffect(() => {
    setSelection(null)
    setMarkupSheet(null)
    setThread(null)
  }, [model])

  const world = useCallback(
    (): MarkupWorld => ({
      edits: services.getEdits(),
      saved: (pageIndex) => catalog.saved(pageIndex)?.markups ?? [],
    }),
    [services, catalog],
  )

  const dispatch = useCallback(
    (ops: Op[]): boolean => {
      if (!editingRef.current || ops.length === 0) return false
      const plan = services.dispatch(ops)
      if (plan.failures.length > 0) {
        services.showToast({ message: t('pdfAnnotFailed'), tone: 'error' })
        return false
      }
      return true
    },
    [services, t],
  )

  /** Recolor and add in one step, carrying saved markups' /Subj over (PC paintMarkups). */
  const paint = useCallback(
    async (color: Rgb, recolor: readonly MarkupMatch[], add: Parameters<typeof paintOps>[2]) => {
      const saved = savedOf(recolor)
      const subjects =
        saved.length > 0
          ? await readSubjects(services.getModel().originalBytes, saved)
          : new Map<number, string>()
      dispatch(paintOps(color, recolor, add, subjects))
    },
    [dispatch, services],
  )

  const selectionMap = (sel: Selection) => new Map([[sel.pageIndex, sel.quads]])

  const applyPen = async (index: number) => {
    const sel = selection
    const pen = pens[index]
    if (!editingRef.current || !sel || !pen) return
    await catalog.ensureSaved(sel.pageIndex)
    setPenIndex(index)
    const action = highlightPenAction(world(), selectionMap(sel), pen)
    if (action.kind === 'remove') {
      dispatch(action.ops)
      setColorRow(null)
      return
    }
    setColorRow('highlight')
    await paint(pen, action.recolor, action.add)
  }

  const applyLine = async (type: LineMarkupType) => {
    const sel = selection
    if (!editingRef.current || !sel) return
    await catalog.ensureSaved(sel.pageIndex)
    const { ops, result } = toggleMarkupOps(world(), selectionMap(sel), type, lineColors[type])
    dispatch(ops)
    setColorRow(result === 'added' ? type : null)
  }

  /** A swatch of the color row: remember it, then recolor that markup on the selection. */
  const pickRowColor = async (color: Rgb) => {
    const sel = selection
    const type = colorRow
    if (!editingRef.current || !sel || !type) return
    if (isLineMarkup(type)) {
      const next = { ...lineColors, [type]: color }
      setLineColors(next)
      saveLineMarkupColors(next)
    } else {
      const next = pens.map((p, i) => (i === penIndex ? color : p))
      setPens(next)
      saveHighlightPens(next)
    }
    const targets = recolorTargets(world(), selectionMap(sel), type, color)
    if (targets.length > 0) await paint(color, targets, [])
  }

  const noteFromSelection = () => {
    const sel = selection
    const last = sel?.quads[sel.quads.length - 1]
    if (!sel || !last) return
    const [, , x2, y2] = quadToRect(last)
    setSelection(null)
    setColorRow(null)
    setText('')
    setNoteDraft({ pageIndex: sel.pageIndex, at: [x2, y2] })
  }

  const ensureSaved = useCallback((i: number) => void catalog.ensureSaved(i), [catalog])
  const ensureRuns = useCallback((i: number) => void catalog.ensureRuns(i), [catalog])

  const onSelect = useCallback((pageIndex: number, quads: number[][] | null, dragging: boolean) => {
    setColorRow(null)
    setSelection(quads ? { pageIndex, quads, dragging } : null)
  }, [])

  const onTap = useCallback(
    (pageIndex: number, at: [number, number], slack: number) => {
      setSelection(null)
      setColorRow(null)
      const runs = catalog.runs(pageIndex)
      const hit = markupAt(world(), pageIndex, at[0], at[1], slack)
      if (hit) {
        setMarkupSheet(hit)
        return
      }
      if (runs && runs.length === 0) services.showToast(t('pdfAnnotNoText'))
    },
    [catalog, world, services, t],
  )

  const onNoteAt = useCallback((pageIndex: number, at: [number, number]) => {
    setText('')
    setNoteDraft({ pageIndex, at })
  }, [])

  const onOpenThread = useCallback((pageIndex: number, rootKey: string) => {
    setText('')
    setEditingItem(null)
    setThread({ pageIndex, rootKey })
  }, [])

  const rememberAuthor = (name: string): string => {
    const trimmed = name.trim()
    if (trimmed) {
      saveAuthor(trimmed)
      setSavedAuthor(trimmed)
    }
    return trimmed
  }

  const addNote = () => {
    const draft = noteDraft
    const contents = text.trim()
    if (!draft || !contents) return
    const name = rememberAuthor(author)
    const ok = dispatch([
      newNoteOp({
        id: services.newId(),
        pageIndex: draft.pageIndex,
        at: draft.at,
        contents,
        author: name,
        now: Date.now(),
      }),
    ])
    if (!ok) return
    setNoteDraft(null)
    setText('')
  }

  // the open thread, rebuilt from the current edits and saved notes
  const threadRoot = useMemo((): NoteThreadItem | null => {
    if (!thread) return null
    const roots = pageThreads(edits, thread.pageIndex, catalog.saved(thread.pageIndex)?.notes ?? [])
    return findThreadRoot(roots, thread.rootKey)
    // version: the saved notes of the page arrived
  }, [thread, edits, catalog, version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (thread && !threadRoot && catalog.saved(thread.pageIndex)) setThread(null)
  }, [thread, threadRoot, catalog])

  const submitThread = () => {
    if (!thread || !threadRoot) return
    const contents = text.trim()
    if (!contents) return
    if (editingItem) {
      const item = flattenThread(threadRoot)
        .map(({ item: it }) => it)
        .find((it) => it.key === editingItem)
      const ops = item ? noteEditOps(item, contents) : null
      if (ops && !dispatch(ops)) return
      setEditingItem(null)
      setText('')
      return
    }
    const name = rememberAuthor(author)
    if (
      dispatch([
        replyOp({
          pageIndex: thread.pageIndex,
          root: threadRoot,
          contents,
          author: name,
          now: Date.now(),
        }),
      ])
    )
      setText('')
  }

  const deleteItem = (item: NoteThreadItem) => {
    dispatch(noteDeleteOps(item))
    if (threadRoot && item.key === threadRoot.key) setThread(null)
  }

  // ── the bar over the stage ──
  const selState = useMemo(
    () => (selection ? selectionMarkupState(world(), selectionMap(selection)) : null),
    // edits and loaded saved annots change the pressed buttons
    [selection, edits, version, world], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const showSelectionBar = editing && toolActive && selection !== null && !selection.dragging
  const rowColor: Rgb | null =
    colorRow && selState
      ? (selState.colors.get(colorRow) ??
        (colorRow === 'highlight' ? (pens[penIndex] ?? null) : lineColors[colorRow]))
      : null

  const toolBar = editing && toolActive && (
    <div className="m-pdf-annot-bar" role="toolbar" data-testid="pdf-annot-bar">
      {showSelectionBar ? (
        <>
          <div className="m-pdf-annot-row">
            {pens.map((pen, i) => {
              const pressed = selState?.colors.get('highlight')
              return (
                <button
                  key={i}
                  type="button"
                  className="m-pdf-annot-btn"
                  aria-label={t('pdfAnnotPen', { n: i + 1 })}
                  aria-pressed={pressed ? sameColor(pressed, pen) : false}
                  data-testid={`pdf-annot-pen-${i}`}
                  onClick={() => void applyPen(i)}
                >
                  <span className="m-pdf-annot-pen" style={{ background: cssRgb(pen) }} />
                </button>
              )
            })}
            {LINE_TOOLS.map(({ type, label, Icon }) => (
              <button
                key={type}
                type="button"
                className="m-pdf-annot-btn"
                aria-label={selState?.active.has(type) ? t('pdfAnnotRemove') : t(label)}
                aria-pressed={selState?.active.has(type) ?? false}
                data-testid={`pdf-annot-${type}`}
                onClick={() => void applyLine(type)}
              >
                <Icon size={20} />
              </button>
            ))}
            <button
              type="button"
              className="m-pdf-annot-btn"
              aria-label={t('memoAdd')}
              data-testid="pdf-annot-note"
              onClick={noteFromSelection}
            >
              <IconAnnotNote size={20} />
            </button>
            <button
              type="button"
              className="m-pdf-annot-btn"
              aria-label={t('pdfAnnotClearSelection')}
              data-testid="pdf-annot-clear"
              onClick={() => {
                setSelection(null)
                setColorRow(null)
              }}
            >
              <IconAnnotClose size={20} />
            </button>
          </div>
          {colorRow && (
            <div
              className="m-pdf-annot-row"
              role="group"
              aria-label={t(MARKUP_LABEL[colorRow])}
              data-testid="pdf-annot-color-row"
            >
              <Swatches
                current={rowColor}
                label={(n) => t('pdfAnnotColor', { n })}
                onPick={(color) => void pickRowColor(color)}
                testId="pdf-annot-row-color"
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="m-pdf-annot-row" role="radiogroup">
            <button
              type="button"
              role="radio"
              className="m-pdf-annot-mode"
              aria-checked={surfaceMode === 'select'}
              data-testid="pdf-annot-mode-select"
              onClick={() => setSurfaceMode('select')}
            >
              <IconAnnotSelectText size={18} />
              <span>{t('pdfAnnotModeSelect')}</span>
            </button>
            <button
              type="button"
              role="radio"
              className="m-pdf-annot-mode"
              aria-checked={surfaceMode === 'note'}
              data-testid="pdf-annot-mode-note"
              onClick={() => {
                setSurfaceMode('note')
                setSelection(null)
              }}
            >
              <IconAnnotNote size={18} />
              <span>{t('pdfAnnotModeNote')}</span>
            </button>
          </div>
          <p className="m-pdf-annot-hint">
            {surfaceMode === 'select' ? t('pdfAnnotHintSelect') : t('pdfAnnotHintNote')}
          </p>
        </>
      )}
    </div>
  )

  const markupColor = markupSheet ? markupColorOf(markupSheet) : null
  const markupSheetNode = (
    <Sheet
      open={markupSheet !== null && editing}
      title={markupSheet ? t(MARKUP_LABEL[markupTypeOf(markupSheet)]) : ''}
      closeLabel={t('cancel')}
      onClose={() => setMarkupSheet(null)}
      testId="pdf-annot-markup-sheet"
    >
      <div className="m-pdf-annot-sheet">
        <div className="m-pdf-annot-swatches" role="group" aria-label={t('pdfAnnotMarkupTitle')}>
          <Swatches
            current={markupColor}
            label={(n) => t('pdfAnnotColor', { n })}
            testId="pdf-annot-sheet-color"
            onPick={(color) => {
              const target = markupSheet
              setMarkupSheet(null)
              if (!target || (markupColor && sameColor(markupColor, color))) return
              void paint(color, [target], [])
            }}
          />
        </div>
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-ghost mobile-btn-danger-text"
          data-testid="pdf-annot-sheet-delete"
          onClick={() => {
            const target = markupSheet
            setMarkupSheet(null)
            if (target) dispatch(deleteMarkupOps(target))
          }}
        >
          {t('pdfAnnotRemove')}
        </button>
      </div>
    </Sheet>
  )

  const authorField = (
    <input
      className="mobile-input"
      value={author}
      onChange={(event) => setAuthor(event.target.value)}
      aria-label={t('memoAuthor')}
      placeholder={t('memoAuthor')}
      data-testid="pdf-annot-author"
    />
  )

  const noteSheetNode = (
    <Sheet
      open={noteDraft !== null && editing}
      title={t('pdfAnnotNewNote')}
      closeLabel={t('cancel')}
      onClose={() => setNoteDraft(null)}
      testId="pdf-annot-note-sheet"
    >
      <div className="m-pdf-annot-sheet">
        {authorField}
        <textarea
          className="mobile-input m-pdf-annot-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={t('memoPlaceholder')}
          placeholder={t('memoPlaceholder')}
          rows={3}
          data-testid="pdf-annot-note-text"
        />
        <div className="m-pdf-annot-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-primary"
            disabled={!text.trim()}
            onClick={addNote}
            data-testid="pdf-annot-note-add"
          >
            {t('memoAdd')}
          </button>
        </div>
      </div>
    </Sheet>
  )

  const threadItems = threadRoot ? flattenThread(threadRoot) : []
  const threadSheetNode = (
    <Sheet
      open={threadRoot !== null}
      title={t('memoTitle')}
      closeLabel={t('cancel')}
      onClose={() => {
        setThread(null)
        setEditingItem(null)
      }}
      testId="pdf-annot-thread-sheet"
    >
      <div className="m-pdf-annot-sheet">
        <ul className="m-pdf-annot-thread">
          {threadItems.map(({ item, depth }) => (
            <li
              key={item.key}
              className="m-pdf-annot-comment"
              data-reply={depth > 0 ? 'true' : undefined}
              data-testid={`pdf-annot-comment-${item.key}`}
            >
              <span className="m-pdf-annot-meta">
                {item.author}
                {item.timeMs !== null ? ` · ${new Date(item.timeMs).toLocaleDateString()}` : ''}
              </span>
              <span className="m-pdf-annot-body">{item.contents}</span>
              {editing && (
                <div className="m-pdf-annot-actions">
                  <button
                    type="button"
                    className="mobile-pill-btn mobile-btn-ghost"
                    data-testid={`pdf-annot-edit-${item.key}`}
                    onClick={() => {
                      setEditingItem(item.key)
                      setText(item.contents)
                    }}
                  >
                    {t('memoEdit')}
                  </button>
                  <button
                    type="button"
                    className="mobile-pill-btn mobile-btn-ghost mobile-btn-danger-text"
                    data-testid={`pdf-annot-delete-${item.key}`}
                    onClick={() => deleteItem(item)}
                  >
                    {t('memoDelete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {editing && (
          <div className="m-pdf-annot-composer">
            {editingItem === null && authorField}
            <textarea
              className="mobile-input m-pdf-annot-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={
                editingItem === null ? t('pdfAnnotReplyPlaceholder') : t('memoPlaceholder')
              }
              placeholder={
                editingItem === null ? t('pdfAnnotReplyPlaceholder') : t('memoPlaceholder')
              }
              rows={2}
              data-testid="pdf-annot-thread-text"
            />
            <div className="m-pdf-annot-actions">
              {editingItem !== null && (
                <button
                  type="button"
                  className="mobile-pill-btn mobile-btn-ghost"
                  onClick={() => {
                    setEditingItem(null)
                    setText('')
                  }}
                >
                  {t('cancel')}
                </button>
              )}
              <button
                type="button"
                className="mobile-pill-btn mobile-btn-primary"
                disabled={!text.trim()}
                onClick={submitThread}
                data-testid="pdf-annot-thread-submit"
              >
                {editingItem === null ? t('memoReply') : t('save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )

  // pins stay out of the way of the other tools' surfaces
  const showPins = activeTool === null || activeTool === 'highlighter'
  const surface = editing && toolActive ? surfaceMode : 'off'

  return {
    stageExtras: (
      <>
        {toolBar}
        {markupSheetNode}
        {noteSheetNode}
        {threadSheetNode}
      </>
    ),
    renderPageOverlay: (page) => (
      <AnnotPageLayer
        page={page}
        edits={edits}
        saved={catalog.saved(page.pageIndex)}
        runs={catalog.runs(page.pageIndex)}
        surface={surface}
        showPins={showPins}
        selection={selection?.pageIndex === page.pageIndex ? selection.quads : null}
        ensureSaved={ensureSaved}
        ensureRuns={ensureRuns}
        onSelect={onSelect}
        onTap={onTap}
        onNoteAt={onNoteAt}
        onOpenThread={onOpenThread}
        openNoteLabel={t('pdfAnnotOpenNote')}
      />
    ),
  }
}
