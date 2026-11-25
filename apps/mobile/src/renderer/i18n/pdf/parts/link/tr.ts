import type { zh } from './zh'

export const tr = {
  pdfLinkPlaceHint: 'Bağlantının gideceği yere sayfada bir kutu sürükleyin',
  pdfLinkEditTitle: 'Bağlantıyı düzenle',
  pdfLinkUrlLabel: 'Web adresi (http, https, mailto)',
  pdfLinkPageLabel: 'Veya bu belgede bir sayfa (1–{count})',
  pdfLinkUrlInvalid: 'Yalnızca http, https ve mailto adreslerine bağlantı verilebilir',
  pdfLinkPageInvalid: '1 ile {count} arasında bir sayfa numarası girin',
  pdfLinkNeedTarget: 'Bir web adresi veya sayfa numarası girin',
  pdfLinkApply: 'Bağlantı ekle',
  pdfLinkDelete: 'Bağlantıyı sil',
  pdfLinkPending: 'Eklenecek bağlantı: {target}',
  pdfLinkToPage: 'Sayfa {page}',
  pdfLinkFailed: 'Bağlantı değiştirilemedi. Kaydetme bitince yeniden deneyin.',
  pdfLinkUpdate: 'Uygula',
} as const satisfies Record<keyof typeof zh, string>
