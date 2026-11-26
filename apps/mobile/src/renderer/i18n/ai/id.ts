import type { zh } from './zh'

export const id = {
  aiOutboundTitle: 'Ambil alamat ini?',
  aiOutboundIntro: 'AI ingin mengambil alamat yang belum pernah muncul dalam percakapan.',
  aiOutboundHint: 'Jika alamat berisi teks dari dokumen Anda atau situsnya tidak dikenal, blokir.',
  aiOutboundBlock: 'Blokir',
  aiOutboundAllow: 'Izinkan',
} as const satisfies Record<keyof typeof zh, string>
