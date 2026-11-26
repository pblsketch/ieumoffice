import type { zh } from './zh'

export const en = {
  sheetsShareFailed: 'Could not share this file.',
  sheetsSaveFailed: 'Could not save. The original file is unchanged.',
  sheetsSaveAsTitle: 'Save As',
  sheetsShareTitle: 'Share as',
  sheetsFormatWorkbook: 'Excel workbook (.xlsx)',
  sheetsFormatWorkbookMacro: 'Excel macro-enabled workbook (.xlsm)',
  sheetsFormatCsv: 'CSV (current sheet only)',
  sheetsFormatOds: 'ODS spreadsheet (copy of the workbook)',
  sheetsFormatPdf: 'PDF (current sheet)',
  sheetsOdsEncrypted: 'A workbook with a password cannot be exported as ODS.',
  sheetsChoiceCancel: 'Cancel',
  sheetsCsvAskTitle: 'Save CSV file',
  sheetsCsvAskMessage: 'A CSV file keeps only the values of the current sheet.',
  sheetsCsvAskCsv: 'Save as CSV (formatting and other sheets are left out)',
  sheetsCsvAskXlsx: 'Save as an Excel file',
  sheetsCsvFormulaTitle: 'Formulas keep their values only',
  sheetsCsvFormulaMessage:
    'The formulas of this sheet are kept as calculated values in a CSV file. To keep the formulas, save as an Excel file.',
  sheetsCsvContinue: 'Continue as CSV',
  sheetsOdsLossTitle: 'Export as ODS',
  sheetsOdsLossMessage:
    '{count} features ODS cannot hold (formulas, charts, pictures, conditional formatting and the like) are left out of the copy.',
  sheetsOdsContinue: 'Continue',
  sheetsOdsUnreadable: 'The ODS file could not be opened again, so it was not written.',
  sheetsOdsFailed: 'Could not export as ODS.',
  sheetsCopySaved: 'Copy saved: {name}',
  sheetsPdfWorking: 'Making the PDF…',
  sheetsPdfFailed: 'Could not make the PDF.',
  sheetsPdfSkippedVisuals: '{count} pictures or charts could not be put in the PDF.',
  sheetsPdfMissingGlyphs:
    '{count} characters missing from the fonts appear as empty boxes in the PDF.',
  sheetsSaveErrDiskChanged:
    'Another app changed the original after it was opened. It was not overwritten; use Save As instead.',
  sheetsSaveErrTooLarge:
    'The file is too large (over about 14 MB) to write on this phone. The original is unchanged.',
  sheetsSaveErrUnreadable:
    'The saved workbook could not be opened again, so the original was left as it was.',
  sheetsSaveErrLockFailed:
    'The workbook could not be locked again with its password, so the original was left as it was.',
  sheetsSaveBusy: 'Saving is in progress. Try again when it is done.',
} as const satisfies Record<keyof typeof zh, string>
