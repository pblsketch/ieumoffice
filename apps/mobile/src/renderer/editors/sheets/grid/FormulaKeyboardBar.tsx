import { useState, type PointerEvent } from 'react'
import type { Lang } from '@genoffice/i18n'
import { translateMobile } from '../../../i18n'
import type { MobileGrid } from './mobileGrid'

/** What one keyboard-bar key types into the cell editor, and how far the caret steps back. */
export interface FormulaKey {
  readonly id: string
  readonly text: string
  readonly caretBack: number
  readonly label: string
}

export const FORMULA_KEYS: readonly Omit<FormulaKey, 'label'>[] = [
  { id: 'equals', text: '=', caretBack: 0 },
  { id: 'sum', text: '=SUM()', caretBack: 1 },
  { id: 'parens', text: '()', caretBack: 1 },
  { id: 'comma', text: ',', caretBack: 0 },
  { id: 'colon', text: ':', caretBack: 0 },
  { id: 'dollar', text: '$', caretBack: 0 },
]

/**
 * Types into the focused cell editor the way the virtual keyboard does: the
 * editor's hidden input gets a real `insertText` input event, so Univer's own
 * input handling (and IME state) sees an ordinary keystroke.
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

/**
 * The keyboard bar of the spreadsheet (design system 5.6): sits on top of the
 * virtual keyboard while a cell is being edited, with formula keys on the
 * left and cancel / confirm on the right. [123] switches the editor's input
 * to the numeric keyboard.
 */
export function FormulaKeyboardBar({ grid, lang }: { grid: MobileGrid; lang: Lang }) {
  const t = (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key)
  const [numeric, setNumeric] = useState(false)
  const workbook = () => grid.runtime.univerAPI.getActiveWorkbook()
  const keepFocus = (event: PointerEvent) => event.preventDefault()
  const labels: Record<string, string> = {
    sum: t('sheetsInsertSum'),
    parens: t('sheetsInsertParens'),
  }

  const toggleNumeric = () => {
    const target = document.activeElement
    if (!(target instanceof HTMLElement)) return
    const next = !numeric
    if (next) target.setAttribute('inputmode', 'decimal')
    else target.removeAttribute('inputmode')
    // The virtual keyboard reads inputmode when the field gains focus.
    target.blur()
    target.focus()
    setNumeric(next)
  }

  return (
    <div
      className="m-sheets-kbbar"
      role="toolbar"
      aria-label={t('sheetsKeyboardBar')}
      data-testid="sheets-keyboard-bar"
    >
      <div className="m-sheets-kbbar-keys">
        {FORMULA_KEYS.map((key) => (
          <button
            key={key.id}
            type="button"
            className="m-sheets-kbbar-key"
            aria-label={labels[key.id] ?? key.text}
            onPointerDown={keepFocus}
            onClick={() => typeIntoCellEditor(key)}
            data-testid={`sheets-key-${key.id}`}
          >
            {key.id === 'sum' ? 'Σ' : key.id === 'parens' ? '( )' : key.text}
          </button>
        ))}
        <button
          type="button"
          className="m-sheets-kbbar-key"
          aria-pressed={numeric}
          aria-label={t('sheetsNumericKeys')}
          onPointerDown={keepFocus}
          onClick={toggleNumeric}
          data-testid="sheets-key-numeric"
        >
          123
        </button>
      </div>
      <div className="m-sheets-kbbar-fixed">
        <button
          type="button"
          className="m-sheets-kbbar-action"
          onPointerDown={keepFocus}
          onClick={() => void workbook()?.endEditingAsync(false)}
          data-testid="sheets-key-cancel"
        >
          {t('sheetsCancelEdit')}
        </button>
        <button
          type="button"
          className="m-sheets-kbbar-action m-sheets-kbbar-confirm"
          onPointerDown={keepFocus}
          onClick={() => void workbook()?.endEditingAsync(true)}
          data-testid="sheets-key-confirm"
        >
          {t('sheetsConfirmEdit')}
        </button>
      </div>
    </div>
  )
}
