import type { zh } from './zh'

export const fr = {
  sheetsProvisionalNotice: 'Grille d’essai : vos modifications ne sont pas encore enregistrées.',
  sheetsLoading: 'Chargement de la grille…',
  sheetsShareFailed: 'Impossible de partager ce fichier.',
  sheetsFreezeTopRow: 'Figer la première ligne',
  sheetsFreezeFirstColumn: 'Figer la première colonne',
  sheetsUnfreeze: 'Libérer les volets',
  sheetsKeyboardBar: 'Outils de saisie de formule',
  sheetsInsertSum: 'Fonction somme',
  sheetsInsertParens: 'Parenthèses',
  sheetsNumericKeys: 'Clavier numérique',
  sheetsCancelEdit: 'Annuler',
  sheetsConfirmEdit: 'Valider',
} as const satisfies Record<keyof typeof zh, string>
