import type { zh } from './zh'

export const cs = {
  aiOutboundTitle: 'Načíst tuto adresu?',
  aiOutboundIntro: 'AI chce načíst adresu, která se v konverzaci neobjevila.',
  aiOutboundHint: 'Pokud adresa obsahuje text z dokumentu nebo web neznáte, zablokujte ji.',
  aiOutboundBlock: 'Blokovat',
  aiOutboundAllow: 'Povolit',
} as const satisfies Record<keyof typeof zh, string>
