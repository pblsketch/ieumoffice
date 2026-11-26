import type { zh } from './zh'

export const es = {
  aiOutboundTitle: '¿Obtener esta dirección?',
  aiOutboundIntro: 'La IA quiere obtener una dirección que no ha aparecido en la conversación.',
  aiOutboundHint:
    'Si la dirección contiene texto de tu documento o el sitio es desconocido, bloquéala.',
  aiOutboundBlock: 'Bloquear',
  aiOutboundAllow: 'Permitir',
} as const satisfies Record<keyof typeof zh, string>
