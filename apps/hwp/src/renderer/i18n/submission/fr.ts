import type { zh } from './zh'

export const fr = {
  staleDialogTitle: 'Des éléments doivent être mis à jour',
  staleDialogBody:
    'Les éléments suivants ne sont peut-être plus à jour après vos modifications. Les actualiser avant de continuer ?',
  staleActionSave: 'Enregistrer',
  staleActionPrint: 'Imprimer',
  staleActionPdf: 'Exporter en PDF',
  staleActionSubmission: 'Enregistrer la copie de soumission',
  staleBtnRefreshAll: 'Tout actualiser',
  staleBtnContinue: 'Continuer quand même',
  staleBtnCancel: 'Annuler',
  staleReasonPagesChanged: 'Numéros de page modifiés',
  staleReasonEntriesChanged: 'Entrées modifiées',
  staleKindTocBody: 'Table des matières',
  staleKindTocTable: 'Liste des tableaux',
  staleKindTocFigure: 'Liste des figures',
  staleKindTocEquation: 'Liste des équations',
  staleKindIndex: 'Index',
  staleKindBibliography: 'Bibliographie',
  staleManualConfirmTitle: 'Modifications manuelles détectées',
  staleManualConfirmBody:
    'Des modifications manuelles ont été détectées dans : {items}. Les écraser et actualiser ?',
  staleManualOverwrite: 'Écraser et actualiser',
  staleManualSkip: 'Ignorer',
  staleRefreshDone: '{count} éléments mis à jour.',
  staleRefreshFailed: 'Impossible d’actualiser certains éléments : {error}',
  staleRefreshBlockedObjects:
    'Actualisation ignorée car la plage de la table des matières ou de l’index contient des objets utilisateur tels que des notes de bas de page, des images ou des tableaux.',
  submissionMenuLabel: 'Enregistrer comme copie de soumission…',
  submissionMenuDesc:
    'Enregistre une copie propre séparée sans les repères d’index, de citation ni de réglage.',
  submissionSaving: 'Création de la copie de soumission…',
  submissionSaved: 'Copie de soumission enregistrée : {name}',
  submissionBackupKept: 'Une copie de sauvegarde du fichier précédent a été conservée : {name}',
  submissionSavedTailsLost:
    'Copie de soumission enregistrée ({name}). Certaines pages maîtresses ou commentaires n’ont pas pu être conservés.',
  submissionFailedProtected:
    'Les documents protégés par mot de passe ne peuvent pas être enregistrés comme copie de soumission.',
  submissionFailedTracked:
    'Les documents contenant le suivi des modifications ne peuvent pas être enregistrés comme copie de soumission.',
  submissionFailedSameAsOpen:
    'Impossible d’écraser un document ouvert avec une copie de soumission. Choisissez un autre nom de fichier.',
  submissionFailedStrip:
    'La copie de soumission n’a pas été enregistrée car certains repères internes n’ont pas pu être supprimés : {marks}',
  submissionFailedVerify:
    'La vérification de la copie de soumission a échoué ({before} → {after} pages). Essayez au format HWPX.',
  submissionFailedExport: 'Impossible de générer la copie de soumission : {error}',
  submissionFailedWrite: 'Impossible d’enregistrer la copie de soumission : {error}',
} satisfies Record<keyof typeof zh, string>
