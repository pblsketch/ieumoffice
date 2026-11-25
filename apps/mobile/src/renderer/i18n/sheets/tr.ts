import type { zh } from './zh'

export const tr = {
  sheetsProvisionalNotice: 'Deneme ızgarası: değişiklikleriniz henüz kaydedilmiyor.',
  sheetsLoading: 'Izgara yükleniyor…',
  sheetsShareFailed: 'Bu dosya paylaşılamadı.',
  sheetsFreezeTopRow: 'Üst satırı dondur',
  sheetsFreezeFirstColumn: 'İlk sütunu dondur',
  sheetsUnfreeze: 'Bölmeleri çöz',
  sheetsKeyboardBar: 'Formül giriş araçları',
  sheetsInsertSum: 'Toplam işlevi',
  sheetsInsertParens: 'Parantez',
  sheetsNumericKeys: 'Sayı klavyesi',
  sheetsCancelEdit: 'İptal',
  sheetsConfirmEdit: 'Tamam',
} as const satisfies Record<keyof typeof zh, string>
