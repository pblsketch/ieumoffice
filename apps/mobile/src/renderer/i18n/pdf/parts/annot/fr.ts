import type { zh } from './zh'

export const fr = {
  pdfAnnotHighlight: 'Surligner',
  pdfAnnotUnderline: 'Souligner',
  pdfAnnotSquiggly: 'Ondulé',
  pdfAnnotStrikeout: 'Barrer',
  pdfAnnotModeSelect: 'Sélectionner du texte',
  pdfAnnotModeNote: 'Placer une note',
  pdfAnnotHintSelect:
    'Faites glisser horizontalement sur le texte, ou appuyez longuement puis faites glisser, pour sélectionner. Touchez une annotation pour changer sa couleur ou la supprimer.',
  pdfAnnotHintNote: 'Touchez l’endroit où placer la note.',
  pdfAnnotPen: 'Surligneur {n}',
  pdfAnnotColor: 'Couleur {n}',
  pdfAnnotRemove: 'Supprimer l’annotation',
  pdfAnnotMarkupTitle: 'Couleur de l’annotation',
  pdfAnnotClearSelection: 'Annuler la sélection',
  pdfAnnotNoText: 'Cette page ne contient aucun texte sélectionnable.',
  pdfAnnotOpenNote: 'Ouvrir la note',
  pdfAnnotFailed: 'Impossible de modifier l’annotation.',
  pdfAnnotNewNote: 'Nouvelle note',
  pdfAnnotReplyPlaceholder: 'Écrire une réponse',
} as const satisfies Record<keyof typeof zh, string>
