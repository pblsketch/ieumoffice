import type { zh } from './zh'

export const cs = {
  sheetsShareFailed: 'Tento soubor se nepodařilo sdílet.',
  sheetsSaveFailed: 'Uložení se nezdařilo. Původní soubor zůstal beze změny.',
  sheetsSaveNotYet: 'Tento sešit zatím nelze v telefonu uložit.',
} as const satisfies Record<keyof typeof zh, string>
