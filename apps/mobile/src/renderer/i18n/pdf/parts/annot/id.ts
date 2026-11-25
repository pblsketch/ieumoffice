import type { zh } from './zh'

export const id = {
  pdfAnnotHighlight: 'Sorot',
  pdfAnnotUnderline: 'Garis bawah',
  pdfAnnotSquiggly: 'Gelombang',
  pdfAnnotStrikeout: 'Coret',
  pdfAnnotModeSelect: 'Pilih teks',
  pdfAnnotModeNote: 'Tempatkan catatan',
  pdfAnnotHintSelect:
    'Seret ke samping di atas teks, atau tekan lama lalu seret, untuk memilih. Ketuk tanda untuk mengubah warna atau menghapusnya.',
  pdfAnnotHintNote: 'Ketuk tempat untuk meletakkan catatan.',
  pdfAnnotPen: 'Stabilo {n}',
  pdfAnnotColor: 'Warna {n}',
  pdfAnnotRemove: 'Hapus tanda',
  pdfAnnotMarkupTitle: 'Warna tanda',
  pdfAnnotClearSelection: 'Batalkan pilihan',
  pdfAnnotNoText: 'Halaman ini tidak memiliki teks yang dapat dipilih.',
  pdfAnnotOpenNote: 'Buka catatan',
  pdfAnnotFailed: 'Anotasi tidak dapat diubah.',
  pdfAnnotNewNote: 'Catatan baru',
  pdfAnnotReplyPlaceholder: 'Tulis balasan',
} as const satisfies Record<keyof typeof zh, string>
