import type { zh } from './zh'

export const ms = {
  pdfEditPen: 'Pen',
  pdfEditHighlighter: 'Penyerlah',
  pdfEditTextBox: 'Kotak teks',
  pdfEditSign: 'Tandatangan',
  pdfEditPages: 'Susun halaman',
  pdfEditLink: 'Sisipkan pautan',
  pdfEditSaveFailed: 'Tidak dapat menyimpan. Perubahan anda kekal dan fail tidak diubah.',
  pdfEditSaveSkipped: 'Sesetengah suntingan teks di halaman {pages} tidak dapat disimpan.',
  pdfEditShareFailed: 'Tidak dapat berkongsi.',
  pdfEditReloadFailed:
    'Disimpan, tetapi dokumen tidak dapat dimuatkan semula. Buka fail sekali lagi.',
  pdfEditSignatureUnavailable: 'Tandatangan belum tersedia.',
  pdfEditSaveAsHint:
    'Pilih cara sorotan, nota dan lukisan dikendalikan dalam salinan. “Bakar ke halaman” turut membakar medan borang; “Tinggalkan anotasi” mengekalkan pautan dan medan borang.',
  pdfEditKeepAnnots: 'Kekalkan anotasi (boleh diedit dalam aplikasi lain)',
  pdfEditFlattenAnnots: 'Bakar ke halaman (kelihatan dalam semua aplikasi)',
  pdfEditStripAnnots: 'Tinggalkan anotasi (pautan dan medan kekal)',
  pdfEditSaveVerifyFailed:
    'Perubahan pada halaman {pages} tidak dapat ditulis semula sepenuhnya; penyimpanan dibatalkan dan fail tidak diubah. Buat asal suntingan berkaitan dan cuba lagi',
} as const satisfies Record<keyof typeof zh, string>
