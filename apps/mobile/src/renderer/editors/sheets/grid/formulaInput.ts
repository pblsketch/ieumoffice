/**
 * What the keyboard bar types and which keyboard the cell editor asks for
 * (design system 5.6: [=][Σ][( )][,][:][$], a number cell gets the numeric
 * keyboard through `inputmode`).
 */
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core'
import { IEditorService } from '@univerjs/docs-ui'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

/** What one keyboard-bar key types into the cell editor, and how far the caret steps back. */
export interface FormulaKey {
  readonly id: string
  readonly text: string
  readonly caretBack: number
}

export const FORMULA_KEYS: readonly FormulaKey[] = [
  { id: 'equals', text: '=', caretBack: 0 },
  { id: 'sum', text: '=SUM()', caretBack: 1 },
  { id: 'parens', text: '()', caretBack: 1 },
  { id: 'comma', text: ',', caretBack: 0 },
  { id: 'colon', text: ':', caretBack: 0 },
  { id: 'dollar', text: '$', caretBack: 0 },
]

/**
 * The text a key types given what the editor holds: Σ in a formula already
 * started (`=A1+`) adds `SUM()` without a second `=`; the caret then steps
 * back inside the brackets.
 */
export function formulaKeyInput(key: FormulaKey, editorText: string): FormulaKey {
  if (key.id === 'sum' && editorText.trimStart().startsWith('=')) {
    return { ...key, text: 'SUM()' }
  }
  return key
}

/** The cell editor's text (without the document's closing marks). */
export function cellEditorText(runtime: UniverRuntime): string {
  try {
    const editor = runtime.univer
      .__getInjector()
      .get(IEditorService)
      .getEditor(DOCS_NORMAL_EDITOR_UNIT_ID_KEY)
    const stream = editor?.getDocumentData().body?.dataStream ?? ''
    return stream.replace(/[\r\n]+$/, '')
  } catch {
    return ''
  }
}

/** The cell editor's hidden input (docs-ui puts `__editor_<unit id>` on it). */
export function cellEditorInput(doc: Document = document): HTMLElement | null {
  return doc.getElementById(`__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}`)
}

/**
 * Whether a cell opens with the numeric keyboard: it holds a number and no
 * formula. Empty cells and text keep the full keyboard (any text may go in).
 */
export function opensNumericKeyboard(
  cell: { v?: unknown; f?: unknown; si?: unknown } | null | undefined,
): boolean {
  if (!cell) return false
  if (
    (typeof cell.f === 'string' && cell.f !== '') ||
    (typeof cell.si === 'string' && cell.si !== '')
  ) {
    return false
  }
  return typeof cell.v === 'number' && Number.isFinite(cell.v)
}

/**
 * Switches the editor input's keyboard. The virtual keyboard reads
 * `inputmode` when the field gains focus, so a focused field is refocused
 * (Univer's sheet editor stays open on blur: docs-ui skips the sheet editor
 * in its blur handling).
 */
export function setNumericKeyboard(target: HTMLElement, numeric: boolean): void {
  const current = target.getAttribute('inputmode') === 'decimal'
  if (current === numeric) return
  if (numeric) target.setAttribute('inputmode', 'decimal')
  else target.removeAttribute('inputmode')
  if (target.ownerDocument.activeElement === target) {
    target.blur()
    target.focus({ preventScroll: true })
  }
}

/**
 * Types into the focused cell editor the way the virtual keyboard does: the
 * editor's hidden input gets a real `insertText` input event, so Univer's own
 * input handling sees an ordinary keystroke; ← keys then step the caret back.
 */
export function typeIntoCellEditor(key: Pick<FormulaKey, 'text' | 'caretBack'>): boolean {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) return false
  const typed = document.execCommand('insertText', false, key.text)
  for (let step = 0; step < key.caretBack; step += 1) {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        keyCode: 37,
        bubbles: true,
      }),
    )
  }
  return typed
}
