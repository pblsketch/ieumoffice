import type { zh } from './zh'

export const id = {
  homeTabNav: 'Menu beranda',
  homeTabRecent: 'Terbaru',
  homeTabFolders: 'Folder',
  homeTabTools: 'Alat',
  homeTabSettings: 'Pengaturan',
  homeListAll: 'Semua',
  homeListFavorites: 'Favorit',
  homeListChips: 'Saring daftar',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'Belum ada favorit. Gunakan [⋯] pada file untuk menambahkannya ke favorit.',
  homeListGroupEmpty: 'Belum ada file di grup ini.',
  homeListFavoriteLost: 'File ini tidak bisa dibuka. Mungkin sudah dipindahkan atau dihapus.',
  homeEmptyText: 'Anda belum membuka dokumen apa pun. Coba dokumen contoh atau buka sebuah file.',
  homeEmptySample: 'Buka dokumen contoh',
  homeEmptyCreate: 'Buat baru',
  homeCreateFab: 'Buat baru',
  homeCreateTitle: 'Buat baru',
  homeCreateClose: 'Tutup',
  homeCreatePdfTools: 'Alat PDF',
} as const satisfies Record<keyof typeof zh, string>
