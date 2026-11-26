import type { zh } from './zh'

export const it = {
  aiOutboundTitle: 'Recuperare questo indirizzo?',
  aiOutboundIntro: 'L’IA vuole recuperare un indirizzo che non è comparso nella conversazione.',
  aiOutboundHint: 'Se l’indirizzo contiene testo del documento o il sito è sconosciuto, bloccalo.',
  aiOutboundBlock: 'Blocca',
  aiOutboundAllow: 'Consenti',
} as const satisfies Record<keyof typeof zh, string>
