import type { zh } from './zh'

export const pl = {
  sheetsProvisionalNotice: 'Arkusz próbny: zmiany nie są jeszcze zapisywane.',
  sheetsLoading: 'Wczytywanie arkusza…',
  sheetsShareFailed: 'Nie udało się udostępnić tego pliku.',
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
