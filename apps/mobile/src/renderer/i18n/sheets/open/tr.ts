import type { zh } from './zh'

export const tr = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Izgara yükleniyor…',
  sheetsOpening: 'Çalışma kitabı açılıyor… Büyük dosyalar biraz zaman alır.',
  sheetsPasswordTitle: 'Parola korumalı çalışma kitabı',
  sheetsPasswordMessage: 'Bu çalışma kitabını açmak için parolayı girin.',
  sheetsPasswordLabel: 'Parola',
  sheetsPasswordWrong: 'Parola yanlış. Yeniden deneyin.',
  sheetsPasswordOpen: 'Aç',
  sheetsPasswordCancel: 'İptal',
  sheetsEncryptionUnsupported: 'Bu tür parola koruması açılamaz.',
  sheetsEncryptionDamaged: 'Bu korumalı çalışma kitabı bozuk ve açılamıyor.',
  sheetsNoticeMacros: 'Makrolar korunur ancak çalıştırılmaz.',
  sheetsNoticeExternalLinks: 'Başka dosyalara bağlanan hücreler son kaydedilen değerleri gösterir.',
  sheetsNoticeMacrosAndLinks:
    'Makrolar korunur ancak çalıştırılmaz. Başka dosyalara bağlanan hücreler son kaydedilen değerleri gösterir.',
} as const satisfies Record<keyof typeof zh, string>
