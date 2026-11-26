import type { zh } from './zh'

export const pl = {
  sheetsShareFailed: 'Nie udało się udostępnić tego pliku.',
  sheetsSaveFailed: 'Nie udało się zapisać. Oryginalny plik jest bez zmian.',
  sheetsSaveNotYet: 'Tego skoroszytu nie można jeszcze zapisać na telefonie.',
} as const satisfies Record<keyof typeof zh, string>
