import type { zh } from './zh'

export const nl = {
  aiOutboundTitle: 'Dit adres ophalen?',
  aiOutboundIntro: 'De AI wil een adres ophalen dat niet in het gesprek is voorgekomen.',
  aiOutboundHint:
    'Blokkeer het als het adres tekst uit je document bevat of als je de site niet kent.',
  aiOutboundBlock: 'Blokkeren',
  aiOutboundAllow: 'Toestaan',
} as const satisfies Record<keyof typeof zh, string>
