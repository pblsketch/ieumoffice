import type { zh } from './zh'

export const ja = {
  sheetsShareFailed: 'このファイルを共有できませんでした。',
  sheetsSaveFailed: '保存できませんでした。元のファイルは変更されていません。',
  sheetsSaveNotYet: 'このブックはまだスマートフォンで保存できません。',
} as const satisfies Record<keyof typeof zh, string>
