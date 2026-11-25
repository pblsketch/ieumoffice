import type { zh } from './zh'

export const ms = {
  homeFolderListLabel: 'Folder dipautkan',
  homeFolderEmptyTitle: 'Belum ada folder dipautkan',
  homeFolderEmptyBody:
    'Pautkan folder yang kerap digunakan, dan dokumen serta gambarnya terus muncul di sini.',
  homeFolderLink: 'Pautkan folder',
  homeFolderRelink: 'Pautkan semula',
  homeFolderRelinkNamed: 'Pautkan semula {name}',
  homeFolderOk: 'Dipautkan',
  homeFolderLostRevoked: 'Kebenaran untuk folder ini telah hilang. Pautkan semula.',
  homeFolderLostMissing:
    'Folder ini tidak ditemui. Jika anda telah memindahkan atau memadamnya, pautkan semula.',
  homeFolderLost: 'Folder tidak dapat dicapai. Pautkan semula.',
  homeFolderMenu: 'Menu untuk {name}',
  homeFolderRemove: 'Alih keluar',
  homeFolderRemoveTitle: 'Alih keluar folder "{name}"?',
  homeFolderRemoveBody:
    '{count} entri terkini dan kegemaran bagi fail dalam folder ini juga akan dialih keluar. Fail itu sendiri kekal.',
  homeFolderRemoved: 'Folder dialih keluar.',
  homeFolderBack: 'Folder di atas',
  homeFolderPath: 'Folder semasa',
  homeFolderSubfolder: 'Folder',
  homeFolderInsideEmpty: 'Tiada dokumen atau gambar yang boleh dibuka dalam folder ini.',
} as const satisfies Record<keyof typeof zh, string>
