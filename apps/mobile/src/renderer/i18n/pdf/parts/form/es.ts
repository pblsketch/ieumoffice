import type { zh } from './zh'

export const es = {
  pdfFormAddCheck: 'Añadir marca de verificación',
  pdfFormAddCross: 'Añadir X',
  pdfFormPlaceCheck: 'Toca la página para colocar una marca de verificación',
  pdfFormPlaceCross: 'Toca la página para colocar una X',
  pdfFormCheckMark: 'Marca de verificación',
  pdfFormCrossMark: 'Marca X',
  pdfFormDeleteMark: 'Eliminar marca',
  pdfFormDone: 'Listo',
  pdfFormSignField: 'Toca para firmar',
  pdfFormDateInvalid: 'Introduce una fecha con el formato {format}',
  pdfFormDatePick: 'Elegir una fecha',
} as const satisfies Record<keyof typeof zh, string>
