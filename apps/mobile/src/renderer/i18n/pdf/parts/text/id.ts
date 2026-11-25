import type { zh } from './zh'

export const id = {
  pdfTextHint: 'Ketuk ruang kosong untuk menambah teks, atau ketuk teks untuk mengeditnya.',
  pdfTextInputLabel: 'Teks yang ditambahkan',
  pdfTextEditLabel: 'Teks yang diedit',
  pdfTextStyleBar: 'Gaya teks',
  pdfTextBold: 'Tebal',
  pdfTextSize: 'Ukuran teks',
  pdfTextSizeDown: 'Perkecil teks',
  pdfTextSizeUp: 'Perbesar teks',
  pdfTextColor: 'Warna teks',
  pdfTextColorDocument: 'Pertahankan warna dokumen',
  pdfTextFont: 'Font',
  pdfTextFontDocument: 'Font dokumen',
  pdfTextBack: 'Kembali',
  pdfTextDelete: 'Hapus',
  pdfTextDone: 'Selesai',
  pdfTextCannotDraw: 'Karakter ini tidak dapat ditambahkan: {chars}',
  pdfTextFontSubstituted: 'Karakter ini akan memakai font lain: {chars}',
  pdfTextScannedPage: 'Halaman ini tidak memiliki teks. Anda hanya dapat menambah teks baru.',
  pdfTextNoMatch: 'Teks ini tidak dapat diedit: tidak ditemukan di dokumen.',
  pdfTextOverflow: 'Teks yang diedit akan menimpa teks di bawahnya. Perpendek teksnya.',
} as const satisfies Record<keyof typeof zh, string>
