import type { zh } from './zh'

export const tr = {
  pdfFormAddCheck: 'Onay işareti koy',
  pdfFormAddCross: 'Çarpı koy',
  pdfFormPlaceCheck: 'Onay işareti koymak için sayfaya dokunun',
  pdfFormPlaceCross: 'Çarpı işareti koymak için sayfaya dokunun',
  pdfFormCheckMark: 'Onay işareti',
  pdfFormCrossMark: 'Çarpı işareti',
  pdfFormDeleteMark: 'İşareti sil',
  pdfFormDone: 'Bitti',
  pdfFormSignField: 'İmzalamak için dokunun',
  pdfFormDateInvalid: 'Tarihi {format} biçiminde girin',
  pdfFormDatePick: 'Bir tarih seçin',
} as const satisfies Record<keyof typeof zh, string>
