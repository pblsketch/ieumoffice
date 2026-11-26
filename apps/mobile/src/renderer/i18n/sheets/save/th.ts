import type { zh } from './zh'

export const th = {
  sheetsShareFailed: 'ไม่สามารถแชร์ไฟล์นี้ได้',
  sheetsSaveFailed: 'บันทึกไม่ได้ ไฟล์ต้นฉบับยังเหมือนเดิม',
  sheetsSaveNotYet: 'ยังบันทึกเวิร์กบุ๊กนี้บนโทรศัพท์ไม่ได้',
} as const satisfies Record<keyof typeof zh, string>
