import type { zh } from './zh'

export const zhTW = {
  sheetsFreezeTopRow: '凍結首列',
  sheetsFreezeFirstColumn: '凍結首欄',
  sheetsUnfreeze: '取消凍結窗格',
  sheetsKeyboardBar: '公式輸入工具',
  sheetsInsertSum: '加總函數',
  sheetsInsertParens: '括號',
  sheetsNumericKeys: '數字鍵盤',
  sheetsCancelEdit: '取消',
  sheetsConfirmEdit: '確定',
} as const satisfies Record<keyof typeof zh, string>
