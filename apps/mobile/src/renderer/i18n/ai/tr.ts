import type { zh } from './zh'

export const tr = {
  aiOutboundTitle: 'Bu adres getirilsin mi?',
  aiOutboundIntro: 'Yapay zekâ, sohbette hiç geçmemiş bir adresi getirmek istiyor.',
  aiOutboundHint: 'Adreste belgenizden metin varsa ya da siteyi tanımıyorsanız engelleyin.',
  aiOutboundBlock: 'Engelle',
  aiOutboundAllow: 'İzin ver',
} as const satisfies Record<keyof typeof zh, string>
