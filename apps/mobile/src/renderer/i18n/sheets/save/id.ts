import type { zh } from './zh'

export const id = {
  sheetsShareFailed: 'Tidak dapat membagikan file ini.',
  sheetsSaveFailed: 'Tidak dapat menyimpan. File asli tidak berubah.',
  sheetsSaveNotYet: 'Buku kerja ini belum dapat disimpan di ponsel.',
} as const satisfies Record<keyof typeof zh, string>
