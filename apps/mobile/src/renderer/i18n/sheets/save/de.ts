import type { zh } from './zh'

export const de = {
  sheetsShareFailed: 'Diese Datei konnte nicht geteilt werden.',
  sheetsSaveFailed: 'Speichern nicht möglich. Die Originaldatei ist unverändert.',
  sheetsSaveAsTitle: 'Speichern unter',
  sheetsShareTitle: 'Teilen als',
  sheetsFormatWorkbook: 'Excel-Arbeitsmappe (.xlsx)',
  sheetsFormatWorkbookMacro: 'Excel-Arbeitsmappe mit Makros (.xlsm)',
  sheetsFormatCsv: 'CSV (nur aktuelles Blatt)',
  sheetsFormatOds: 'ODS-Tabelle (Kopie der Arbeitsmappe)',
  sheetsFormatPdf: 'PDF (aktuelles Blatt)',
  sheetsOdsEncrypted: 'Eine Arbeitsmappe mit Kennwort kann nicht als ODS exportiert werden.',
  sheetsChoiceCancel: 'Abbrechen',
  sheetsCsvAskTitle: 'CSV-Datei speichern',
  sheetsCsvAskMessage: 'Eine CSV-Datei enthält nur die Werte des aktuellen Blatts.',
  sheetsCsvAskCsv: 'Als CSV speichern (Formatierung und andere Blätter entfallen)',
  sheetsCsvAskXlsx: 'Als Excel-Datei speichern',
  sheetsCsvFormulaTitle: 'Formeln behalten nur ihre Werte',
  sheetsCsvFormulaMessage:
    'Die Formeln dieses Blatts bleiben in einer CSV-Datei nur als berechnete Werte erhalten. Um die Formeln zu behalten, als Excel-Datei speichern.',
  sheetsCsvContinue: 'Als CSV fortfahren',
  sheetsOdsLossTitle: 'Als ODS exportieren',
  sheetsOdsLossMessage:
    '{count} Funktionen, die ODS nicht aufnehmen kann (Formeln, Diagramme, Bilder, bedingte Formatierung usw.), fehlen in der Kopie.',
  sheetsOdsContinue: 'Fortfahren',
  sheetsOdsUnreadable:
    'Die ODS-Datei ließ sich nicht wieder öffnen und wurde daher nicht geschrieben.',
  sheetsOdsFailed: 'Export als ODS nicht möglich.',
  sheetsCopySaved: 'Kopie gespeichert: {name}',
  sheetsPdfWorking: 'PDF wird erstellt…',
  sheetsPdfFailed: 'Das PDF konnte nicht erstellt werden.',
  sheetsPdfSkippedVisuals: '{count} Bilder oder Diagramme konnten nicht ins PDF übernommen werden.',
  sheetsPdfMissingGlyphs:
    '{count} Zeichen, die in den Schriften fehlen, erscheinen im PDF als leere Kästchen.',
  sheetsSaveErrDiskChanged:
    'Eine andere App hat das Original nach dem Öffnen geändert. Es wurde nicht überschrieben; verwenden Sie „Speichern unter“.',
  sheetsSaveErrTooLarge:
    'Die Datei ist zu groß (über etwa 14 MB), um sie auf diesem Telefon zu schreiben. Das Original ist unverändert.',
  sheetsSaveErrUnreadable:
    'Die gespeicherte Arbeitsmappe ließ sich nicht wieder öffnen; das Original bleibt unverändert.',
  sheetsSaveErrLockFailed:
    'Die Arbeitsmappe konnte nicht wieder mit ihrem Kennwort gesperrt werden; das Original bleibt unverändert.',
  sheetsSaveBusy: 'Es wird gerade gespeichert. Versuchen Sie es danach erneut.',
} as const satisfies Record<keyof typeof zh, string>
