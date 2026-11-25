import type { zh } from './zh'

export const ms = {
  homeSetEditorsTitle: 'Editor',
  homeSetEditorsHint:
    'Editor yang dimatikan tidak muncul dalam senarai dokumen baharu. Jika semua dimatikan, semuanya dikira hidup.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Alat PDF',
  homeSetCardsTitle: 'Dokumen baharu pada skrin utama',
  homeSetCardShow: 'Tunjukkan {name} pada skrin utama',
  homeSetCardUp: 'Alihkan {name} ke atas',
  homeSetCardDown: 'Alihkan {name} ke bawah',
  homeSetKeepScreenOn: 'Biarkan skrin hidup semasa membaca',
  homeSetKeepScreenOnDesc:
    'Skrin tidak padam semasa anda membaca PDF atau EPUB atau membentangkan PPT.',
  homeSetFoldersTitle: 'Folder dokumen',
  homeSetFoldersEmpty:
    'Belum ada folder yang dipautkan. Pautkan folder untuk melihat failnya terus dalam tab Folder.',
  homeSetFolderLink: 'Pautkan folder',
  homeSetFolderRelink: 'Pautkan semula',
  homeSetFolderRemove: 'Alih keluar',
  homeSetFolderRemoveNamed: 'Alih keluar {name}',
  homeSetFolderOk: 'Dipautkan',
  homeSetFolderLost:
    'Folder ini tidak dapat dicapai. Jika anda telah memindahkan atau memadamnya, pautkan semula.',
  homeSetFolderRemoveTitle: 'Alih keluar folder "{name}"?',
  homeSetFolderRemoveBody:
    '{count} entri terkini dan kegemaran bagi fail dalam folder ini juga akan dialih keluar. Fail itu sendiri kekal.',
  homeSetBackupsTotal: 'Jumlah {size}',
  homeSetStorageTitle: 'Storan',
  homeSetStorageRecovery: 'Salinan pemulihan',
  homeSetStorageTemp: 'Fail sementara',
  homeSetStorageBackups: 'Sandaran asal HWP',
  homeSetStorageClearTemp: 'Kosongkan fail sementara',
  homeSetStorageClearRecovery: 'Kosongkan semua salinan pemulihan',
  homeSetStorageClearTempTitle: 'Kosongkan fail sementara?',
  homeSetStorageClearTempBody:
    'Fail yang dibuat seketika semasa berkongsi atau menerima akan dipadam. Dokumen anda kekal seperti biasa.',
  homeSetStorageClearRecoveryTitle: 'Kosongkan semua salinan pemulihan?',
  homeSetStorageClearRecoveryBody:
    'Perubahan yang belum disimpan akan hilang. Salinan pemulihan dokumen yang sedang dibuka disimpan.',
  homeSetStorageClearAction: 'Kosongkan',
  homeSetStorageCleared: '{size} dikosongkan.',
  homeSetFailed: 'Tidak berjaya. Cuba lagi sebentar lagi.',
} as const satisfies Record<keyof typeof zh, string>
