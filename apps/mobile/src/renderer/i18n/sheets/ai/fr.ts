import type { zh } from './zh'

export const fr = {
  sheetsAiUndoRefused:
    "La feuille a été modifiée après les changements de l'IA, ils n'ont donc pas été annulés.",
  sheetsAiUndoPartial:
    "Certains changements de l'IA n'ont pas pu être annulés. Vérifiez la feuille.",
  sheetsAiUndoExpired:
    "Les changements de l'IA ne peuvent plus être annulés en une fois (le classeur a été enregistré ou beaucoup modifié depuis). Utilisez Annuler.",
} as const satisfies Record<keyof typeof zh, string>
