import type { zh } from './zh'

export const tr = {
  sheetsAiUndoRefused:
    'Sayfa, yapay zekânın değişikliklerinden sonra düzenlendiği için bunlar geri alınmadı.',
  sheetsAiUndoPartial:
    'Yapay zekânın bazı değişiklikleri geri alınamadı. Lütfen sayfayı kontrol edin.',
  sheetsAiUndoExpired:
    'Yapay zekânın değişiklikleri artık tek adımda geri alınamaz (çalışma kitabı sonradan kaydedildi veya çok düzenlendi). Geri Al düğmesini kullanın.',
} as const satisfies Record<keyof typeof zh, string>
