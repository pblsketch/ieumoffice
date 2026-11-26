import type { zh } from './zh'

export const de = {
  sheetsShareFailed: 'Diese Datei konnte nicht geteilt werden.',
  sheetsSaveFailed: 'Speichern nicht möglich. Die Originaldatei ist unverändert.',
  sheetsSaveNotYet: 'Diese Arbeitsmappe kann auf dem Telefon noch nicht gespeichert werden.',
} as const satisfies Record<keyof typeof zh, string>
