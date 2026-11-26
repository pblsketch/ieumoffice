import type { zh } from './zh'

export const tr = {
  homeRunEditorOffTitle: '{name} düzenleyicisi devre dışı',
  homeRunEditorOffBody:
    'Bu dosyayı açmak için düzenleyiciyi etkinleştirin. Ayarlar’dan istediğiniz zaman yeniden kapatabilirsiniz.',
  homeRunEditorOffConfirm: 'Etkinleştir ve aç',
  homeRunStripSample: 'Örnek belge · Salt okunur',
  homeRunStripReceived: 'Alınan dosya · Salt okunur',
  homeRunStripReadOnly: 'Salt okunur',
  homeRunStripCopy: 'Kopyayı düzenle',
  homeRunStripClose: 'Bildirimi kapat',
  homeRunReceiveTitle: 'Alınan dosyalar',
  homeRunReceiveCount: '{count} dosya',
  homeRunReceiveClose: 'Alınan dosyaları kapat',
  homeRunReceiveOpen: 'Aç',
  homeRunReceivePdfOff: 'PDF araçları devre dışı',
  homeRunReceivePdfOn: 'Etkinleştir ve devam et',
  homeRunGuideLabel: 'Hoş geldiniz rehberi',
  homeRunStep: 'Adım {current}/{total}',
  homeRunWelcomeTitle: 'Hoş geldiniz',
  homeRunWelcomeBody:
    'GenOffice ile HWP, PDF, Markdown ve daha fazla belgeyi açıp düzenleyin. Hesap yok, reklam yok; belgeleriniz bu cihazda kalır.',
  homeRunNext: 'İleri',
  homeRunSkip: 'Atla',
  homeRunFolderTitle: 'Belge klasörü bağla (isteğe bağlı)',
  homeRunFolderBody:
    'Sık kullandığınız bir klasörü bağlarsanız dosyaları doğrudan [Klasörler] sekmesinde görünür.',
  homeRunFolderPick: 'Klasör seç',
  homeRunLater: 'Daha sonra',
  homeRunFolderLinked: '✓ Belge klasörü bağlandı · Ayarlar’dan değiştirebilirsiniz',
  homeRunStart: 'Başlayın',
  homeRunTipEditButton: 'Değişiklik yapmak için [Düzenle] düğmesine dokunun',
  homeRunTipFlowView: 'Kolay okuma için akış görünümüne geçildi · Sayfa görünümü burada',
  homeRunTipFirstEdit:
    'Kurtarma kopyası otomatik olarak oluşturulur. Asıl dosya [Bitti] düğmesine dokunduğunuzda kaydedilir',
  homeRunTipFirstKeyboard: 'Metin biçimini [Aa] ile değiştirin',
} as const satisfies Record<keyof typeof zh, string>
