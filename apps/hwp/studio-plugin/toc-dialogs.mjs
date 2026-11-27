/**
 * Table-of-contents (TOC) and Index modal dialogs, Tool-menu registration,
 * and context-menu integration for the HWP editor (`rhwp-studio`).
 *
 * Runs inside the rhwp-studio iframe realm, driven by the app's studio plugin.
 * All UI strings are supplied in the active UI language via `labels`, and all
 * modal dialogs extend the studio's native `ModalDialog` so `dialog-theme.mjs`
 * styles them automatically in light and dark themes with zero raw hex colors.
 *
 * All document mutations route through `options.runEdit` (or `host.transaction`),
 * recording user edits as a single undo step and rolling back cleanly on refusals.
 */
import { MARK_PREFIXES, findRangeMarks } from './doc-marks.mjs'
import { getStudioModalParts } from './hancom-keys.mjs'
import {
  DEFAULT_INDEX_COLUMNS,
  DEFAULT_INDEX_TITLE,
  addIndexMark,
  addIndexMarksAll,
  buildIndexBlock,
  listIndexMarks,
  previewIndexMarksAll,
  refreshIndexBlock,
  removeIndexMark,
  resolveIndexWordAt,
} from './index-marks.mjs'
import {
  DEFAULT_TOC_MAX_LEVEL,
  DEFAULT_TOC_TITLES,
  TOC_LAYOUTS,
  detectLegacyToc,
  insertTocBlock,
  listTocRanges,
  refreshTocBlock,
} from './toc.mjs'

export const TOC_CREATE_COMMAND = 'ext:ieum-toc-create'
export const TOC_REFRESH_COMMAND = 'ext:ieum-toc-refresh'
export const INDEX_MARK_COMMAND = 'ext:ieum-index-mark'
export const INDEX_CREATE_COMMAND = 'ext:ieum-index-create'
export const INDEX_REFRESH_COMMAND = 'ext:ieum-index-refresh'
export const TOC_REFRESH_CONTEXT_COMMAND = 'ext:ieum-toc-refresh-context'
export const INDEX_REFRESH_CONTEXT_COMMAND = 'ext:ieum-index-refresh-context'

export const TOC_DIALOG_STYLE_ID = 'ieum-toc-dialog-styles'

/** Tool-menu items installed for TOC & Index management, in display order. */
export const TOC_INDEX_MENU_ITEMS = Object.freeze([
  { id: TOC_CREATE_COMMAND, labelKey: 'tocMenuCreate', opensDialog: true },
  { id: TOC_REFRESH_COMMAND, labelKey: 'tocMenuRefresh', opensDialog: false },
  { id: INDEX_MARK_COMMAND, labelKey: 'indexMenuMark', opensDialog: true },
  { id: INDEX_CREATE_COMMAND, labelKey: 'indexMenuCreate', opensDialog: true },
  { id: INDEX_REFRESH_COMMAND, labelKey: 'indexMenuRefresh', opensDialog: false },
])

const MAX_DIFF_PREVIEW_LINES = 16
const MAX_MARK_ALL_PREVIEW_ITEMS = 20
const EDIT_ABORT = Symbol('ieum-toc-edit-abort')

const TOC_DIALOG_CSS = `
.ieum-toc-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ieum-toc-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ieum-toc-row .dialog-label {
  flex: 0 0 92px;
  min-width: 92px;
}

.ieum-toc-field-grow {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
}

.ieum-toc-checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
}

.ieum-toc-message {
  margin: 0 0 8px;
  color: var(--ieum-dialog-ink);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-line;
}

.ieum-toc-hint {
  margin: 0;
  color: var(--ieum-dialog-ink-muted);
  font-size: 11px;
  line-height: 1.45;
}

.ieum-toc-status {
  min-height: 16px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ieum-dialog-ink-muted);
}

.ieum-toc-status[data-tone='error'] {
  color: var(--ieum-dialog-danger);
}

.ieum-toc-diff-list {
  margin-top: 10px;
  max-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
  border: 1px solid var(--ieum-dialog-line);
  border-radius: 4px;
  background: var(--ieum-dialog-surface-sunken);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ieum-toc-diff-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--ieum-dialog-line-soft);
  font-size: 11px;
}

.ieum-toc-diff-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.ieum-toc-diff-line {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.ieum-toc-diff-tag {
  flex: 0 0 auto;
  color: var(--ieum-dialog-ink-muted);
  font-weight: 600;
}

.ieum-toc-diff-text {
  color: var(--ieum-dialog-ink);
  word-break: break-word;
}

.ieum-toc-preview-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--ieum-dialog-line-soft);
  font-size: 11px;
}

.ieum-toc-preview-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.ieum-toc-preview-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ieum-toc-preview-match {
  color: var(--ieum-dialog-ink);
  font-weight: 600;
  word-break: break-word;
}

.ieum-toc-preview-context {
  color: var(--ieum-dialog-ink-muted);
  word-break: break-word;
}

.ieum-toc-preview-page {
  flex: 0 0 auto;
  color: var(--ieum-dialog-ink-muted);
  font-variant-numeric: tabular-nums;
}

.ieum-toc-marks-section {
  margin-top: 12px;
}

.ieum-toc-marks-list {
  max-height: 180px;
  overflow: auto;
  scrollbar-width: thin;
  border: 1px solid var(--ieum-dialog-line-soft);
  border-radius: 4px;
  background: var(--ieum-dialog-field-surface);
}

.ieum-toc-mark-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--ieum-dialog-line-soft);
  font-size: 12px;
}

.ieum-toc-mark-row:last-child {
  border-bottom: none;
}

.ieum-toc-mark-term {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ieum-dialog-ink);
}

.ieum-toc-mark-page {
  flex: 0 0 auto;
  color: var(--ieum-dialog-ink-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ieum-toc-mark-delete {
  flex: 0 0 auto;
  height: 22px;
  min-width: 0;
  padding: 0 8px;
  font-size: 11px;
}

.ieum-toc-empty {
  padding: 12px 10px;
  text-align: center;
  color: var(--ieum-dialog-ink-muted);
  font-size: 11px;
}
`

/**
 * Install the compact layout rules for TOC and Index dialogs once per document.
 * All colors reference `--ieum-dialog-*` tokens defined by `dialog-theme.mjs`.
 */
export function installTocDialogStyles(doc = globalThis.document) {
  if (!doc?.head) return false
  let style = doc.getElementById(TOC_DIALOG_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = TOC_DIALOG_STYLE_ID
    doc.head.appendChild(style)
  }
  if (style.textContent !== TOC_DIALOG_CSS) {
    style.textContent = TOC_DIALOG_CSS
  }
  return true
}

