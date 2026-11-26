import type { zh } from './zh'

export const nl = {
  sheetsFreezeTopRow: 'Bovenste rij blokkeren',
  sheetsFreezeFirstColumn: 'Eerste kolom blokkeren',
  sheetsUnfreeze: 'Titels vrijgeven',
  sheetsKeyboardBar: 'Hulpmiddelen voor formules',
  sheetsInsertSum: 'Somfunctie',
  sheetsInsertParens: 'Haakjes',
  sheetsNumericKeys: 'Numeriek toetsenbord',
  sheetsCancelEdit: 'Annuleren',
  sheetsConfirmEdit: 'Gereed',
} as const satisfies Record<keyof typeof zh, string>
