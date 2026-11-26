import type { zh } from './zh'

export const nl = {
  sheetsShareFailed: 'Dit bestand kon niet worden gedeeld.',
  sheetsSaveFailed: 'Opslaan is mislukt. Het oorspronkelijke bestand is ongewijzigd.',
  sheetsSaveNotYet: 'Deze werkmap kan nog niet op de telefoon worden opgeslagen.',
} as const satisfies Record<keyof typeof zh, string>
