import type { zh } from './zh'

export const ja = {
  sheetsFreezeTopRow: '先頭行を固定',
  sheetsFreezeFirstColumn: '先頭列を固定',
  sheetsUnfreeze: 'ウィンドウ枠の固定を解除',
  sheetsKeyboardBar: '数式入力ツール',
  sheetsInsertSum: '合計関数',
  sheetsInsertParens: 'かっこ',
  sheetsNumericKeys: '数字キーボード',
  sheetsCancelEdit: 'キャンセル',
  sheetsConfirmEdit: '確定',
} as const satisfies Record<keyof typeof zh, string>
