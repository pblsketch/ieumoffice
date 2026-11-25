import type { zh } from './zh'

export const tr = {
  pdfTextHint: 'Metin eklemek için boş bir yere, düzenlemek için metne dokunun.',
  pdfTextInputLabel: 'Eklenecek metin',
  pdfTextEditLabel: 'Düzenlenecek metin',
  pdfTextStyleBar: 'Metin stili',
  pdfTextBold: 'Kalın',
  pdfTextSize: 'Yazı boyutu',
  pdfTextSizeDown: 'Yazıyı küçült',
  pdfTextSizeUp: 'Yazıyı büyüt',
  pdfTextColor: 'Metin rengi',
  pdfTextColorDocument: 'Belge rengini koru',
  pdfTextFont: 'Yazı tipi',
  pdfTextFontDocument: 'Belge yazı tipi',
  pdfTextBack: 'Geri',
  pdfTextDelete: 'Sil',
  pdfTextDone: 'Tamam',
  pdfTextCannotDraw: 'Bu karakterler eklenemez: {chars}',
  pdfTextFontSubstituted: 'Bu karakterler başka bir yazı tipiyle gösterilecek: {chars}',
  pdfTextScannedPage: 'Bu sayfada metin yok. Yalnızca yeni metin ekleyebilirsiniz.',
  pdfTextNoMatch: 'Bu metin düzenlenemez: belgede bulunamadı.',
  pdfTextOverflow: 'Düzenlenen metin alttaki metnin üzerine taşar. Lütfen kısaltın.',
} as const satisfies Record<keyof typeof zh, string>
