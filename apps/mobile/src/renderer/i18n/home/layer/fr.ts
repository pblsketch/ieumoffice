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
  homeRunStep: 'Étape {current} sur {total}',
  homeRunWelcomeTitle: 'Bienvenue',
  homeRunWelcomeBody:
    'Ouvrez et modifiez des documents HWP, PDF, Markdown et plus encore avec GenOffice. Sans compte, sans publicité, et vos documents restent sur cet appareil.',
  homeRunNext: 'Suivant',
  homeRunSkip: 'Passer',
  homeRunFolderTitle: 'Associer un dossier de documents (facultatif)',
  homeRunFolderBody:
    'Associez un dossier que vous utilisez souvent : ses fichiers apparaîtront directement dans l’onglet [Dossiers].',
  homeRunFolderPick: 'Choisir un dossier',
  homeRunLater: 'Plus tard',
  homeRunFolderLinked: '✓ Dossier de documents associé · Modifiable dans les paramètres',
  homeRunStart: 'Commencer',
  homeRunTipEditButton: 'Pour modifier, touchez [Modifier]',
  homeRunTipFlowView:
    'Passage en vue fluide pour une lecture plus confortable · La vue page est ici',
  homeRunTipFirstEdit:
    'Une copie de récupération est créée automatiquement. L’original est enregistré quand vous touchez [Terminer]',
  homeRunTipFirstKeyboard: 'Changez le style du texte avec [Aa]',
} as const satisfies Record<keyof typeof zh, string>
