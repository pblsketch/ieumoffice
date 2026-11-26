import type { zh } from './zh'

export const fr = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Chargement de la grille…',
  sheetsOpening: 'Ouverture du classeur… Les gros fichiers prennent un peu de temps.',
  sheetsPasswordTitle: 'Classeur protégé par mot de passe',
  sheetsPasswordMessage: 'Saisissez le mot de passe pour ouvrir ce classeur.',
  sheetsPasswordLabel: 'Mot de passe',
  sheetsPasswordWrong: 'Le mot de passe est incorrect. Réessayez.',
  sheetsPasswordOpen: 'Ouvrir',
  sheetsPasswordCancel: 'Annuler',
  sheetsEncryptionUnsupported: 'Ce type de protection par mot de passe ne peut pas être ouvert.',
  sheetsEncryptionDamaged: 'Ce classeur protégé est endommagé et ne peut pas être ouvert.',
  sheetsNoticeMacros: 'Les macros sont conservées mais pas exécutées.',
  sheetsNoticeExternalLinks:
    "Les cellules qui renvoient à d'autres fichiers affichent leur dernière valeur enregistrée.",
  sheetsNoticeMacrosAndLinks:
    "Les macros sont conservées mais pas exécutées. Les cellules qui renvoient à d'autres fichiers affichent leur dernière valeur enregistrée.",
} as const satisfies Record<keyof typeof zh, string>
