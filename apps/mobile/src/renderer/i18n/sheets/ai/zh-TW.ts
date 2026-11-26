import type { zh } from './zh'

export const zhTW = {
  sheetsAiUndoRefused: 'AI 修改後試算表又有變動，因此沒有復原。',
  sheetsAiUndoPartial: 'AI 的部分修改無法復原，請檢查試算表。',
  sheetsAiUndoExpired: '這次 AI 修改已無法一次復原（之後曾儲存或做了許多修改）。請使用復原按鈕。',
} as const satisfies Record<keyof typeof zh, string>
