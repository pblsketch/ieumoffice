import type { zh } from './zh'

export const en = {
  aiOutboundTitle: 'Fetch this address?',
  aiOutboundIntro: 'The AI wants to fetch an address that has not appeared in the conversation.',
  aiOutboundHint:
    'If the address contains text from your document or the site is unknown, block it.',
  aiOutboundBlock: 'Block',
  aiOutboundAllow: 'Allow',
} as const satisfies Record<keyof typeof zh, string>