function fmt(template, params = {}) {
  if (typeof template !== 'string') return ''
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`,
  )
}

function labelOf(labels, key, fallback = '') {
  const val = labels?.[key]
  return typeof val === 'string' && val.length > 0 ? val : fallback
}

function resolveModalParts(options) {
  const studio = getStudioModalParts()
  return {
    ModalDialog: options?.ModalDialog ?? studio.ModalDialog ?? null,
    showToast: options?.showToast ?? studio.showToast ?? null,
  }
}

function notify(showToast, message) {
  if (!message) return
  try {
    showToast?.({ message })
  } catch {
    // editor may be tearing down
  }
}

function readFromHost(host, options, fn) {
  if (typeof options?.readDoc === 'function') {
    return options.readDoc(fn)
  }
  if (typeof host?.read === 'function') {
    return host.read(fn)
  }
  throw new Error('No document reader available on host')
}

function runDocumentEdit(host, options, actionName, fn) {
  let refused = null
  const wrapped = (doc) => {
    const res = fn(doc)
    if (!res || res.ok !== true) {
      refused = res ?? { ok: false, reason: 'failed' }
      throw EDIT_ABORT
    }
    return res
  }

  try {
    if (typeof options?.runEdit === 'function') {
      return options.runEdit(actionName, wrapped)
    }
    if (typeof host?.transaction === 'function') {
      return host.transaction(actionName, (tx) => wrapped(tx.doc()))
    }
    throw new Error('No edit runner available on host')
  } catch (err) {
    if (err === EDIT_ABORT) return refused
    throw err
  }
}

function readCaretRaw(host, options) {
  if (typeof options?.getCaret === 'function') {
    return options.getCaret()
  }
  if (typeof host?.getCaret === 'function') {
    return host.getCaret()
  }
  return undefined
}

function readSelectionRaw(host, options) {
  if (typeof options?.getSelectionText === 'function') {
    return options.getSelectionText()
  }
  if (typeof host?.getSelectionText === 'function') {
    return host.getSelectionText()
  }
  return null
}

function normalizeCaretCoords(pos) {
  if (!pos || typeof pos !== 'object') return null
  if (
    pos.inHeaderFooter === true ||
    pos.isHeader === true ||
    pos.isFooter === true ||
    pos.inNote === true ||
    pos.inFootnote === true ||
    pos.inEndnote === true ||
    pos.isTextBox === true ||
    pos.inTextBox === true
  ) {
    return null
  }
  const sec = pos.sec ?? pos.sectionIndex
  const para = pos.parentParaIndex ?? pos.para ?? pos.paraIndex ?? pos.paragraphIndex
  if (!Number.isInteger(sec) || !Number.isInteger(para) || sec < 0 || para < 0) {
    return null
  }
  return { sec, para }
}

function isParaInRange(sec, para, range) {
  if (!range?.start || !range?.end) return false
  const afterStart = sec > range.start.sec || (sec === range.start.sec && para >= range.start.para)
  const beforeEnd = sec < range.end.sec || (sec === range.end.sec && para <= range.end.para)
  return afterStart && beforeEnd
}

/**
 * Return the TOC kind (`'body' | 'table' | 'figure' | 'equation'`) containing
 * the cursor position `pos`, or `null` when the caret is outside all `차례:` ranges.
 */
export function isCaretInTocRange(doc, pos) {
  const coords = normalizeCaretCoords(pos)
  if (!doc || !coords) return null
  const ranges = listTocRanges(doc)
  for (const range of ranges) {
    if (isParaInRange(coords.sec, coords.para, range)) {
      return range.kind
    }
  }
  return null
}

/**
 * Return whether the cursor position `pos` lies inside a `색인블록:` range.
 */
export function isCaretInIndexRange(doc, pos) {
  const coords = normalizeCaretCoords(pos)
  if (!doc || !coords) return false
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
  return ranges.some((range) => isParaInRange(coords.sec, coords.para, range))
}

function resolveCaretPlace(host, options) {
  if (options?.place && typeof options.place === 'object') {
    return options.place
  }
  const caret = readCaretRaw(host, options)
  if (caret === undefined) {
    return { sec: 0, para: 0, offset: 0 }
  }
  if (caret === null) {
    return { inHeaderFooter: true }
  }
  const inTable =
    caret.inTable === true || (Array.isArray(caret.cellPath) && caret.cellPath.length > 0)
  const sec = caret.sec ?? caret.sectionIndex
  const para = caret.parentParaIndex ?? caret.para ?? caret.paraIndex ?? caret.paragraphIndex
  const offset = caret.offset ?? caret.charOffset ?? caret.charPos ?? 0
  if (inTable) {
    return {
      sec,
      para,
      offset,
      inTable: true,
      ...(Array.isArray(caret.cellPath) ? { cellPath: caret.cellPath } : {}),
    }
  }
  if (
    caret.inHeaderFooter ||
    caret.inFootnote ||
    caret.inEndnote ||
    caret.inNote ||
    caret.isTextBox ||
    caret.inTextBox
  ) {
    return caret
  }
  return { sec, para, offset }
}

function resolveAppStyleMap(options) {
  return typeof options?.appStyleMap === 'function' ? options.appStyleMap() : options?.appStyleMap
}

function resolveMadeContents(options) {
  return typeof options?.getMadeContents === 'function' ? options.getMadeContents() : undefined
}

function defaultTocTitleForKind(kind, labels) {
  const map = {
    body: labelOf(labels, 'tocDefaultTitleBody', DEFAULT_TOC_TITLES.body),
    table: labelOf(labels, 'tocDefaultTitleTable', DEFAULT_TOC_TITLES.table),
    figure: labelOf(labels, 'tocDefaultTitleFigure', DEFAULT_TOC_TITLES.figure),
    equation: labelOf(labels, 'tocDefaultTitleEquation', DEFAULT_TOC_TITLES.equation),
  }
  return map[kind] ?? map.body
}

function highlightLegacyRange(host, legacy, options) {
  if (!legacy) return false
  const target = {
    sec: legacy.sec,
    startPara: legacy.startPara,
    endPara: legacy.endPara,
  }
  if (typeof options?.highlightRange === 'function') {
    try {
      return Boolean(options.highlightRange(target))
    } catch {
      return false
    }
  }
  let startLen
  try {
    startLen = readFromHost(host, options, (doc) =>
      typeof doc.getParagraphLength === 'function'
        ? doc.getParagraphLength(legacy.sec, legacy.startPara)
        : 0,
    )
  } catch {
    startLen = 0
  }
  if (typeof host?.selectTextRange === 'function') {
    try {
      return Boolean(
        host.selectTextRange({
          section: legacy.sec,
          paragraph: legacy.startPara,
          charOffset: 0,
          length: Math.max(0, startLen),
        }),
      )
    } catch {
      return false
    }
  }
  if (typeof host?.automation?.execute === 'function') {
    try {
      host.automation.execute('ext:ieum-reveal', {
        sec: legacy.sec,
        para: legacy.startPara,
        offset: 0,
        length: Math.max(0, startLen),
      })
      return true
    } catch {
      return false
    }
  }
  return false
}

function applyFooterLabels(dialogEl, confirmText, cancelText) {
  if (!dialogEl) return
  const primary = dialogEl.querySelector('.dialog-btn-primary')
  if (primary && confirmText) primary.textContent = confirmText
  const cancel = dialogEl.querySelector('.dialog-btn:not(.dialog-btn-primary)')
  if (cancel && cancelText) cancel.textContent = cancelText
}

function formatDiffLine(text) {
  if (!text) return '—'
  return String(text).replace(/\t/g, ' ··· ')
}

/**
 * Open a confirmation dialog asking whether to replace a detected legacy TOC
 * (or an already-existing marked TOC). Returns the dialog instance or `null`.
 */
export function openConfirmActionDialog(config, options = {}) {
  const { ModalDialog } = resolveModalParts(options)
  if (!ModalDialog) return null
  const DOC = options.document ?? globalThis.document
  installTocDialogStyles(DOC)

  let decided = false

  class ConfirmActionDialog extends ModalDialog {
    constructor() {
      super(config.title, config.width ?? 420)
    }

    createBody() {
      const body = DOC.createElement('div')
      const msg = DOC.createElement('p')
      msg.className = 'ieum-toc-message'
      msg.textContent = config.message
      body.appendChild(msg)

      const hints = Array.isArray(config.hints)
        ? config.hints.filter((h) => typeof h === 'string' && h.length > 0)
        : config.hint
          ? [config.hint]
          : []
      for (const hintText of hints) {
        const hint = DOC.createElement('p')
        hint.className = 'ieum-toc-hint'
        hint.textContent = hintText
        body.appendChild(hint)
      }

      if (Array.isArray(config.previewItems) && config.previewItems.length > 0) {
        const list = DOC.createElement('div')
        list.className = 'ieum-toc-diff-list'
        list.dataset.role = 'preview-items'
        const visible = config.previewItems.slice(0, MAX_MARK_ALL_PREVIEW_ITEMS)
        for (const item of visible) {
          const row = DOC.createElement('div')
          row.className = 'ieum-toc-preview-row'

          const main = DOC.createElement('div')
          main.className = 'ieum-toc-preview-main'
          if (item.matchedText) {
            const matchEl = DOC.createElement('span')
            matchEl.className = 'ieum-toc-preview-match'
            matchEl.dataset.preview = 'match'
            matchEl.textContent = item.matchedText
            main.appendChild(matchEl)
          }
          if (item.context) {
            const ctxEl = DOC.createElement('span')
            ctxEl.className = 'ieum-toc-preview-context'
            ctxEl.dataset.preview = 'context'
            ctxEl.textContent = item.context
            main.appendChild(ctxEl)
          }

          const pageEl = DOC.createElement('span')
          pageEl.className = 'ieum-toc-preview-page'
          pageEl.dataset.preview = 'page'
          pageEl.textContent = item.pageLabel ?? ''

          row.append(main, pageEl)
          list.appendChild(row)
        }
        if (config.previewItems.length > visible.length && config.moreItemsText) {
          const more = DOC.createElement('div')
          more.className = 'ieum-toc-hint'
          more.textContent = config.moreItemsText
          list.appendChild(more)
        }
        body.appendChild(list)
      }

      if (Array.isArray(config.modifiedLines) && config.modifiedLines.length > 0) {
        const list = DOC.createElement('div')
        list.className = 'ieum-toc-diff-list'
        list.dataset.role = 'modified-lines'
        const visible = config.modifiedLines.slice(0, MAX_DIFF_PREVIEW_LINES)
        for (const diff of visible) {
          const item = DOC.createElement('div')
          item.className = 'ieum-toc-diff-item'

          const beforeRow = DOC.createElement('div')
          beforeRow.className = 'ieum-toc-diff-line'
          const beforeTag = DOC.createElement('span')
          beforeTag.className = 'ieum-toc-diff-tag'
          beforeTag.textContent = `${config.beforeLabel ?? ''}:`
          const beforeText = DOC.createElement('span')
          beforeText.className = 'ieum-toc-diff-text'
          beforeText.dataset.diff = 'expected'
          beforeText.textContent = formatDiffLine(diff.expected)
          beforeRow.append(beforeTag, beforeText)

          const afterRow = DOC.createElement('div')
          afterRow.className = 'ieum-toc-diff-line'
          const afterTag = DOC.createElement('span')
          afterTag.className = 'ieum-toc-diff-tag'
          afterTag.textContent = `${config.afterLabel ?? ''}:`
          const afterText = DOC.createElement('span')
          afterText.className = 'ieum-toc-diff-text'
          afterText.dataset.diff = 'actual'
          afterText.textContent = formatDiffLine(diff.actual)
          afterRow.append(afterTag, afterText)

          item.append(beforeRow, afterRow)
          list.appendChild(item)
        }
        if (config.modifiedLines.length > visible.length && config.moreLinesText) {
          const more = DOC.createElement('div')
          more.className = 'ieum-toc-hint'
          more.textContent = config.moreLinesText
          list.appendChild(more)
        }
        body.appendChild(list)
      }

      return body
    }

    show() {
      super.show()
      applyFooterLabels(this.dialog, config.confirmLabel, config.cancelLabel)
    }

    onConfirm() {
      decided = true
      config.onConfirm?.()
      return true
    }

    hide() {
      super.hide()
      if (!decided) {
        decided = true
        config.onCancel?.()
      }
    }
  }

  const dlg = new ConfirmActionDialog()
  dlg.show()
  return dlg
}

function openLegacyTocConfirmDialog(labels, options, onConfirm, onCancel) {
  return openConfirmActionDialog(
    {
      title: labelOf(labels, 'tocLegacyConfirmTitle', 'Replace Existing Table of Contents'),
      message: labelOf(labels, 'tocLegacyConfirmMessage'),
      hint: labelOf(labels, 'tocLegacyConfirmHint'),
      confirmLabel: labelOf(labels, 'tocLegacyReplaceConfirm'),
      cancelLabel: labelOf(labels, 'tocDialogCancel'),
      onConfirm,
      onCancel,
    },
    options,
  )
}

function openManualEditConfirmDialog(modifiedLines, labels, options, onConfirm, onCancel) {
  const extraCount = Math.max(0, modifiedLines.length - MAX_DIFF_PREVIEW_LINES)
  return openConfirmActionDialog(
    {
      title: labelOf(labels, 'manualEditConfirmTitle', 'Overwrite Manual Edits'),
      message: labelOf(labels, 'manualEditConfirmMessage'),
      confirmLabel: labelOf(labels, 'manualEditOverwriteConfirm'),
      cancelLabel: labelOf(labels, 'tocDialogCancel'),
      beforeLabel: labelOf(labels, 'manualEditBeforeLabel'),
      afterLabel: labelOf(labels, 'manualEditAfterLabel'),
      moreLinesText:
        extraCount > 0 ? fmt(labelOf(labels, 'manualEditMoreLines'), { count: extraCount }) : '',
      modifiedLines,
      width: 460,
      onConfirm,
      onCancel,
    },
    options,
  )
}

function reportTocFailure(res, kind, labels, showToast, setStatus) {
  let message
  if (res?.reason === 'in_table') {
    message = labelOf(labels, 'tocErrorInTable')
  } else if (res?.reason === 'unsupported_place') {
    message = labelOf(labels, 'tocErrorUnsupportedPlace')
  } else if (res?.reason === 'has_objects' || res?.reason === 'memo_removal_requires_approval') {
    message = labelOf(labels, 'tocErrorHasObjects')
  } else if (res?.reason === 'multi_section_range') {
    message = labelOf(labels, 'tocErrorMultiSection')
  } else if (res?.reason === 'no_entries') {
    message = labelOf(labels, kind === 'body' ? 'tocErrorNoHeadings' : 'tocErrorNoCaptions')
  } else if (res?.reason === 'not_found') {
    message = labelOf(labels, 'tocRefreshNotFound')
  } else {
    message = fmt(labelOf(labels, 'tocErrorGeneric'), {
      error: res?.error ?? res?.reason ?? '',
    })
  }
  setStatus?.(message, 'error')
  notify(showToast, message)
}

function reportTocSuccess(res, isRefresh, labels, showToast) {
  if (res?.objectCaptionsUnavailable) {
    notify(showToast, labelOf(labels, 'tocObjectCaptionsUnavailable'))
    return
  }
  const key = isRefresh ? 'tocRefreshedToast' : 'tocCreatedToast'
  notify(showToast, fmt(labelOf(labels, key), { count: res?.count ?? 0 }))
}

/**
 * Open the Create Table of Contents modal dialog.
 * Supports body, table, figure, and equation TOCs, dotted-tab and borderless-table layouts,
 * legacy TOC detection with range highlight + confirmation, and existing TOC replacement.
 */
export function openCreateTocDialog(host, labels, options = {}) {
  const { ModalDialog, showToast } = resolveModalParts(options)
  if (!ModalDialog) return null
  const DOC = options.document ?? globalThis.document
  installTocDialogStyles(DOC)

  const initialKind = options.initialKind ?? 'body'
  const state = {
    kind: initialKind,
    title: defaultTocTitleForKind(initialKind, labels),
    titleCustomized: false,
    maxLevel: DEFAULT_TOC_MAX_LEVEL,
    layout: TOC_LAYOUTS[0],
    links: true,
  }

  class CreateTocDialog extends ModalDialog {
    constructor() {
      super(labelOf(labels, 'tocCreateTitle', 'Create Table of Contents'), 420)
      this.statusEl = null
      this.levelRowEl = null
      this.titleInputEl = null
    }

    shouldConfirmOnEnter(target) {
      return target?.tagName === 'INPUT'
    }

    setStatus(text, tone = 'info') {
      if (!this.statusEl) return
      this.statusEl.textContent = text
      this.statusEl.dataset.tone = tone
    }

    createBody() {
      const form = DOC.createElement('div')
      form.className = 'ieum-toc-form'

      // 1. TOC kind selector
      const kindRow = DOC.createElement('div')
      kindRow.className = 'ieum-toc-row'
      const kindLabel = DOC.createElement('label')
      kindLabel.className = 'dialog-label'
      kindLabel.textContent = labelOf(labels, 'tocKindLabel')
      const kindSelect = DOC.createElement('select')
      kindSelect.className = 'dialog-select ieum-toc-field-grow'
      kindSelect.dataset.field = 'kind'
      for (const [value, key] of [
        ['body', 'tocKindBody'],
        ['table', 'tocKindTable'],
        ['figure', 'tocKindFigure'],
        ['equation', 'tocKindEquation'],
      ]) {
        const opt = DOC.createElement('option')
        opt.value = value
        opt.textContent = labelOf(labels, key)
        opt.selected = value === state.kind
        kindSelect.appendChild(opt)
      }
      kindSelect.addEventListener('change', () => {
        state.kind = kindSelect.value
        if (!state.titleCustomized && this.titleInputEl) {
          state.title = defaultTocTitleForKind(state.kind, labels)
          this.titleInputEl.value = state.title
        }
        if (this.levelRowEl) {
          this.levelRowEl.hidden = state.kind !== 'body'
        }
        this.setStatus('')
      })
      kindRow.append(kindLabel, kindSelect)
      form.appendChild(kindRow)

      // 2. Title input
      const titleRow = DOC.createElement('div')
      titleRow.className = 'ieum-toc-row'
      const titleLabel = DOC.createElement('label')
      titleLabel.className = 'dialog-label'
      titleLabel.textContent = labelOf(labels, 'tocTitleLabel')
      const titleInput = DOC.createElement('input')
      titleInput.type = 'text'
      titleInput.className = 'dialog-text-input ieum-toc-field-grow'
      titleInput.dataset.field = 'title'
      titleInput.value = state.title
      titleInput.placeholder = labelOf(labels, 'tocTitlePlaceholder')
      titleInput.addEventListener('input', () => {
        state.title = titleInput.value
        state.titleCustomized = true
        this.setStatus('')
      })
      this.titleInputEl = titleInput
      titleRow.append(titleLabel, titleInput)
      form.appendChild(titleRow)

      // 3. Max heading level (1..10, shown for body TOC)
      const levelRow = DOC.createElement('div')
      levelRow.className = 'ieum-toc-row'
      levelRow.dataset.row = 'maxLevel'
      levelRow.hidden = state.kind !== 'body'
      const levelLabel = DOC.createElement('label')
      levelLabel.className = 'dialog-label'
      levelLabel.textContent = labelOf(labels, 'tocMaxLevelLabel')
      const levelSelect = DOC.createElement('select')
      levelSelect.className = 'dialog-select ieum-toc-field-grow'
      levelSelect.dataset.field = 'maxLevel'
      for (let lvl = 1; lvl <= 10; lvl++) {
        const opt = DOC.createElement('option')
        opt.value = String(lvl)
        opt.textContent = fmt(labelOf(labels, 'tocLevelOption', '{level}'), { level: lvl })
        opt.selected = lvl === state.maxLevel
        levelSelect.appendChild(opt)
      }
      levelSelect.addEventListener('change', () => {
        state.maxLevel = Number(levelSelect.value)
      })
      this.levelRowEl = levelRow
      levelRow.append(levelLabel, levelSelect)
      form.appendChild(levelRow)

      // 4. Layout selector
      const layoutRow = DOC.createElement('div')
      layoutRow.className = 'ieum-toc-row'
      const layoutLabel = DOC.createElement('label')
      layoutLabel.className = 'dialog-label'
      layoutLabel.textContent = labelOf(labels, 'tocLayoutLabel')
      const layoutSelect = DOC.createElement('select')
      layoutSelect.className = 'dialog-select ieum-toc-field-grow'
      layoutSelect.dataset.field = 'layout'
      for (const [value, key] of [
        ['dotted-tab', 'tocLayoutDottedTab'],
        ['table', 'tocLayoutTable'],
      ]) {
        const opt = DOC.createElement('option')
        opt.value = value
        opt.textContent = labelOf(labels, key)
        opt.selected = value === state.layout
        layoutSelect.appendChild(opt)
      }
      layoutSelect.addEventListener('change', () => {
        state.layout = layoutSelect.value
      })
      layoutRow.append(layoutLabel, layoutSelect)
      form.appendChild(layoutRow)

      // 5. Links checkbox
      const linksWrap = DOC.createElement('label')
      linksWrap.className = 'dialog-checkbox ieum-toc-checkbox-row'
      const linksBox = DOC.createElement('input')
      linksBox.type = 'checkbox'
      linksBox.dataset.field = 'links'
      linksBox.checked = state.links
      linksBox.addEventListener('change', () => {
        state.links = linksBox.checked
      })
      linksWrap.append(linksBox, labelOf(labels, 'tocLinksLabel'))
      form.appendChild(linksWrap)

      // Inline status / error area
      const status = DOC.createElement('div')
      status.className = 'ieum-toc-status'
      status.dataset.role = 'status'
      this.statusEl = status
      form.appendChild(status)

      return form
    }

    show() {
      super.show()
      applyFooterLabels(
        this.dialog,
        labelOf(labels, 'tocCreateConfirm'),
        labelOf(labels, 'tocDialogCancel'),
      )
    }

    onConfirm() {
      const place = resolveCaretPlace(host, options)
      const made = resolveMadeContents(options)
      const insertOpts = {
        kind: state.kind,
        title: state.title.trim() ? state.title.trim() : null,
        maxLevel: state.maxLevel,
        layout: state.layout,
        links: state.links,
        ...(options.tocHelpers ? { helpers: options.tocHelpers } : {}),
        ...(made ? { made } : {}),
        appStyleMap: resolveAppStyleMap(options),
      }
      const res = runDocumentEdit(host, options, 'toc-create', (doc) =>
        insertTocBlock(doc, place, insertOpts),
      )
      if (res?.ok) {
        reportTocSuccess(res, false, labels, showToast)
        options.onEdited?.('toc-create', res)
        return true
      }

      if (res?.reason === 'legacy_toc_found') {
        highlightLegacyRange(host, res.legacy, options)
        openLegacyTocConfirmDialog(labels, options, () => {
          const replaced = runDocumentEdit(host, options, 'toc-create', (doc) =>
            insertTocBlock(doc, place, { ...insertOpts, replaceLegacy: true }),
          )
          if (replaced?.ok) {
            reportTocSuccess(replaced, false, labels, showToast)
            options.onEdited?.('toc-create', replaced)
          } else {
            reportTocFailure(replaced, state.kind, labels, showToast)
          }
        })
        return true
      }

      if (res?.reason === 'toc_exists') {
        openConfirmActionDialog(
          {
            title: labelOf(labels, 'tocExistsConfirmTitle', 'Replace Table of Contents'),
            message: labelOf(labels, 'tocExistsConfirmMessage'),
            confirmLabel: labelOf(labels, 'tocLegacyReplaceConfirm'),
            cancelLabel: labelOf(labels, 'tocDialogCancel'),
            onConfirm: () => {
              const replaced = runDocumentEdit(host, options, 'toc-create', (doc) =>
                insertTocBlock(doc, place, { ...insertOpts, replaceExisting: true }),
              )
              if (replaced?.ok) {
                reportTocSuccess(replaced, false, labels, showToast)
                options.onEdited?.('toc-create', replaced)
              } else {
                reportTocFailure(replaced, state.kind, labels, showToast)
              }
            },
          },
          options,
        )
        return true
      }

      reportTocFailure(res, state.kind, labels, showToast, (m, t) => this.setStatus(m, t))
      return false
    }
  }

  const dlg = new CreateTocDialog()
  dlg.show()
  return dlg
}

/**
 * Refresh the TOC block at the caret (if inside a marked TOC range), or all marked TOCs
 * in the document. Handles legacy TOC conversion and manual-edit confirmation dialogs.
 */
export function runRefreshTocDialog(host, labels, options = {}) {
  const { showToast } = resolveModalParts(options)
  const made = resolveMadeContents(options)
  const sharedOpts = {
    ...(options.tocHelpers ? { helpers: options.tocHelpers } : {}),
    ...(made ? { made } : {}),
    appStyleMap: resolveAppStyleMap(options),
  }

  let targetKinds = []
  if (options.kind) {
    targetKinds = [options.kind]
  } else {
    const caret = readCaretRaw(host, options)
    targetKinds = readFromHost(host, options, (doc) => {
      const caretKind = caret ? isCaretInTocRange(doc, caret) : null
      if (caretKind) return [caretKind]
      const marked = listTocRanges(doc)
      if (marked.length > 0) return marked.map((r) => r.kind)
      const legacy = detectLegacyToc(doc, sharedOpts)
      return legacy ? ['body'] : []
    })
  }

  if (targetKinds.length === 0) {
    notify(showToast, labelOf(labels, 'tocRefreshNotFound'))
    return { ok: false, reason: 'not_found' }
  }

  const refreshSingle = (kind, onDone) => {
    const res = runDocumentEdit(host, options, 'toc-refresh', (doc) =>
      refreshTocBlock(doc, { ...sharedOpts, kind }),
    )
    if (res?.ok) {
      reportTocSuccess(res, true, labels, showToast)
      options.onEdited?.('toc-refresh', res)
      onDone?.(res)
      return res
    }
    if (res?.reason === 'legacy_toc_found') {
      highlightLegacyRange(host, res.legacy, options)
      openLegacyTocConfirmDialog(
        labels,
        options,
        () => {
          const replaced = runDocumentEdit(host, options, 'toc-refresh', (doc) =>
            refreshTocBlock(doc, { ...sharedOpts, kind, replaceLegacy: true }),
          )
          if (replaced?.ok) {
            reportTocSuccess(replaced, true, labels, showToast)
            options.onEdited?.('toc-refresh', replaced)
          } else {
            reportTocFailure(replaced, kind, labels, showToast)
          }
          onDone?.(replaced)
        },
        () => onDone?.(res),
      )
      return res
    }
    if (res?.reason === 'manual_edits') {
      openManualEditConfirmDialog(
        res.modifiedLines ?? [],
        labels,
        options,
        () => {
          const forced = runDocumentEdit(host, options, 'toc-refresh', (doc) =>
            refreshTocBlock(doc, { ...sharedOpts, kind, allowOverwriteManual: true }),
          )
          if (forced?.ok) {
            reportTocSuccess(forced, true, labels, showToast)
            options.onEdited?.('toc-refresh', forced)
          } else {
            reportTocFailure(forced, kind, labels, showToast)
          }
          onDone?.(forced)
        },
        () => onDone?.(res),
      )
      return res
    }
    reportTocFailure(res, kind, labels, showToast)
    onDone?.(res)
    return res
  }

  if (targetKinds.length === 1) {
    return refreshSingle(targetKinds[0])
  }

  // Multiple marked TOCs: attempt all in a single undo step first; if any has manual edits,
  // roll back cleanly and step through each kind so only edited TOCs prompt the user.
  const batchRes = runDocumentEdit(host, options, 'toc-refresh', (doc) => {
    let totalCount = 0
    let objectCaptionsUnavailable = false
    const results = []
    for (const kind of targetKinds) {
      const r = refreshTocBlock(doc, { ...sharedOpts, kind })
      if (!r?.ok) {
        return { ok: false, reason: r?.reason ?? 'failed', failedKind: kind, detail: r }
      }
      totalCount += r.count ?? 0
      if (r.objectCaptionsUnavailable) objectCaptionsUnavailable = true
      results.push(r)
    }
    return { ok: true, count: totalCount, objectCaptionsUnavailable, results }
  })

  if (batchRes?.ok) {
    reportTocSuccess(batchRes, true, labels, showToast)
    options.onEdited?.('toc-refresh', batchRes)
    return batchRes
  }

  // Fall back to sequential per-kind refresh (prompts on manual edits, refreshes the rest).
  const queue = [...targetKinds]
  const step = () => {
    if (queue.length === 0) return
    const nextKind = queue.shift()
    refreshSingle(nextKind, () => step())
  }
  step()
  return batchRes
}

/**
 * Open the Mark Index Entry modal dialog.
 * Pre-fills the term from the current selection or word at the caret, supports
 * single-mark and mark-all modes (with non-body skip reporting), and lists all
 * existing `색인:` marks with live per-entry deletion.
 */
export function openMarkIndexDialog(host, labels, options = {}) {
  const { ModalDialog, showToast } = resolveModalParts(options)
  if (!ModalDialog) return null
  const DOC = options.document ?? globalThis.document
  installTocDialogStyles(DOC)

  let initialTerm = ''
  if (typeof options.selectedText === 'string' && options.selectedText.trim()) {
    initialTerm = options.selectedText.trim().split(/\r?\n/)[0].trim()
  } else {
    const sel = readSelectionRaw(host, options)
    if (typeof sel?.text === 'string' && sel.text.trim()) {
      initialTerm = sel.text.trim().split(/\r?\n/)[0].trim()
    }
  }
  if (!initialTerm) {
    const place = resolveCaretPlace(host, options)
    try {
      const resolved = readFromHost(host, options, (doc) => resolveIndexWordAt(doc, place))
      if (resolved?.word) initialTerm = resolved.word
    } catch {
      // caret outside body or document not readable
    }
  }

  const state = {
    term: initialTerm,
    subTerm: '',
    markAll: false,
  }

  class MarkIndexDialog extends ModalDialog {
    constructor() {
      super(labelOf(labels, 'indexMarkTitle', 'Mark Index Entry'), 440)
      this.statusEl = null
      this.marksTitleEl = null
      this.marksListEl = null
    }

    shouldConfirmOnEnter(target) {
      return target?.tagName === 'INPUT'
    }

    setStatus(text, tone = 'info') {
      if (!this.statusEl) return
      this.statusEl.textContent = text
      this.statusEl.dataset.tone = tone
    }

    renderMarksList() {
      if (!this.marksListEl) return
      let marks
      try {
        marks = readFromHost(host, options, (doc) => listIndexMarks(doc))
      } catch {
        marks = []
      }
      if (this.marksTitleEl) {
        this.marksTitleEl.textContent = fmt(labelOf(labels, 'indexMarksListTitle'), {
          count: marks.length,
        })
      }
      this.marksListEl.replaceChildren()
      if (marks.length === 0) {
        const empty = DOC.createElement('div')
        empty.className = 'ieum-toc-empty'
        empty.textContent = labelOf(labels, 'indexMarksListEmpty')
        this.marksListEl.appendChild(empty)
        return
      }
      for (const mark of marks) {
        const row = DOC.createElement('div')
        row.className = 'ieum-toc-mark-row'
        row.dataset.markId = mark.id

        const termSpan = DOC.createElement('span')
        termSpan.className = 'ieum-toc-mark-term'
        const display = mark.subTerm ? `${mark.term} › ${mark.subTerm}` : mark.term
        termSpan.textContent = display
        termSpan.title = display

        const pageSpan = DOC.createElement('span')
        pageSpan.className = 'ieum-toc-mark-page'
        pageSpan.textContent = fmt(labelOf(labels, 'indexMarkPageBadge', '{page}'), {
          page: mark.pageLabel || mark.page,
        })

        const delBtn = DOC.createElement('button')
        delBtn.type = 'button'
        delBtn.className = 'dialog-btn ieum-toc-mark-delete'
        delBtn.dataset.action = 'delete-mark'
        delBtn.dataset.markId = mark.id
        delBtn.textContent = labelOf(labels, 'indexMarkDeleteBtn')
        delBtn.addEventListener('click', () => {
          const removed = runDocumentEdit(host, options, 'index-mark', (doc) =>
            removeIndexMark(doc, mark.id),
          )
          if (removed?.ok) {
            this.renderMarksList()
            const msg = labelOf(labels, 'indexMarkRemovedToast')
            this.setStatus(msg, 'info')
            notify(showToast, msg)
            options.onEdited?.('index-mark-remove', removed)
          } else {
            const msg = fmt(labelOf(labels, 'indexErrorGeneric'), {
              error: removed?.error ?? removed?.reason ?? '',
            })
            this.setStatus(msg, 'error')
            notify(showToast, msg)
          }
        })

        row.append(termSpan, pageSpan, delBtn)
        this.marksListEl.appendChild(row)
      }
    }

    createBody() {
      const form = DOC.createElement('div')
      form.className = 'ieum-toc-form'

      // 1. Primary entry input
      const termRow = DOC.createElement('div')
      termRow.className = 'ieum-toc-row'
      const termLabel = DOC.createElement('label')
      termLabel.className = 'dialog-label'
      termLabel.textContent = labelOf(labels, 'indexMarkTermLabel')
      const termInput = DOC.createElement('input')
      termInput.type = 'text'
      termInput.className = 'dialog-text-input ieum-toc-field-grow'
      termInput.dataset.field = 'term'
      termInput.value = state.term
      termInput.placeholder = labelOf(labels, 'indexMarkTermPlaceholder')
      termInput.addEventListener('input', () => {
        state.term = termInput.value
        this.setStatus('')
      })
      termRow.append(termLabel, termInput)
      form.appendChild(termRow)

      // 2. Sub-entry input
      const subRow = DOC.createElement('div')
      subRow.className = 'ieum-toc-row'
      const subLabel = DOC.createElement('label')
      subLabel.className = 'dialog-label'
      subLabel.textContent = labelOf(labels, 'indexMarkSubTermLabel')
      const subInput = DOC.createElement('input')
      subInput.type = 'text'
      subInput.className = 'dialog-text-input ieum-toc-field-grow'
      subInput.dataset.field = 'subTerm'
      subInput.value = state.subTerm
      subInput.placeholder = labelOf(labels, 'indexMarkSubTermPlaceholder')
      subInput.addEventListener('input', () => {
        state.subTerm = subInput.value
        this.setStatus('')
      })
      subRow.append(subLabel, subInput)
      form.appendChild(subRow)

      // 3. Mark-all checkbox
      const allWrap = DOC.createElement('label')
      allWrap.className = 'dialog-checkbox ieum-toc-checkbox-row'
      const allBox = DOC.createElement('input')
      allBox.type = 'checkbox'
      allBox.dataset.field = 'markAll'
      allBox.checked = state.markAll
      allBox.addEventListener('change', () => {
        state.markAll = allBox.checked
        this.setStatus('')
      })
      allWrap.append(allBox, labelOf(labels, 'indexMarkAllLabel'))
      form.appendChild(allWrap)

      // Inline status / error area
      const status = DOC.createElement('div')
      status.className = 'ieum-toc-status'
      status.dataset.role = 'status'
      this.statusEl = status
      form.appendChild(status)

      // 4. Existing index marks list + delete buttons
      const section = DOC.createElement('div')
      section.className = 'dialog-section ieum-toc-marks-section'
      const title = DOC.createElement('div')
      title.className = 'dialog-section-title'
      this.marksTitleEl = title
      const list = DOC.createElement('div')
      list.className = 'ieum-toc-marks-list'
      list.dataset.role = 'marks-list'
      this.marksListEl = list
      section.append(title, list)
      form.appendChild(section)

      this.renderMarksList()
      return form
    }

    show() {
      super.show()
      applyFooterLabels(
        this.dialog,
        labelOf(labels, 'indexMarkConfirm'),
        labelOf(labels, 'tocDialogClose'),
      )
    }

    onConfirm() {
      const term = state.term.trim()
      const subTerm = state.subTerm.trim()
      if (!term) {
        this.setStatus(labelOf(labels, 'indexMarkErrorEmpty'), 'error')
        return false
      }

      if (state.markAll) {
        const preview = readFromHost(host, options, (doc) =>
          previewIndexMarksAll(doc, { term, query: term, subTerm }),
        )
        if (!preview?.ok) {
          const msg =
            preview?.reason === 'invalid_term'
              ? labelOf(labels, 'indexMarkErrorEmpty')
              : fmt(labelOf(labels, 'indexErrorGeneric'), {
                  error: preview?.error ?? preview?.reason ?? '',
                })
          this.setStatus(msg, 'error')
          notify(showToast, msg)
          return false
        }

        const candidates = (preview.matches ?? []).filter((m) => !m.alreadyMarked)
        if (candidates.length === 0) {
          const baseMsg = labelOf(labels, 'indexMarkAllNotFound')
          const msg =
            preview.skippedNonBody > 0
              ? `${baseMsg} (${fmt(labelOf(labels, 'indexMarkAllPreviewSkippedNote'), {
                  count: preview.skippedNonBody,
                })})`
              : baseMsg
          this.setStatus(msg, 'error')
          notify(showToast, msg)
          return false
        }

        const hints = []
        if (preview.includeParticles) {
          hints.push(labelOf(labels, 'indexMarkAllPreviewParticlesNote'))
        }
        if (preview.skippedNonBody > 0) {
          hints.push(
            fmt(labelOf(labels, 'indexMarkAllPreviewSkippedNote'), {
              count: preview.skippedNonBody,
            }),
          )
        }
        const previewItems = candidates.map((m) => ({
          matchedText: m.matchedText,
          context: m.context,
          pageLabel: fmt(labelOf(labels, 'indexMarkPageBadge', '{page}'), {
            page: m.pageLabel || m.page,
          }),
        }))
        const extraCount = Math.max(0, candidates.length - MAX_MARK_ALL_PREVIEW_ITEMS)

        openConfirmActionDialog(
          {
            title: labelOf(labels, 'indexMarkAllPreviewTitle', 'Confirm Mark All'),
            message: fmt(labelOf(labels, 'indexMarkAllPreviewMessage'), {
              count: candidates.length,
            }),
            hints,
            previewItems,
            moreItemsText:
              extraCount > 0
                ? fmt(labelOf(labels, 'indexMarkAllPreviewMore'), { count: extraCount })
                : '',
            confirmLabel: labelOf(labels, 'indexMarkAllPreviewConfirm'),
            cancelLabel: labelOf(labels, 'tocDialogCancel'),
            width: 460,
            onConfirm: () => {
              const res = runDocumentEdit(host, options, 'index-mark', (doc) =>
                addIndexMarksAll(doc, { term, query: term, subTerm }),
              )
              if (!res?.ok) {
                const msg =
                  res?.reason === 'has_objects' || res?.reason === 'memo_removal_requires_approval'
                    ? labelOf(labels, 'indexErrorHasObjects')
                    : res?.reason === 'invalid_term'
                      ? labelOf(labels, 'indexMarkErrorEmpty')
                      : fmt(labelOf(labels, 'indexErrorGeneric'), {
                          error: res?.error ?? res?.reason ?? '',
                        })
                notify(showToast, msg)
                return
              }
              if (res.added === 0 && res.skippedNonBody === 0) {
                notify(showToast, labelOf(labels, 'indexMarkAllNotFound'))
                return
              }
              const msg =
                res.skippedNonBody > 0
                  ? fmt(labelOf(labels, 'indexMarkAllSkippedToast'), {
                      added: res.added,
                      skipped: res.skippedNonBody,
                    })
                  : fmt(labelOf(labels, 'indexMarkAllAddedToast'), { added: res.added })
              notify(showToast, msg)
              options.onEdited?.('index-mark', res)
            },
          },
          options,
        )
        return true
      }

      const place = resolveCaretPlace(host, options)
      const res = runDocumentEdit(host, options, 'index-mark', (doc) =>
        addIndexMark(doc, place, { term, subTerm }),
      )
      if (!res?.ok) {
        const msg =
          res?.reason === 'unsupported_place' || res?.reason === 'in_table'
            ? labelOf(labels, 'indexMarkErrorUnsupportedPlace')
            : res?.reason === 'has_objects' || res?.reason === 'memo_removal_requires_approval'
              ? labelOf(labels, 'indexErrorHasObjects')
              : res?.reason === 'invalid_term'
                ? labelOf(labels, 'indexMarkErrorEmpty')
                : fmt(labelOf(labels, 'indexErrorGeneric'), {
                    error: res?.error ?? res?.reason ?? '',
                  })
        this.setStatus(msg, 'error')
        notify(showToast, msg)
        return false
      }
      const msg = fmt(labelOf(labels, 'indexMarkAddedToast'), { term: res.term })
      this.setStatus(msg, 'info')
      notify(showToast, msg)
      this.renderMarksList()
      options.onEdited?.('index-mark', res)
      return true
    }
  }

  const dlg = new MarkIndexDialog()
  dlg.show()
  return dlg
}

function reportIndexFailure(res, labels, showToast, setStatus) {
  let message
  if (res?.reason === 'no_index_marks') {
    message = labelOf(labels, 'indexErrorNoMarks')
  } else if (res?.reason === 'in_table') {
    message = labelOf(labels, 'indexErrorInTable')
  } else if (res?.reason === 'unsupported_place') {
    message = labelOf(labels, 'indexErrorUnsupportedPlace')
  } else if (res?.reason === 'has_objects' || res?.reason === 'memo_removal_requires_approval') {
    message = labelOf(labels, 'indexErrorHasObjects')
  } else if (res?.reason === 'index_block_exists') {
    message = labelOf(labels, 'indexErrorAlreadyExists')
  } else if (res?.reason === 'not_found') {
    message = labelOf(labels, 'indexRefreshNotFound')
  } else {
    message = fmt(labelOf(labels, 'indexErrorGeneric'), {
      error: res?.error ?? res?.reason ?? '',
    })
  }
  setStatus?.(message, 'error')
  notify(showToast, message)
}

/**
 * Open the Create Index modal dialog.
 * Configures title, column count (1-3, default 2), consonant/alphabet group headings,
 * and layout (`dotted-tab` or `table`).
 */
export function openCreateIndexDialog(host, labels, options = {}) {
  const { ModalDialog, showToast } = resolveModalParts(options)
  if (!ModalDialog) return null
  const DOC = options.document ?? globalThis.document
  installTocDialogStyles(DOC)

  const state = {
    title: labelOf(labels, 'indexDefaultTitle', DEFAULT_INDEX_TITLE),
    columns: DEFAULT_INDEX_COLUMNS,
    groupHeadings: true,
    layout: TOC_LAYOUTS[0],
  }

  class CreateIndexDialog extends ModalDialog {
    constructor() {
      super(labelOf(labels, 'indexCreateTitle', 'Create Index'), 420)
      this.statusEl = null
    }

    shouldConfirmOnEnter(target) {
      return target?.tagName === 'INPUT'
    }

    setStatus(text, tone = 'info') {
      if (!this.statusEl) return
      this.statusEl.textContent = text
      this.statusEl.dataset.tone = tone
    }

    createBody() {
      const form = DOC.createElement('div')
      form.className = 'ieum-toc-form'

      // 1. Title input
      const titleRow = DOC.createElement('div')
      titleRow.className = 'ieum-toc-row'
      const titleLabel = DOC.createElement('label')
      titleLabel.className = 'dialog-label'
      titleLabel.textContent = labelOf(labels, 'indexTitleLabel')
      const titleInput = DOC.createElement('input')
      titleInput.type = 'text'
      titleInput.className = 'dialog-text-input ieum-toc-field-grow'
      titleInput.dataset.field = 'title'
      titleInput.value = state.title
      titleInput.placeholder = labelOf(labels, 'indexTitlePlaceholder')
      titleInput.addEventListener('input', () => {
        state.title = titleInput.value
        this.setStatus('')
      })
      titleRow.append(titleLabel, titleInput)
      form.appendChild(titleRow)

      // 2. Columns selector (1..3, default 2)
      const colRow = DOC.createElement('div')
      colRow.className = 'ieum-toc-row'
      const colLabel = DOC.createElement('label')
      colLabel.className = 'dialog-label'
      colLabel.textContent = labelOf(labels, 'indexColumnsLabel')
      const colSelect = DOC.createElement('select')
      colSelect.className = 'dialog-select ieum-toc-field-grow'
      colSelect.dataset.field = 'columns'
      for (const cols of [1, 2, 3]) {
        const opt = DOC.createElement('option')
        opt.value = String(cols)
        opt.textContent = fmt(labelOf(labels, 'indexColumnsOption', '{count}'), { count: cols })
        opt.selected = cols === state.columns
        colSelect.appendChild(opt)
      }
      colSelect.addEventListener('change', () => {
        state.columns = Number(colSelect.value)
      })
      colRow.append(colLabel, colSelect)
      form.appendChild(colRow)

      // 3. Layout selector
      const layoutRow = DOC.createElement('div')
      layoutRow.className = 'ieum-toc-row'
      const layoutLabel = DOC.createElement('label')
      layoutLabel.className = 'dialog-label'
      layoutLabel.textContent = labelOf(labels, 'tocLayoutLabel')
      const layoutSelect = DOC.createElement('select')
      layoutSelect.className = 'dialog-select ieum-toc-field-grow'
      layoutSelect.dataset.field = 'layout'
      for (const [value, key] of [
        ['dotted-tab', 'tocLayoutDottedTab'],
        ['table', 'tocLayoutTable'],
      ]) {
        const opt = DOC.createElement('option')
        opt.value = value
        opt.textContent = labelOf(labels, key)
        opt.selected = value === state.layout
        layoutSelect.appendChild(opt)
      }
      layoutSelect.addEventListener('change', () => {
        state.layout = layoutSelect.value
      })
      layoutRow.append(layoutLabel, layoutSelect)
      form.appendChild(layoutRow)

      // 4. Group headings checkbox
      const groupWrap = DOC.createElement('label')
      groupWrap.className = 'dialog-checkbox ieum-toc-checkbox-row'
      const groupBox = DOC.createElement('input')
      groupBox.type = 'checkbox'
      groupBox.dataset.field = 'groupHeadings'
      groupBox.checked = state.groupHeadings
      groupBox.addEventListener('change', () => {
        state.groupHeadings = groupBox.checked
      })
      groupWrap.append(groupBox, labelOf(labels, 'indexGroupHeadingsLabel'))
      form.appendChild(groupWrap)

      // Inline status / error area
      const status = DOC.createElement('div')
      status.className = 'ieum-toc-status'
      status.dataset.role = 'status'
      this.statusEl = status
      form.appendChild(status)

      return form
    }

    show() {
      super.show()
      applyFooterLabels(
        this.dialog,
        labelOf(labels, 'indexCreateConfirm'),
        labelOf(labels, 'tocDialogCancel'),
      )
    }

    onConfirm() {
      const place = resolveCaretPlace(host, options)
      const buildOpts = {
        title: state.title.trim() ? state.title.trim() : null,
        columns: state.columns,
        groupHeadings: state.groupHeadings,
        layout: state.layout,
      }
      const res = runDocumentEdit(host, options, 'index-create', (doc) =>
        buildIndexBlock(doc, place, buildOpts),
      )
      if (res?.ok) {
        notify(showToast, fmt(labelOf(labels, 'indexCreatedToast'), { count: res.entryCount ?? 0 }))
        options.onEdited?.('index-create', res)
        return true
      }
      if (res?.reason === 'page_split_confirm') {
        openConfirmActionDialog(
          {
            title: labelOf(labels, 'indexPageSplitConfirmTitle', 'Confirm Page Break'),
            message: labelOf(labels, 'indexPageSplitConfirmMessage'),
            confirmLabel: labelOf(labels, 'indexPageSplitConfirmAction'),
            cancelLabel: labelOf(labels, 'tocDialogCancel'),
            onConfirm: () => {
              const forced = runDocumentEdit(host, options, 'index-create', (doc) =>
                buildIndexBlock(doc, place, { ...buildOpts, allowPageSplit: true }),
              )
              if (forced?.ok) {
                notify(
                  showToast,
                  fmt(labelOf(labels, 'indexCreatedToast'), { count: forced.entryCount ?? 0 }),
                )
                options.onEdited?.('index-create', forced)
              } else {
                reportIndexFailure(forced, labels, showToast)
              }
            },
          },
          options,
        )
        return true
      }
      reportIndexFailure(res, labels, showToast, (m, t) => this.setStatus(m, t))
      return false
    }
  }

  const dlg = new CreateIndexDialog()
  dlg.show()
  return dlg
}

/**
 * Refresh the existing `색인블록:` index block in place.
 * When manual edits are detected inside the block, opens the confirmation dialog
 * showing modified lines and overwrites only upon explicit confirmation.
 */
export function runRefreshIndexDialog(host, labels, options = {}) {
  const { showToast } = resolveModalParts(options)
  const res = runDocumentEdit(host, options, 'index-refresh', (doc) => refreshIndexBlock(doc))
  if (res?.ok) {
    notify(showToast, fmt(labelOf(labels, 'indexRefreshedToast'), { count: res.entryCount ?? 0 }))
    options.onEdited?.('index-refresh', res)
    return res
  }
  if (res?.reason === 'manual_edits') {
    openManualEditConfirmDialog(res.modifiedLines ?? [], labels, options, () => {
      const forced = runDocumentEdit(host, options, 'index-refresh', (doc) =>
        refreshIndexBlock(doc, { allowOverwriteManual: true }),
      )
      if (forced?.ok) {
        notify(
          showToast,
          fmt(labelOf(labels, 'indexRefreshedToast'), { count: forced.entryCount ?? 0 }),
        )
        options.onEdited?.('index-refresh', forced)
      } else {
        reportIndexFailure(forced, labels, showToast)
      }
    })
    return res
  }
  reportIndexFailure(res, labels, showToast)
  return res
}

function insertToolMenuSeparator(doc) {
  if (!doc?.querySelector) return
  const dropdown = doc.querySelector('.menu-item[data-menu="tool"] .menu-dropdown')
  if (!dropdown) return
  const firstItem = dropdown.querySelector(`.md-item[data-cmd="${TOC_CREATE_COMMAND}"]`)
  if (!firstItem) return
  const existing = dropdown.querySelector('.md-sep[data-ieum-toc-sep]')
  if (existing) existing.remove()
  const sep = doc.createElement('div')
  sep.className = 'md-sep'
  sep.dataset.ieumTocSep = '1'
  dropdown.insertBefore(sep, firstItem)
}

/**
 * Register the 5 TOC & Index commands in the editor's Tool menu (`menuId: 'tool'`)
 * and register context-menu visibility probes for right-clicking inside TOC / Index blocks.
 *
 * Repeated calls are idempotent and update command labels cleanly (e.g. after a UI
 * language change). Returns `{ ok: false }` when the host lacks automation hooks.
 */
export function installTocIndexMenu(host, labels, options = {}) {
  for (const item of TOC_INDEX_MENU_ITEMS) {
    if (typeof labels?.[item.labelKey] !== 'string' || !labels[item.labelKey]) {
      throw new Error(`labels.${item.labelKey} must be a non-empty string`)
    }
  }
  const automation = host?.automation
  if (!automation?.registerCommand || !automation?.addMenuItem) {
    return { ok: false }
  }

  const canRunInDoc = (ctx) => ctx?.hasDocument === true && ctx?.isFormMode !== true

  const isCaretInTocNow = () => {
    try {
      const caret = readCaretRaw(host, options)
      if (!caret) return false
      return readFromHost(host, options, (doc) => isCaretInTocRange(doc, caret) !== null)
    } catch {
      return false
    }
  }

  const isCaretInIndexNow = () => {
    try {
      const caret = readCaretRaw(host, options)
      if (!caret) return false
      return readFromHost(host, options, (doc) => isCaretInIndexRange(doc, caret))
    } catch {
      return false
    }
  }

  const commandDefs = [
    {
      id: TOC_CREATE_COMMAND,
      label: labels.tocMenuCreate,
      opensDialog: true,
      canExecute: canRunInDoc,
      execute: () => {
        openCreateTocDialog(host, labels, options)
      },
    },
    {
      id: TOC_REFRESH_COMMAND,
      label: labels.tocMenuRefresh,
      canExecute: canRunInDoc,
      execute: () => {
        runRefreshTocDialog(host, labels, options)
      },
    },
    {
      id: INDEX_MARK_COMMAND,
      label: labels.indexMenuMark,
      opensDialog: true,
      canExecute: canRunInDoc,
      execute: () => {
        openMarkIndexDialog(host, labels, options)
      },
    },
    {
      id: INDEX_CREATE_COMMAND,
      label: labels.indexMenuCreate,
      opensDialog: true,
      canExecute: canRunInDoc,
      execute: () => {
        openCreateIndexDialog(host, labels, options)
      },
    },
    {
      id: INDEX_REFRESH_COMMAND,
      label: labels.indexMenuRefresh,
      canExecute: canRunInDoc,
      execute: () => {
        runRefreshIndexDialog(host, labels, options)
      },
    },
    {
      id: TOC_REFRESH_CONTEXT_COMMAND,
      label: labels.tocMenuRefresh,
      canExecute: (ctx) => canRunInDoc(ctx) && isCaretInTocNow(),
      execute: () => {
        runRefreshTocDialog(host, labels, options)
      },
    },
    {
      id: INDEX_REFRESH_CONTEXT_COMMAND,
      label: labels.indexMenuRefresh,
      canExecute: (ctx) => canRunInDoc(ctx) && isCaretInIndexNow(),
      execute: () => {
        runRefreshIndexDialog(host, labels, options)
      },
    },
  ]

  for (const def of commandDefs) {
    try {
      automation.unregisterCommand?.(def.id)
    } catch {
      // not previously registered
    }
    try {
      automation.registerCommand(def)
    } catch {
      // registered by an earlier call on a host without unregisterCommand
    }
  }

  try {
    for (const item of TOC_INDEX_MENU_ITEMS) {
      automation.addMenuItem({
        menuId: 'tool',
        commandId: item.id,
        position: 'bottom',
      })
    }
  } catch {
    // an editor without a Tool menu
    return { ok: false }
  }

  insertToolMenuSeparator(options.document ?? globalThis.document)
  return { ok: true }
}
