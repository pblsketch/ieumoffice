import type { zh } from './zh'

export const cs = {
  pdfFormAddCheck: 'Přidat zaškrtnutí',
  pdfFormAddCross: 'Přidat křížek',
  pdfFormPlaceCheck: 'Klepnutím na stránku umístíte zaškrtnutí',
  pdfFormPlaceCross: 'Klepnutím na stránku umístíte křížek',
  pdfFormCheckMark: 'Zaškrtnutí',
  pdfFormCrossMark: 'Křížek',
  pdfFormDeleteMark: 'Smazat značku',
  pdfFormDone: 'Hotovo',
  pdfFormSignField: 'Klepnutím podepište',
  pdfFormDateInvalid: 'Zadejte datum ve formátu {format}',
  pdfFormDatePick: 'Vybrat datum',
} as const satisfies Record<keyof typeof zh, string>
