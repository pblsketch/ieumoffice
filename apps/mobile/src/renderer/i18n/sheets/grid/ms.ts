import type { zh } from './zh'

export const ms = {
  sheetsFreezeTopRow: 'Bekukan baris atas',
  sheetsFreezeFirstColumn: 'Bekukan lajur pertama',
  sheetsUnfreeze: 'Nyahbeku anak tetingkap',
  sheetsKeyboardBar: 'Alat input formula',
  sheetsInsertSum: 'Fungsi jumlah',
  sheetsInsertParens: 'Kurungan',
  sheetsNumericKeys: 'Papan kekunci nombor',
  sheetsCancelEdit: 'Batal',
  sheetsConfirmEdit: 'Selesai',
} as const satisfies Record<keyof typeof zh, string>
