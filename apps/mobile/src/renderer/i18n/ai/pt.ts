import type { zh } from './zh'

export const pt = {
  aiOutboundTitle: 'Buscar este endereço?',
  aiOutboundIntro: 'A IA quer buscar um endereço que não apareceu na conversa.',
  aiOutboundHint:
    'Se o endereço contiver texto do seu documento ou o site for desconhecido, bloqueie-o.',
  aiOutboundBlock: 'Bloquear',
  aiOutboundAllow: 'Permitir',
} as const satisfies Record<keyof typeof zh, string>
