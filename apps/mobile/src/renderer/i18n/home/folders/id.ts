import type { zh } from './zh'

export const id = {
  homeFolderListLabel: 'Folder tertaut',
  homeFolderEmptyTitle: 'Belum ada folder yang ditautkan',
  homeFolderEmptyBody:
    'Tautkan folder yang sering dipakai, lalu dokumen dan gambarnya langsung muncul di sini.',
  homeFolderLink: 'Tambah folder',
  homeFolderRelink: 'Tautkan lagi',
  homeFolderRelinkNamed: 'Tautkan {name} lagi',
  homeFolderOk: 'Tertaut',
  homeFolderLostRevoked: 'Izin untuk folder ini hilang. Tautkan lagi.',
  homeFolderLostMissing:
    'Folder ini tidak ditemukan. Jika sudah dipindahkan atau dihapus, tautkan lagi.',
  homeFolderLost: 'Folder tidak dapat diakses. Tautkan lagi.',
  homeFolderMenu: 'Menu untuk {name}',
  homeFolderRemove: 'Lepaskan',
  homeFolderRemoveTitle: 'Lepaskan folder "{name}"?',
  homeFolderRemoveBody:
    '{count} entri terbaru dan favorit untuk file di folder ini juga akan dilepas. File-nya sendiri tidak dihapus.',
  homeFolderRemoved: 'Folder dilepaskan.',
  homeFolderBack: 'Folder di atasnya',
  homeFolderPath: 'Folder saat ini',
  homeFolderSubfolder: 'Folder',
  homeFolderInsideEmpty: 'Tidak ada dokumen atau gambar yang bisa dibuka di folder ini.',
} as const satisfies Record<keyof typeof zh, string>
