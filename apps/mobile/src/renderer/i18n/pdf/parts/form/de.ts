import type { zh } from './zh'

export const de = {
  pdfFormAddCheck: 'Häkchen setzen',
  pdfFormAddCross: 'Kreuz setzen',
  pdfFormPlaceCheck: 'Auf die Seite tippen, um ein Häkchen zu setzen',
  pdfFormPlaceCross: 'Auf die Seite tippen, um ein X zu setzen',
  pdfFormCheckMark: 'Häkchen',
  pdfFormCrossMark: 'Kreuz',
  pdfFormDeleteMark: 'Markierung löschen',
  pdfFormDone: 'Fertig',
  pdfFormSignField: 'Zum Signieren tippen',
  pdfFormDateInvalid: 'Datum im Format {format} eingeben',
  pdfFormDatePick: 'Datum auswählen',
} as const satisfies Record<keyof typeof zh, string>
