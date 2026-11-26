import type { zh } from './zh'

export const pl = {
  sheetsFreezeTopRow: 'Zablokuj górny wiersz',
  sheetsFreezeFirstColumn: 'Zablokuj pierwszą kolumnę',
  sheetsUnfreeze: 'Odblokuj okienka',
  sheetsKeyboardBar: 'Narzędzia wprowadzania formuł',
  sheetsInsertSum: 'Funkcja sumy',
  sheetsInsertParens: 'Nawiasy',
  sheetsNumericKeys: 'Klawiatura numeryczna',
  sheetsCancelEdit: 'Anuluj',
  sheetsConfirmEdit: 'Gotowe',
} as const satisfies Record<keyof typeof zh, string>
