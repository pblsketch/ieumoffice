import type { zh } from './zh'

export const en = {
  sheetsProvisionalNotice: 'Trial grid: your changes are not saved yet.',
  sheetsLoading: 'Loading the grid…',
  sheetsShareFailed: 'Could not share this file.',
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
