import type { zh } from './zh'

export const tr = {
  sheetsShareFailed: 'Bu dosya paylaşılamadı.',
  sheetsSaveFailed: 'Kaydedilemedi. Özgün dosya değişmedi.',
  sheetsSaveAsTitle: 'Farklı Kaydet',
  sheetsShareTitle: 'Şu biçimde paylaş',
  sheetsFormatWorkbook: 'Excel çalışma kitabı (.xlsx)',
  sheetsFormatWorkbookMacro: 'Excel makro içerebilen çalışma kitabı (.xlsm)',
  sheetsFormatCsv: 'CSV (yalnızca geçerli sayfa)',
  sheetsFormatOds: 'ODS elektronik tablosu (çalışma kitabının kopyası)',
  sheetsFormatPdf: 'PDF (geçerli sayfa)',
  sheetsOdsEncrypted: 'Parolalı bir çalışma kitabı ODS olarak dışa aktarılamaz.',
  sheetsChoiceCancel: 'İptal',
  sheetsCsvAskTitle: 'CSV dosyasını kaydet',
  sheetsCsvAskMessage: 'CSV dosyası yalnızca geçerli sayfanın değerlerini tutar.',
  sheetsCsvAskCsv: 'CSV olarak kaydet (biçimlendirme ve diğer sayfalar alınmaz)',
  sheetsCsvAskXlsx: 'Excel dosyası olarak kaydet',
  sheetsCsvFormulaTitle: 'Formüllerin yalnızca değerleri kalır',
  sheetsCsvFormulaMessage:
    'Bu sayfanın formülleri CSV dosyasında yalnızca hesaplanmış değerler olarak kalır. Formülleri korumak için Excel dosyası olarak kaydedin.',
  sheetsCsvContinue: 'CSV olarak devam et',
  sheetsOdsLossTitle: 'ODS olarak dışa aktar',
  sheetsOdsLossMessage:
    'ODS’nin tutamadığı {count} özellik (formüller, grafikler, resimler, koşullu biçimlendirme vb.) kopyada yer almaz.',
  sheetsOdsContinue: 'Devam et',
  sheetsOdsUnreadable: 'Oluşturulan ODS dosyası yeniden açılamadığı için yazılmadı.',
  sheetsOdsFailed: 'ODS olarak dışa aktarılamadı.',
  sheetsCopySaved: 'Kopya kaydedildi: {name}',
  sheetsPdfWorking: 'PDF oluşturuluyor…',
  sheetsPdfFailed: 'PDF oluşturulamadı.',
  sheetsPdfSkippedVisuals: '{count} resim veya grafik PDF’ye konulamadı.',
  sheetsPdfMissingGlyphs:
    'Yazı tiplerinde olmayan {count} karakter PDF’de boş kutu olarak görünür.',
  sheetsSaveErrDiskChanged:
    'Açıldıktan sonra başka bir uygulama özgün dosyayı değiştirdi. Üzerine yazılmadı; Farklı Kaydet’i kullanın.',
  sheetsSaveErrTooLarge:
    'Dosya bu telefonda yazılamayacak kadar büyük (yaklaşık 14 MB’den fazla). Özgün dosya değişmedi.',
  sheetsSaveErrUnreadable:
    'Kaydedilen çalışma kitabı yeniden açılamadığı için özgün dosya olduğu gibi bırakıldı.',
  sheetsSaveErrLockFailed:
    'Çalışma kitabı parolasıyla yeniden kilitlenemediği için özgün dosya olduğu gibi bırakıldı.',
  sheetsSaveBusy: 'Kaydetme sürüyor. Bitince yeniden deneyin.',
} as const satisfies Record<keyof typeof zh, string>
