import type { zh } from './zh'

export const id = {
  sheetsProvisionalNotice: 'Kisi uji coba: perubahan Anda belum disimpan.',
  sheetsLoading: 'Memuat kisi…',
  sheetsShareFailed: 'Tidak dapat membagikan file ini.',
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
