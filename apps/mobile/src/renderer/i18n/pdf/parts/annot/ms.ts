import type { zh } from './zh'

export const ms = {
  pdfAnnotHighlight: 'Sorot',
  pdfAnnotUnderline: 'Garis bawah',
  pdfAnnotSquiggly: 'Berombak',
  pdfAnnotStrikeout: 'Garis lorek',
  pdfAnnotModeSelect: 'Pilih teks',
  pdfAnnotModeNote: 'Letak nota',
  pdfAnnotHintSelect:
    'Seret ke sisi di atas teks, atau tekan lama kemudian seret, untuk memilih. Ketik tanda untuk menukar warna atau membuangnya.',
  pdfAnnotHintNote: 'Ketik tempat untuk meletakkan nota.',
  pdfAnnotPen: 'Penyerlah {n}',
  pdfAnnotColor: 'Warna {n}',
  pdfAnnotRemove: 'Buang tanda',
  pdfAnnotMarkupTitle: 'Warna tanda',
  pdfAnnotClearSelection: 'Kosongkan pilihan',
  pdfAnnotNoText: 'Halaman ini tiada teks yang boleh dipilih.',
  pdfAnnotOpenNote: 'Buka nota',
  pdfAnnotFailed: 'Anotasi tidak dapat ditukar.',
  pdfAnnotNewNote: 'Nota baharu',
  pdfAnnotReplyPlaceholder: 'Tulis balasan',
} as const satisfies Record<keyof typeof zh, string>
