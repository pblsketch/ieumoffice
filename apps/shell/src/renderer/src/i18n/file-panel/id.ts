import type { zh } from './zh'

export const id = {
  panelTitle: 'File',
  showPanel: 'Tampilkan Panel File',
  hidePanel: 'Sembunyikan Panel File',
  searchPlaceholder: 'Cari file',
  sectionCurrent: 'Folder dokumen ini',
  sectionFolders: 'Folder',
  sectionRecent: 'Terbaru',
  addFolder: 'Tambah folder',
  refresh: 'Segarkan',
  collapseAll: 'Ciutkan semua',
  emptyFolder: 'Tidak ada dokumen yang bisa dibuka di sini',
  folderMissing: 'Folder tidak ditemukan',
  untitledHint:
    'Dokumen ini belum disimpan. Foldernya akan muncul di sini setelah Anda menyimpannya.',
  noResults: 'Tidak ada file yang cocok',
  openMark: 'Terbuka',
  resizePanel: 'Ubah lebar panel file',
  noRecent: 'Tidak ada dokumen terbaru',
  searching: 'Mencari…',
  quickLook: 'Pratinjau Cepat',
} satisfies Record<keyof typeof zh, string>
