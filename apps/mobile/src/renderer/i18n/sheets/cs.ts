import type { zh } from './zh'

export const cs = {
  sheetsProvisionalNotice: 'Zkušební mřížka: změny se zatím neukládají.',
  sheetsLoading: 'Načítání mřížky…',
  sheetsShareFailed: 'Tento soubor se nepodařilo sdílet.',
  sheetsFreezeTopRow: 'Ukotvit horní řádek',
  sheetsFreezeFirstColumn: 'Ukotvit první sloupec',
  sheetsUnfreeze: 'Uvolnit příčky',
  sheetsKeyboardBar: 'Nástroje pro zadávání vzorců',
  sheetsInsertSum: 'Funkce součtu',
  sheetsInsertParens: 'Závorky',
  sheetsNumericKeys: 'Číselná klávesnice',
  sheetsCancelEdit: 'Zrušit',
  sheetsConfirmEdit: 'Hotovo',
} as const satisfies Record<keyof typeof zh, string>
