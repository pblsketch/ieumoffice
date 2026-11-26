import type { zh } from './zh'

export const fr = {
  aiOutboundTitle: 'Récupérer cette adresse ?',
  aiOutboundIntro: 'L’IA veut récupérer une adresse qui n’est pas apparue dans la conversation.',
  aiOutboundHint:
    'Si l’adresse contient du texte de votre document ou si le site vous est inconnu, bloquez-la.',
  aiOutboundBlock: 'Bloquer',
  aiOutboundAllow: 'Autoriser',
} as const satisfies Record<keyof typeof zh, string>
