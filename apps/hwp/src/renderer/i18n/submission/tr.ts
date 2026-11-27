import type { zh } from './zh'

export const tr = {
  staleDialogTitle: 'Güncellenmesi gereken öğeler var',
  staleDialogBody:
    'Son düzenlemelerden sonra aşağıdaki öğeler güncel olmayabilir. Devam etmeden önce yenilensin mi?',
  staleActionSave: 'Kaydet',
  staleActionPrint: 'Yazdır',
  staleActionPdf: 'PDF olarak dışa aktar',
  staleActionSubmission: 'Teslim kopyasını kaydet',
  staleBtnRefreshAll: 'Tümünü yenile',
  staleBtnContinue: 'Yine de devam et',
  staleBtnCancel: 'İptal',
  staleReasonPagesChanged: 'Sayfa numaraları değişti',
  staleReasonEntriesChanged: 'Girdiler değişti',
  staleKindTocBody: 'İçindekiler',
  staleKindTocTable: 'Tablolar dizini',
  staleKindTocFigure: 'Şekiller dizini',
  staleKindTocEquation: 'Denklemler dizini',
  staleKindIndex: 'Dizin',
  staleKindBibliography: 'Kaynakça',
  staleManualConfirmTitle: 'El ile düzenlemeler algılandı',
  staleManualConfirmBody:
    'Şu öğelerde el ile değişiklikler bulundu: {items}. Üzerine yazılıp yenilensin mi?',
  staleManualOverwrite: 'Üzerine yaz ve yenile',
  staleManualSkip: 'Atla',
  staleRefreshDone: '{count} öğe güncellendi.',
  staleRefreshFailed: 'Bazı öğeler güncellenemedi: {error}',
  submissionMenuLabel: 'Teslim kopyası olarak kaydet…',
  submissionMenuDesc:
    'Dizin, alıntı ve ayar işaretleri olmadan ayrı ve temiz bir kopya kaydeder.',
  submissionSaving: 'Teslim kopyası oluşturuluyor…',
  submissionSaved: 'Teslim kopyası kaydedildi: {name}',
  submissionSavedTailsLost:
    'Teslim kopyası kaydedildi ({name}). Bazı ana sayfalar veya notlar korunamamış olabilir.',
  submissionFailedProtected:
    'Parola korumalı belgeler teslim kopyası olarak kaydedilemez.',
  submissionFailedTracked:
    'Değişiklik izleme içeren belgeler teslim kopyası olarak kaydedilemez.',
  submissionFailedVerify:
    'Teslim kopyası doğrulaması başarısız oldu ({before} → {after} sayfa). HWPX biçimini deneyin.',
  submissionFailedExport: 'Teslim kopyası oluşturulamadı: {error}',
  submissionFailedWrite: 'Teslim kopyası kaydedilemedi: {error}',
} satisfies Record<keyof typeof zh, string>
