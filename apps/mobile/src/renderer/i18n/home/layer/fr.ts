import type { zh } from './zh'

export const fr = {
  homeRunEditorOffTitle: 'L’éditeur {name} est désactivé',
  homeRunEditorOffBody:
    'Activez-le pour ouvrir ce fichier. Vous pourrez le désactiver à nouveau dans les paramètres.',
  homeRunEditorOffConfirm: 'Activer et ouvrir',
  homeRunStripSample: 'Document d’exemple · Lecture seule',
  homeRunStripReceived: 'Fichier reçu · Lecture seule',
  homeRunStripReadOnly: 'Lecture seule',
  homeRunStripCopy: 'Modifier une copie',
  homeRunStripClose: 'Fermer l’avis',
  homeRunReceiveTitle: 'Fichiers reçus',
  homeRunReceiveCount: '{count} fichiers',
  homeRunReceiveClose: 'Fermer les fichiers reçus',
  homeRunReceiveOpen: 'Ouvrir',
  homeRunReceivePdfOff: 'Les outils PDF sont désactivés',
  homeRunReceivePdfOn: 'Activer et continuer',
  homeRunGuideLabel: 'Guide de bienvenue',
  homeRunWelcomeTitle: 'Bienvenue',
  homeRunWelcomeBody:
    'Ouvrez et modifiez des documents HWP, PDF, Markdown et plus encore avec GenOffice. Sans compte, sans publicité, et vos documents restent sur cet appareil.',
  homeRunStart: 'Commencer',
  homeRunTipEditButton: 'Pour modifier, touchez [Modifier]',
  homeRunTipFlowView: 'Pour adapter le texte à l’écran, touchez [Mode lecture]',
  homeRunTipFirstEdit:
    'Une copie de récupération est créée automatiquement. L’original est enregistré quand vous touchez [Terminer]',
  homeRunTipFirstKeyboard: 'Changez le style du texte avec [Aa]',
} as const satisfies Record<keyof typeof zh, string>
