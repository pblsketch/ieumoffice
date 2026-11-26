import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import type { Lang } from '@genoffice/i18n'
import { IEditorBridgeService } from '@univerjs/sheets-ui'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import { createCompositionTracker, type CompositionTracker } from './composition'
import {
  FORMULA_KEYS,
  cellEditorInput,
  cellEditorText,
  formulaKeyInput,
  opensNumericKeyboard,
  setNumericKeyboard,
  typeIntoCellEditor,
} from './formulaInput'
import type { MobileGrid } from './mobileGrid'

export { FORMULA_KEYS, typeIntoCellEditor, type FormulaKey } from './formulaInput'

/** Whether the cell now being edited holds a plain number (it opens the numeric keyboard). */
function editedCellIsNumber(grid: MobileGrid): boolean {
  try {
    const location = grid.runtime.univer.__getInjector().get(IEditorBridgeService).getEditLocation()
    if (!location) return false
    const sheet = grid.runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(location.sheetId)
    return opensNumericKeyboard(sheet?.getRange(location.row, location.column).getCellData())
  } catch {
    return false
  }
}

const KEY_FACES: Record<string, string> = { sum: 'Σ', parens: '( )' }

/**
 * The keyboard bar of the spreadsheet (design system 5.4, 5.6): sits on top
 * of the virtual keyboard while a cell is being edited, with formula keys on
 * the left and cancel / confirm on the right. [123] switches between the
 * numeric and the full keyboard; a cell holding a number opens on the numeric
 * one. Every button keeps the editor's focus (`pointerdown` preventDefault)
 * and acts only after an open Korean composition is committed.
 */
export function FormulaKeyboardBar({
  grid,
  lang,
  composition: givenComposition,
}: {
  grid: MobileGrid
  lang: Lang
  /** Tests pass their own; the bar makes one for the page otherwise. */
  composition?: CompositionTracker
}) {
  const t = (key: MobileStringKey) => translateMobile(lang, key)
  const [numeric, setNumeric] = useState(false)
  const composition = useMemo(
    () => givenComposition ?? createCompositionTracker(),
    [givenComposition],
  )
  useEffect(
    () => (givenComposition ? undefined : () => composition.dispose()),
    [composition, givenComposition],
  )

  useEffect(() => {
    const startNumeric = editedCellIsNumber(grid)
    const input = cellEditorInput()
    if (input) setNumericKeyboard(input, startNumeric)
    setNumeric(startNumeric)
    return () => {
      // The next edit decides again; a text cell must not inherit the keypad.
      const left = cellEditorInput()
      if (left) left.removeAttribute('inputmode')
    }
  }, [grid])

  const workbook = () => grid.runtime.univerAPI.getActiveWorkbook()
  const keepFocus = (event: PointerEvent) => event.preventDefault()
  const labels: Record<string, string> = {
    sum: t('sheetsInsertSum'),
    parens: t('sheetsInsertParens'),
  }

  const typeKey = (id: string) => {
    const key = FORMULA_KEYS.find((candidate) => candidate.id === id)
    if (!key) return
    composition.afterComposition(() => {
      typeIntoCellEditor(formulaKeyInput(key, cellEditorText(grid.runtime)))
    })
  }

  const toggleNumeric = () => {
    composition.afterComposition(() => {
      const target = cellEditorInput() ?? document.activeElement
      if (!(target instanceof HTMLElement)) return
      const next = !numeric
      setNumericKeyboard(target, next)
      setNumeric(next)
    })
  }

  const endEditing = (confirm: boolean) => {
    composition.afterComposition(() => {
      void workbook()?.endEditingAsync(confirm)
    })
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
            onClick={() => typeKey(key.id)}
            data-testid={`sheets-key-${key.id}`}
          >
            {KEY_FACES[key.id] ?? key.text}
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
          onClick={() => endEditing(false)}
          data-testid="sheets-key-cancel"
        >
          {t('sheetsCancelEdit')}
        </button>
        <button
          type="button"
          className="m-sheets-kbbar-action m-sheets-kbbar-confirm"
          onPointerDown={keepFocus}
          onClick={() => endEditing(true)}
          data-testid="sheets-key-confirm"
        >
          {t('sheetsConfirmEdit')}
        </button>
      </div>
    </div>
  )
}
