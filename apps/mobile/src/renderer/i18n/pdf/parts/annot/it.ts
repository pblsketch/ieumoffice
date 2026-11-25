import type { zh } from './zh'

export const it = {
  pdfAnnotHighlight: 'Evidenzia',
  pdfAnnotUnderline: 'Sottolinea',
  pdfAnnotSquiggly: 'Ondulato',
  pdfAnnotStrikeout: 'Barra',
  pdfAnnotModeSelect: 'Seleziona testo',
  pdfAnnotModeNote: 'Inserisci nota',
  pdfAnnotHintSelect:
    'Trascina in orizzontale sul testo, oppure tieni premuto e poi trascina, per selezionare. Tocca un segno per cambiarne il colore o rimuoverlo.',
  pdfAnnotHintNote: 'Tocca il punto in cui inserire la nota.',
  pdfAnnotPen: 'Evidenziatore {n}',
  pdfAnnotColor: 'Colore {n}',
  pdfAnnotRemove: 'Rimuovi segno',
  pdfAnnotMarkupTitle: 'Colore del segno',
  pdfAnnotClearSelection: 'Annulla selezione',
  pdfAnnotNoText: 'In questa pagina non c’è testo selezionabile.',
  pdfAnnotOpenNote: 'Apri nota',
  pdfAnnotFailed: 'Impossibile modificare l’annotazione.',
  pdfAnnotNewNote: 'Nuova nota',
  pdfAnnotReplyPlaceholder: 'Scrivi una risposta',
} as const satisfies Record<keyof typeof zh, string>
