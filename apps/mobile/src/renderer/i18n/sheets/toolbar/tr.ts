import type { zh } from './zh'

export const tr = {
  sheetsToolbarFormat: 'Hücre biçimi',
  sheetsToolbarRows: 'Satırlar ve sütunlar',
  sheetsToolbarSort: 'Sırala ve filtrele',
  sheetsToolbarInsert: 'Ekle',
  sheetsToolbarInsertValues: 'Tarihler ve sayfalar',
  sheetsToolbarToday: 'Bugünün tarihi',
  sheetsToolbarTimeNow: 'Şu anki saat',
  sheetsToolbarNewSheet: 'Yeni sayfa',
  sheetsToolbarFind: 'Bul',
  sheetsToolbarViewOnly:
    'Grafikler, pivot tablolar ve koşullu biçimlendirme burada yalnızca görüntülenir. Değiştirmek için dosyayı bir bilgisayarda açın.',
  sheetsToolbarFullLoaded:
    'Çalışma kitabının tamamı yüklendi. Sıralama veya filtreye yeniden dokunun.',
} as const satisfies Record<keyof typeof zh, string>
