import type { zh } from './zh'

export const tr = {
  pdfEditPen: 'Kalem',
  pdfEditHighlighter: 'Vurgulayıcı',
  pdfEditTextBox: 'Metin kutusu',
  pdfEditSign: 'İmzala',
  pdfEditPages: 'Sayfaları düzenle',
  pdfEditLink: 'Bağlantı ekle',
  pdfEditSaveFailed: 'Kaydedilemedi. Değişiklikleriniz korunuyor ve dosya değiştirilmedi.',
  pdfEditSaveSkipped: 'Sayfa {pages} üzerindeki bazı metin düzenlemeleri kaydedilemedi.',
  pdfEditShareFailed: 'Paylaşılamadı.',
  pdfEditReloadFailed: 'Kaydedildi ancak belge yeniden yüklenemedi. Dosyayı yeniden açın.',
  pdfEditSignatureUnavailable: 'İmzalama henüz kullanılamıyor.',
  pdfEditSaveAsHint:
    'Vurguların, notların ve çizimlerin kopyada nasıl ele alınacağını seçin. “Sayfalara işle” form alanlarını da işler; “Açıklamaları dışarıda bırak” bağlantıları ve form alanlarını korur.',
  pdfEditKeepAnnots: 'Açıklamaları koru (diğer uygulamalarda düzenlenebilir)',
  pdfEditFlattenAnnots: 'Sayfalara işle (her uygulamada görünür)',
  pdfEditStripAnnots: 'Açıklamaları dışarıda bırak (bağlantılar ve form alanları kalır)',
  pdfEditSaveVerifyFailed:
    'Sayfa {pages} üzerindeki değişiklikler eksiksiz geri yazılamadı; bu yüzden kaydetme iptal edildi ve dosyaya dokunulmadı. Etkilenen düzenlemeyi geri alıp yeniden deneyin',
} as const satisfies Record<keyof typeof zh, string>
