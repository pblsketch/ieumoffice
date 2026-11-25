import type { zh } from './zh'

export const ms = {
  pdfFormAddCheck: 'Tambah tanda semak',
  pdfFormAddCross: 'Tambah tanda pangkah',
  pdfFormPlaceCheck: 'Ketik halaman untuk meletakkan tanda semak',
  pdfFormPlaceCross: 'Ketik halaman untuk meletakkan tanda X',
  pdfFormCheckMark: 'Tanda semak',
  pdfFormCrossMark: 'Tanda pangkah',
  pdfFormDeleteMark: 'Padam tanda',
  pdfFormDone: 'Selesai',
  pdfFormSignField: 'Ketik untuk menandatangani',
  pdfFormDateInvalid: 'Masukkan tarikh dalam format {format}',
  pdfFormDatePick: 'Pilih tarikh',
} as const satisfies Record<keyof typeof zh, string>
