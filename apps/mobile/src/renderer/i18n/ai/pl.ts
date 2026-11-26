import type { zh } from './zh'

export const pl = {
  aiOutboundTitle: 'Pobrać ten adres?',
  aiOutboundIntro: 'AI chce pobrać adres, który nie pojawił się w rozmowie.',
  aiOutboundHint: 'Jeśli adres zawiera tekst z dokumentu albo strona jest nieznana, zablokuj go.',
  aiOutboundBlock: 'Zablokuj',
  aiOutboundAllow: 'Zezwól',
} as const satisfies Record<keyof typeof zh, string>
