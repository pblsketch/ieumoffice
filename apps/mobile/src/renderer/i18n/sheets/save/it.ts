import type { zh } from './zh'

export const it = {
  sheetsShareFailed: 'Impossibile condividere questo file.',
  sheetsSaveFailed: 'Impossibile salvare. Il file originale non è cambiato.',
  sheetsSaveAsTitle: 'Salva con nome',
  sheetsShareTitle: 'Condividi come',
  sheetsFormatWorkbook: 'Cartella di lavoro di Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Cartella di lavoro di Excel con macro (.xlsm)',
  sheetsFormatCsv: 'CSV (solo il foglio corrente)',
  sheetsFormatOds: 'Foglio di calcolo ODS (copia della cartella)',
  sheetsFormatPdf: 'PDF (foglio corrente)',
  sheetsOdsEncrypted: 'Una cartella di lavoro con password non può essere esportata in ODS.',
  sheetsChoiceCancel: 'Annulla',
  sheetsCsvAskTitle: 'Salva file CSV',
  sheetsCsvAskMessage: 'Un file CSV conserva solo i valori del foglio corrente.',
  sheetsCsvAskCsv: 'Salva come CSV (senza formattazione e altri fogli)',
  sheetsCsvAskXlsx: 'Salva come file Excel',
  sheetsCsvFormulaTitle: 'Le formule mantengono solo i valori',
  sheetsCsvFormulaMessage:
    'Le formule di questo foglio restano nel CSV solo come valori calcolati. Per conservarle, salva come file Excel.',
  sheetsCsvContinue: 'Continua come CSV',
  sheetsOdsLossTitle: 'Esporta in ODS',
  sheetsOdsLossMessage:
    '{count} funzionalità che ODS non può contenere (formule, grafici, immagini, formattazione condizionale e simili) restano fuori dalla copia.',
  sheetsOdsContinue: 'Continua',
  sheetsOdsUnreadable: 'Il file ODS non si è riaperto, quindi non è stato scritto.',
  sheetsOdsFailed: 'Impossibile esportare in ODS.',
  sheetsCopySaved: 'Copia salvata: {name}',
  sheetsPdfWorking: 'Creazione del PDF…',
  sheetsPdfFailed: 'Impossibile creare il PDF.',
  sheetsPdfSkippedVisuals: 'Non è stato possibile inserire nel PDF {count} immagini o grafici.',
  sheetsPdfMissingGlyphs: '{count} caratteri assenti dai font appaiono come caselle vuote nel PDF.',
  sheetsSaveErrDiskChanged:
    'Un’altra app ha modificato l’originale dopo l’apertura. Non è stato sovrascritto; usa Salva con nome.',
  sheetsSaveErrTooLarge:
    'Il file è troppo grande (oltre 14 MB circa) per essere scritto su questo telefono. L’originale è invariato.',
  sheetsSaveErrUnreadable:
    'La cartella salvata non si è riaperta, quindi l’originale è rimasto com’era.',
  sheetsSaveErrLockFailed:
    'Non è stato possibile bloccare di nuovo la cartella con la sua password, quindi l’originale è rimasto com’era.',
  sheetsSaveBusy: 'Salvataggio in corso. Riprova quando è finito.',
} as const satisfies Record<keyof typeof zh, string>
