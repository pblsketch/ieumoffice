import type { zh } from './zh'

export const nl = {
  pdfFormAddCheck: 'Vinkje plaatsen',
  pdfFormAddCross: 'Kruisje plaatsen',
  pdfFormPlaceCheck: 'Tik op de pagina om een vinkje te plaatsen',
  pdfFormPlaceCross: 'Tik op de pagina om een X te plaatsen',
  pdfFormCheckMark: 'Vinkje',
  pdfFormCrossMark: 'Kruisje',
  pdfFormDeleteMark: 'Markering verwijderen',
  pdfFormDone: 'Klaar',
  pdfFormSignField: 'Tik om te ondertekenen',
  pdfFormDateInvalid: 'Voer een datum in als {format}',
  pdfFormDatePick: 'Kies een datum',
} as const satisfies Record<keyof typeof zh, string>
