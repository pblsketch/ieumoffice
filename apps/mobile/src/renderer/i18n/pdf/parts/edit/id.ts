import type { zh } from './zh'

export const id = {
  pdfEditPen: 'Pena',
  pdfEditHighlighter: 'Stabilo',
  pdfEditTextBox: 'Kotak teks',
  pdfEditSign: 'Tanda tangan',
  pdfEditPages: 'Atur halaman',
  pdfEditLink: 'Sisipkan tautan',
  pdfEditSaveFailed: 'Tidak dapat menyimpan. Perubahan Anda tetap ada dan file tidak diubah.',
  pdfEditSaveSkipped: 'Beberapa suntingan teks di halaman {pages} tidak dapat disimpan.',
  pdfEditShareFailed: 'Tidak dapat membagikan.',
  pdfEditReloadFailed: 'Tersimpan, tetapi dokumen tidak dapat dimuat ulang. Buka file lagi.',
  pdfEditSignatureUnavailable: 'Tanda tangan belum tersedia.',
  pdfEditSaveAsHint:
    'Pilih cara sorotan, catatan, dan gambar diperlakukan dalam salinan. “Bakar ke halaman” juga membakar kolom formulir; “Tanpa anotasi” mempertahankan tautan dan kolom formulir.',
  pdfEditKeepAnnots: 'Pertahankan anotasi (dapat diedit di aplikasi lain)',
  pdfEditFlattenAnnots: 'Bakar ke halaman (terlihat di semua aplikasi)',
  pdfEditStripAnnots: 'Tanpa anotasi (tautan dan kolom formulir tetap)',
  pdfEditSaveVerifyFailed:
    'Perubahan di halaman {pages} tidak dapat ditulis kembali secara utuh; penyimpanan dibatalkan dan file tidak diubah. Urungkan pengeditan terkait lalu coba lagi',
} as const satisfies Record<keyof typeof zh, string>
