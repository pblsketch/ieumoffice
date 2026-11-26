import type { zh } from './zh'

export const ms = {
  sheetsShareFailed: 'Tidak dapat berkongsi fail ini.',
  sheetsSaveFailed: 'Tidak dapat menyimpan. Fail asal tidak berubah.',
  sheetsSaveNotYet: 'Buku kerja ini belum boleh disimpan pada telefon.',
} as const satisfies Record<keyof typeof zh, string>
