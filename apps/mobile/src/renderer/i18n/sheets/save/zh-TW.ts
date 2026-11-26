import type { zh } from './zh'

export const zhTW = {
  sheetsShareFailed: '無法分享此檔案。',
  sheetsSaveFailed: '無法儲存。原始檔案保持不變。',
  sheetsSaveNotYet: '此活頁簿暫時還無法在手機上儲存。',
} as const satisfies Record<keyof typeof zh, string>
