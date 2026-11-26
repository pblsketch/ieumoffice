import type { zh } from './zh'

export const de = {
  aiOutboundTitle: 'Diese Adresse abrufen?',
  aiOutboundIntro: 'Die KI möchte eine Adresse abrufen, die im Gespräch nicht vorkam.',
  aiOutboundHint:
    'Enthält die Adresse Text aus Ihrem Dokument oder kennen Sie die Website nicht, blockieren Sie sie.',
  aiOutboundBlock: 'Blockieren',
  aiOutboundAllow: 'Zulassen',
} as const satisfies Record<keyof typeof zh, string>
