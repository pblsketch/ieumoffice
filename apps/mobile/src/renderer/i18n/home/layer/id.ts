import type { zh } from './zh'

export const id = {
  homeRunEditorOffTitle: 'Editor {name} sedang nonaktif',
  homeRunEditorOffBody:
    'Aktifkan untuk membuka file ini. Anda bisa menonaktifkannya lagi di Pengaturan.',
  homeRunEditorOffConfirm: 'Aktifkan dan buka',
  homeRunStripSample: 'Dokumen contoh · Hanya-baca',
  homeRunStripReceived: 'File yang diterima · Hanya-baca',
  homeRunStripReadOnly: 'Hanya-baca',
  homeRunStripCopy: 'Edit salinan',
  homeRunStripClose: 'Tutup pemberitahuan',
  homeRunReceiveTitle: 'File yang diterima',
  homeRunReceiveCount: '{count} file',
  homeRunReceiveClose: 'Tutup file yang diterima',
  homeRunReceiveOpen: 'Buka',
  homeRunReceivePdfOff: 'Alat PDF sedang nonaktif',
  homeRunReceivePdfOn: 'Aktifkan dan lanjutkan',
  homeRunGuideLabel: 'Panduan awal',
  homeRunStep: 'Langkah {current} dari {total}',
  homeRunWelcomeTitle: 'Selamat datang',
  homeRunWelcomeBody:
    'Buka dan edit dokumen HWP, PDF, Markdown, dan lainnya dengan GenOffice. Tanpa akun, tanpa iklan, dan dokumen Anda tetap di perangkat ini.',
  homeRunNext: 'Berikutnya',
  homeRunSkip: 'Lewati',
  homeRunFolderTitle: 'Tautkan folder dokumen (opsional)',
  homeRunFolderBody:
    'Tautkan folder yang sering Anda pakai, dan file di dalamnya langsung muncul di tab [Folder].',
  homeRunFolderPick: 'Pilih folder',
  homeRunLater: 'Nanti',
  homeRunFolderLinked: '✓ Folder dokumen tertaut · Ubah di Pengaturan',
  homeRunStart: 'Mulai',
  homeRunTipEditButton: 'Untuk mengubah, ketuk [Edit]',
  homeRunTipFlowView:
    'Beralih ke tampilan alir agar lebih mudah dibaca · Tampilan halaman ada di sini',
  homeRunTipFirstEdit:
    'Salinan pemulihan dibuat otomatis. File asli disimpan saat Anda mengetuk [Selesai]',
  homeRunTipFirstKeyboard: 'Ubah format teks dengan [Aa]',
} as const satisfies Record<keyof typeof zh, string>
