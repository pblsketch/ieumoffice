import type { zh } from './zh'

export const it = {
  pdfFormAddCheck: 'Aggiungi segno di spunta',
  pdfFormAddCross: 'Aggiungi X',
  pdfFormPlaceCheck: 'Tocca la pagina per posizionare un segno di spunta',
  pdfFormPlaceCross: 'Tocca la pagina per posizionare una X',
  pdfFormCheckMark: 'Segno di spunta',
  pdfFormCrossMark: 'Segno X',
  pdfFormDeleteMark: 'Elimina segno',
  pdfFormDone: 'Fine',
  pdfFormSignField: 'Tocca per firmare',
  pdfFormDateInvalid: 'Inserisci una data nel formato {format}',
  pdfFormDatePick: 'Scegli una data',
} as const satisfies Record<keyof typeof zh, string>
