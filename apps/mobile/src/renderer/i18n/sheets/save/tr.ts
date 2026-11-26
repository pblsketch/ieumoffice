import type { zh } from './zh'

export const tr = {
  sheetsShareFailed: 'Bu dosya paylaşılamadı.',
  sheetsSaveFailed: 'Kaydedilemedi. Özgün dosya değişmedi.',
  sheetsSaveNotYet: 'Bu çalışma kitabı henüz telefonda kaydedilemiyor.',
} as const satisfies Record<keyof typeof zh, string>
