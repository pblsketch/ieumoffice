import type { zh } from './zh'

export const en = {
  sheetsFreezeTopRow: 'Freeze top row',
  sheetsFreezeFirstColumn: 'Freeze first column',
  sheetsUnfreeze: 'Unfreeze panes',
  sheetsKeyboardBar: 'Formula input tools',
  sheetsInsertSum: 'Sum function',
  sheetsInsertParens: 'Parentheses',
  sheetsNumericKeys: 'Number keyboard',
  sheetsCancelEdit: 'Cancel',
  sheetsConfirmEdit: 'Done',
} as const satisfies Record<keyof typeof zh, string>
