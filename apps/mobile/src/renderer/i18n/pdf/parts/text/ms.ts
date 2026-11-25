import type { zh } from './zh'

export const ms = {
  pdfTextHint: 'Ketik ruang kosong untuk menambah teks, atau ketik teks untuk mengeditnya.',
  pdfTextInputLabel: 'Teks untuk ditambah',
  pdfTextEditLabel: 'Teks untuk diedit',
  pdfTextStyleBar: 'Gaya teks',
  pdfTextBold: 'Tebal',
  pdfTextSize: 'Saiz teks',
  pdfTextSizeDown: 'Kecilkan teks',
  pdfTextSizeUp: 'Besarkan teks',
  pdfTextColor: 'Warna teks',
  pdfTextColorDocument: 'Kekalkan warna dokumen',
  pdfTextFont: 'Fon',
  pdfTextFontDocument: 'Fon dokumen',
  pdfTextBack: 'Kembali',
  pdfTextDelete: 'Padam',
  pdfTextDone: 'Selesai',
  pdfTextCannotDraw: 'Aksara ini tidak boleh ditambah: {chars}',
  pdfTextFontSubstituted: 'Aksara ini akan menggunakan fon lain: {chars}',
  pdfTextScannedPage: 'Halaman ini tiada teks. Anda hanya boleh menambah teks baharu.',
  pdfTextNoMatch: 'Teks ini tidak boleh diedit: ia tidak ditemui dalam dokumen.',
  pdfTextOverflow: 'Teks yang diedit akan bertindih dengan teks di bawahnya. Sila pendekkan.',
} as const satisfies Record<keyof typeof zh, string>
