import type { zh } from './zh'

export const ms = {
  aiOutboundTitle: 'Ambil alamat ini?',
  aiOutboundIntro: 'AI mahu mengambil alamat yang tidak pernah muncul dalam perbualan.',
  aiOutboundHint:
    'Jika alamat mengandungi teks daripada dokumen anda atau tapak itu tidak dikenali, sekatlah.',
  aiOutboundBlock: 'Sekat',
  aiOutboundAllow: 'Benarkan',
} as const satisfies Record<keyof typeof zh, string>
