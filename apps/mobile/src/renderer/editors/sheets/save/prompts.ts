/**
 * The questions the save area asks, in one replaceable place: the screen's
 * sheets (`choiceSheet.tsx`, loaded when first asked) in the app, scripted
 * answers in tests (`setSheetsSavePrompts`).
 */
import { normalizeLang, type Params } from '@genoffice/i18n'
import { sheetsSaveAsFilters } from '../../../../../../sheets/src/main/save-as-formats'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import type { SheetsChoice } from './choiceSheet'

/** What a Save As or a share can produce (PC save-as-formats.ts). */
export type SheetsOutputFormat = 'workbook' | 'csv' | 'ods' | 'pdf'

export type SheetsTranslate = (key: MobileStringKey, params?: Params) => string

export function uiTranslate(): SheetsTranslate {
  const lang = normalizeLang(
    typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en',
  )
  return (key, params) => translateMobile(lang, key, params)
}

/**
 * The formats on offer, in the desktop Save As dialog's order and rules: a
 * macro workbook offers `.xlsm` only as its workbook type and no CSV; ODS of
 * the whole workbook and PDF of the current sheet are copies. ODS stays off
 * for a workbook opened with a password (the desktop refuses it, decision
 * 0119), with the reason under it.
 */
export function outputFormatChoices(input: {
  readonly macro: boolean
  readonly unlocked: boolean
  readonly t: SheetsTranslate
}): SheetsChoice<SheetsOutputFormat>[] {
  const { t } = input
  return sheetsSaveAsFilters(input.macro, true, (key) => key).map(
    (filter): SheetsChoice<SheetsOutputFormat> => {
      const ext = filter.extensions[0]
      if (ext === 'csv') return { id: 'csv', label: t('sheetsFormatCsv') }
      if (ext === 'ods') {
        return input.unlocked
          ? {
              id: 'ods',
              label: t('sheetsFormatOds'),
              detail: t('sheetsOdsEncrypted'),
              disabled: true,
            }
          : { id: 'ods', label: t('sheetsFormatOds') }
      }
      if (ext === 'pdf') return { id: 'pdf', label: t('sheetsFormatPdf') }
      return {
        id: 'workbook',
        label: t(ext === 'xlsm' ? 'sheetsFormatWorkbookMacro' : 'sheetsFormatWorkbook'),
      }
    },
  )
}

export interface SheetsSavePrompts {
  /** Save As (`purpose: 'save-as'`) or share: which format. `null`: cancelled. */
  chooseFormat(input: {
    readonly purpose: 'save-as' | 'share'
    readonly macro: boolean
    readonly unlocked: boolean
  }): Promise<SheetsOutputFormat | null>
  /** Every save of a CSV document (spec 2.3). */
  askCsvSave(): Promise<'csv' | 'xlsx' | 'cancel'>
  /** A CSV copy of a sheet with formulas keeps their values only (the desktop's warning). */
  askCsvFormulaLoss(): Promise<'xlsx' | 'csv' | 'cancel'>
  /** The ODS copy leaves `count` features out; `true` goes on. */
  confirmOdsLoss(count: number): Promise<boolean>
}

const screenPrompts: SheetsSavePrompts = {
  async chooseFormat(input) {
    const t = uiTranslate()
    const { askSheetsChoice } = await import('./choiceSheet')
    return askSheetsChoice({
      title: t(input.purpose === 'share' ? 'sheetsShareTitle' : 'sheetsSaveAsTitle'),
      choices: outputFormatChoices({ macro: input.macro, unlocked: input.unlocked, t }),
      cancelLabel: t('sheetsChoiceCancel'),
      testId: 'sheets-format-sheet',
    })
  },
  async askCsvSave() {
    const t = uiTranslate()
    const { askSheetsChoice } = await import('./choiceSheet')
    const picked = await askSheetsChoice({
      title: t('sheetsCsvAskTitle'),
      message: t('sheetsCsvAskMessage'),
      choices: [
        { id: 'csv' as const, label: t('sheetsCsvAskCsv') },
        { id: 'xlsx' as const, label: t('sheetsCsvAskXlsx') },
      ],
      cancelLabel: t('sheetsChoiceCancel'),
      testId: 'sheets-csv-sheet',
    })
    return picked ?? 'cancel'
  },
  async askCsvFormulaLoss() {
    const t = uiTranslate()
    const { askSheetsChoice } = await import('./choiceSheet')
    const picked = await askSheetsChoice({
      title: t('sheetsCsvFormulaTitle'),
      message: t('sheetsCsvFormulaMessage'),
      choices: [
        { id: 'xlsx' as const, label: t('sheetsCsvAskXlsx') },
        { id: 'csv' as const, label: t('sheetsCsvContinue') },
      ],
      cancelLabel: t('sheetsChoiceCancel'),
      testId: 'sheets-csv-formula-sheet',
    })
    return picked ?? 'cancel'
  },
  async confirmOdsLoss(count) {
    const t = uiTranslate()
    const { askSheetsChoice } = await import('./choiceSheet')
    const picked = await askSheetsChoice({
      title: t('sheetsOdsLossTitle'),
      message: t('sheetsOdsLossMessage', { count }),
      choices: [{ id: 'continue' as const, label: t('sheetsOdsContinue') }],
      cancelLabel: t('sheetsChoiceCancel'),
      testId: 'sheets-ods-loss-sheet',
    })
    return picked === 'continue'
  },
}

let current: SheetsSavePrompts = screenPrompts

export function sheetsSavePrompts(): SheetsSavePrompts {
  return current
}

/** Tests: scripted answers (`null` puts the screen's sheets back). */
export function setSheetsSavePrompts(prompts: SheetsSavePrompts | null): void {
  current = prompts ?? screenPrompts
}
