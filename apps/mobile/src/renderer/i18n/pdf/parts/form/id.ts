import type { zh } from './zh'

export const id = {
  pdfFormAddCheck: 'Tambahkan centang',
  pdfFormAddCross: 'Tambahkan tanda X',
  pdfFormPlaceCheck: 'Ketuk halaman untuk menempatkan tanda centang',
  pdfFormPlaceCross: 'Ketuk halaman untuk menempatkan tanda X',
  pdfFormCheckMark: 'Tanda centang',
  pdfFormCrossMark: 'Tanda X',
  pdfFormDeleteMark: 'Hapus tanda',
  pdfFormDone: 'Selesai',
  pdfFormSignField: 'Ketuk untuk menandatangani',
  pdfFormDateInvalid: 'Masukkan tanggal dengan format {format}',
  pdfFormDatePick: 'Pilih tanggal',
} as const satisfies Record<keyof typeof zh, string>
