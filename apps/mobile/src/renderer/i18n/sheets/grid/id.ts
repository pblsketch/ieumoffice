import type { zh } from './zh'

export const id = {
  sheetsFreezeTopRow: 'Bekukan baris atas',
  sheetsFreezeFirstColumn: 'Bekukan kolom pertama',
  sheetsUnfreeze: 'Lepaskan bekuan panel',
  sheetsKeyboardBar: 'Alat input rumus',
  sheetsInsertSum: 'Fungsi jumlah',
  sheetsInsertParens: 'Tanda kurung',
  sheetsNumericKeys: 'Keyboard angka',
  sheetsCancelEdit: 'Batal',
  sheetsConfirmEdit: 'Selesai',
} as const satisfies Record<keyof typeof zh, string>
