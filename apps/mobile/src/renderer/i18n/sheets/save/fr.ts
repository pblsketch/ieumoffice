import type { zh } from './zh'

export const fr = {
  sheetsShareFailed: 'Impossible de partager ce fichier.',
  sheetsSaveFailed: "Enregistrement impossible. Le fichier d'origine est inchangé.",
  sheetsSaveNotYet: 'Ce classeur ne peut pas encore être enregistré sur le téléphone.',
} as const satisfies Record<keyof typeof zh, string>
