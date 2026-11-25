import type { zh } from './zh'

export const it = {
  pdfEditPen: 'Penna',
  pdfEditHighlighter: 'Evidenziatore',
  pdfEditTextBox: 'Casella di testo',
  pdfEditSign: 'Firma',
  pdfEditPages: 'Organizza pagine',
  pdfEditLink: 'Inserisci collegamento',
  pdfEditSaveFailed: 'Impossibile salvare. Le modifiche restano e il file non è stato cambiato.',
  pdfEditSaveSkipped: 'Alcune modifiche al testo a pagina {pages} non sono state salvate.',
  pdfEditShareFailed: 'Impossibile condividere.',
  pdfEditReloadFailed: 'Salvato, ma non è stato possibile ricaricare il documento. Riapri il file.',
  pdfEditSignatureUnavailable: 'La firma non è ancora disponibile.',
  pdfEditSaveAsHint:
    'Scegli come trattare evidenziazioni, note e disegni nella copia. «Incorpora nelle pagine» incorpora anche i campi modulo; «Escludi annotazioni» mantiene collegamenti e campi.',
  pdfEditKeepAnnots: 'Mantieni annotazioni (modificabili in altre app)',
  pdfEditFlattenAnnots: 'Incorpora nelle pagine (visibile in ogni app)',
  pdfEditStripAnnots: 'Escludi annotazioni (collegamenti e campi restano)',
  pdfEditSaveVerifyFailed:
    'Le modifiche a pagina {pages} non sono state riscritte integralmente; il salvataggio è stato annullato e il file è rimasto invariato. Annulla la modifica interessata e riprova',
} as const satisfies Record<keyof typeof zh, string>
