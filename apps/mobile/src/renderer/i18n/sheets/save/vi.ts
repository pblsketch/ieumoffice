import type { zh } from './zh'

export const vi = {
  sheetsShareFailed: 'Không thể chia sẻ tệp này.',
  sheetsSaveFailed: 'Không thể lưu. Tệp gốc vẫn giữ nguyên.',
  sheetsSaveNotYet: 'Chưa thể lưu sổ làm việc này trên điện thoại.',
} as const satisfies Record<keyof typeof zh, string>
