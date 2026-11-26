import type { zh } from './zh'

export const nl = {
  sheetsShareFailed: 'Dit bestand kon niet worden gedeeld.',
  sheetsSaveFailed: 'Opslaan is mislukt. Het oorspronkelijke bestand is ongewijzigd.',
  sheetsSaveAsTitle: 'Opslaan als',
  sheetsShareTitle: 'Delen als',
  sheetsFormatWorkbook: 'Excel-werkmap (.xlsx)',
  sheetsFormatWorkbookMacro: 'Excel-werkmap met macro’s (.xlsm)',
  sheetsFormatCsv: 'CSV (alleen huidig blad)',
  sheetsFormatOds: 'ODS-spreadsheet (kopie van de werkmap)',
  sheetsFormatPdf: 'PDF (huidig blad)',
  sheetsOdsEncrypted: 'Een werkmap met wachtwoord kan niet als ODS worden geëxporteerd.',
  sheetsChoiceCancel: 'Annuleren',
  sheetsCsvAskTitle: 'CSV-bestand opslaan',
  sheetsCsvAskMessage: 'Een CSV-bestand bewaart alleen de waarden van het huidige blad.',
  sheetsCsvAskCsv: 'Opslaan als CSV (zonder opmaak en andere bladen)',
  sheetsCsvAskXlsx: 'Opslaan als Excel-bestand',
  sheetsCsvFormulaTitle: 'Formules houden alleen hun waarden',
  sheetsCsvFormulaMessage:
    'De formules van dit blad blijven in een CSV-bestand alleen als berekende waarden bewaard. Sla op als Excel-bestand om de formules te houden.',
  sheetsCsvContinue: 'Doorgaan als CSV',
  sheetsOdsLossTitle: 'Exporteren als ODS',
  sheetsOdsLossMessage:
    '{count} functies die ODS niet kan bevatten (formules, grafieken, afbeeldingen, voorwaardelijke opmaak en dergelijke) ontbreken in de kopie.',
  sheetsOdsContinue: 'Doorgaan',
  sheetsOdsUnreadable:
    'Het ODS-bestand kon niet opnieuw worden geopend en is daarom niet geschreven.',
  sheetsOdsFailed: 'Exporteren als ODS is mislukt.',
  sheetsCopySaved: 'Kopie opgeslagen: {name}',
  sheetsPdfWorking: 'PDF maken…',
  sheetsPdfFailed: 'De PDF kon niet worden gemaakt.',
  sheetsPdfSkippedVisuals: '{count} afbeeldingen of grafieken konden niet in de PDF worden gezet.',
  sheetsPdfMissingGlyphs:
    '{count} tekens die in de lettertypen ontbreken, staan in de PDF als lege vakjes.',
  sheetsSaveErrDiskChanged:
    'Een andere app heeft het origineel na het openen gewijzigd. Het is niet overschreven; gebruik Opslaan als.',
  sheetsSaveErrTooLarge:
    'Het bestand is te groot (meer dan ongeveer 14 MB) om op deze telefoon te schrijven. Het origineel is ongewijzigd.',
  sheetsSaveErrUnreadable:
    'De opgeslagen werkmap kon niet opnieuw worden geopend; het origineel is ongewijzigd gelaten.',
  sheetsSaveErrLockFailed:
    'De werkmap kon niet opnieuw met het wachtwoord worden vergrendeld; het origineel is ongewijzigd gelaten.',
  sheetsSaveBusy: 'Er wordt opgeslagen. Probeer het opnieuw als dat klaar is.',
} as const satisfies Record<keyof typeof zh, string>
