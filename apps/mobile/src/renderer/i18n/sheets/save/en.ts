import type { zh } from './zh'

export const en = {
  sheetsShareFailed: 'Could not share this file.',
  sheetsSaveFailed: 'Could not save. The original file is unchanged.',
  sheetsSaveNotYet: 'This workbook cannot be saved on the phone yet.',
} as const satisfies Record<keyof typeof zh, string>
