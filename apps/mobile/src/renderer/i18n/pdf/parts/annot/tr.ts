import type { zh } from './zh'

export const tr = {
  pdfAnnotHighlight: 'Vurgu',
  pdfAnnotUnderline: 'Altı çizili',
  pdfAnnotSquiggly: 'Dalgalı çizgi',
  pdfAnnotStrikeout: 'Üstü çizili',
  pdfAnnotModeSelect: 'Metin seç',
  pdfAnnotModeNote: 'Not yerleştir',
  pdfAnnotHintSelect:
    'Seçmek için metnin üzerinde yana sürükleyin veya basılı tutup sürükleyin. Rengini değiştirmek ya da kaldırmak için bir işarete dokunun.',
  pdfAnnotHintNote: 'Notun konacağı yere dokunun.',
  pdfAnnotPen: 'Fosforlu kalem {n}',
  pdfAnnotColor: 'Renk {n}',
  pdfAnnotRemove: 'İşareti kaldır',
  pdfAnnotMarkupTitle: 'İşaret rengi',
  pdfAnnotClearSelection: 'Seçimi temizle',
  pdfAnnotNoText: 'Bu sayfada seçilebilir metin yok.',
  pdfAnnotOpenNote: 'Notu aç',
  pdfAnnotFailed: 'Ek açıklama değiştirilemedi.',
  pdfAnnotNewNote: 'Yeni not',
  pdfAnnotReplyPlaceholder: 'Bir yanıt yazın',
} as const satisfies Record<keyof typeof zh, string>
