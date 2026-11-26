import type { zh } from './zh'

export const zhTW = {
  webNotUtf8Notice: '此檔案不是 UTF-8 編碼，無法編輯。仍可檢視並分享原始檔案。',
} as const satisfies Record<keyof typeof zh, string>
