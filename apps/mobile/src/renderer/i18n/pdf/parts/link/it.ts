import type { zh } from './zh'

export const it = {
  pdfLinkPlaceHint: 'Trascina un riquadro sulla pagina dove andrà il link',
  pdfLinkEditTitle: 'Modifica link',
  pdfLinkUrlLabel: 'Indirizzo web (http, https, mailto)',
  pdfLinkPageLabel: 'Oppure una pagina di questo documento (1–{count})',
  pdfLinkUrlInvalid: 'Si possono collegare solo indirizzi http, https e mailto',
  pdfLinkPageInvalid: 'Inserisci un numero di pagina da 1 a {count}',
  pdfLinkNeedTarget: 'Inserisci un indirizzo web o un numero di pagina',
  pdfLinkApply: 'Aggiungi link',
  pdfLinkDelete: 'Elimina link',
  pdfLinkPending: 'Link da aggiungere: {target}',
  pdfLinkToPage: 'Pagina {page}',
  pdfLinkFailed: 'Impossibile modificare il link. Riprova al termine del salvataggio.',
  pdfLinkUpdate: 'Applica',
} as const satisfies Record<keyof typeof zh, string>
