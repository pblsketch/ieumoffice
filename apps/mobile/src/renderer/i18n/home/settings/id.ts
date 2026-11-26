import type { zh } from './zh'

export const id = {
  homeSetEditorsTitle: 'Editor',
  homeSetEditorsHint:
    'Editor yang dimatikan tidak muncul di daftar dokumen baru. Jika semua dimatikan, semuanya dianggap menyala.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Alat PDF',
  homeSetCardsTitle: 'Dokumen baru di layar beranda',
  homeSetCardShow: 'Tampilkan {name} di layar beranda',
  homeSetCardUp: 'Naikkan {name}',
  homeSetCardDown: 'Turunkan {name}',
  homeSetKeepScreenOn: 'Biarkan layar menyala saat membaca',
  homeSetKeepScreenOnDesc:
    'Layar tidak mati saat Anda membaca PDF atau EPUB atau mempresentasikan PPT.',
  homeSetFoldersTitle: 'Folder dokumen',
  homeSetFoldersEmpty:
    'Belum ada folder yang ditautkan. Tautkan folder untuk melihat filenya langsung di tab Folder.',
  homeSetFolderLink: 'Tautkan folder',
  homeSetFolderRelink: 'Tautkan lagi',
  homeSetFolderRemove: 'Lepaskan',
  homeSetFolderRemoveNamed: 'Lepaskan {name}',
  homeSetFolderOk: 'Tertaut',
  homeSetFolderLost:
    'Folder ini tidak dapat diakses. Jika sudah dipindahkan atau dihapus, tautkan lagi.',
  homeSetFolderRemoveTitle: 'Lepaskan folder "{name}"?',
  homeSetFolderRemoveBody:
    '{count} entri terbaru dan favorit untuk file di folder ini juga akan dilepas. File-nya sendiri tidak dihapus.',
  homeSetBackupsTotal: 'Total {size}',
  homeSetStorageTitle: 'Penyimpanan',
  homeSetStorageRecovery: 'Salinan pemulihan',
  homeSetStorageTemp: 'File sementara',
  homeSetStorageBackups: 'Cadangan asli HWP',
  homeSetStorageClearTemp: 'Hapus file sementara',
  homeSetStorageClearRecovery: 'Hapus semua salinan pemulihan',
  homeSetStorageClearTempTitle: 'Hapus file sementara?',
  homeSetStorageClearTempBody:
    'File yang dibuat sebentar saat berbagi atau menerima akan dihapus. Dokumen Anda tetap seperti semula.',
  homeSetStorageClearRecoveryTitle: 'Hapus semua salinan pemulihan?',
  homeSetStorageClearRecoveryBody:
    'Perubahan yang belum disimpan akan hilang. Salinan pemulihan dokumen yang sedang terbuka tetap disimpan.',
  homeSetStorageClearAction: 'Hapus',
  homeSetStorageCleared: '{size} dikosongkan.',
  homeSetFailed: 'Tidak berhasil. Coba lagi sebentar lagi.',
} as const satisfies Record<keyof typeof zh, string>
