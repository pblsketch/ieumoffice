import type { zh } from './zh'

export const it = {
  pdfTextHint: 'Tocca uno spazio vuoto per aggiungere testo o tocca un testo per modificarlo.',
  pdfTextInputLabel: 'Testo da aggiungere',
  pdfTextEditLabel: 'Testo da modificare',
  pdfTextStyleBar: 'Stile del testo',
  pdfTextBold: 'Grassetto',
  pdfTextSize: 'Dimensione del testo',
  pdfTextSizeDown: 'Riduci testo',
  pdfTextSizeUp: 'Ingrandisci testo',
  pdfTextColor: 'Colore del testo',
  pdfTextColorDocument: 'Mantieni il colore del documento',
  pdfTextFont: 'Carattere',
  pdfTextFontDocument: 'Carattere del documento',
  pdfTextBack: 'Indietro',
  pdfTextDelete: 'Elimina',
  pdfTextDone: 'Fine',
  pdfTextCannotDraw: 'Questi caratteri non possono essere aggiunti: {chars}',
  pdfTextFontSubstituted: 'Questi caratteri useranno un altro carattere tipografico: {chars}',
  pdfTextScannedPage: 'Questa pagina non contiene testo. Puoi solo aggiungere nuovo testo.',
  pdfTextNoMatch: 'Impossibile modificare questo testo: non è stato trovato nel documento.',
  pdfTextOverflow: 'Il testo modificato si sovrapporrebbe al testo sottostante. Accorcialo.',
} as const satisfies Record<keyof typeof zh, string>
