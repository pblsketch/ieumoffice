import type { zh } from './zh'

export const fr = {
  menuRecordToggle: 'Macro › Démarrer/arrêter l’enregistrement',
  menuManage: 'Macro › Gérer les macros…',
  recordingBadge: 'Enregistrement de macro',
  recordingStopBtn: 'Arrêter',
  noticeRecordingStarted:
    'Enregistrement de macro démarré. Appuyez sur Alt+Maj+H ou cliquez sur Arrêter une fois terminé.',
  noticeUnsupportedCommand: 'Cette action ne peut pas être enregistrée dans une macro : {label}',
  noticeMouseIgnored: 'Les actions de la souris ne sont pas enregistrées dans une macro.',
  noticeSlotEmpty: 'Aucune macro n’est attribuée à {shortcut}.',
  noticeMacroRunSuccess: 'Macro « {name} » exécutée.',
  noticeMacroMessages: '{name} : {messages}',
  noticeMacroRunError: 'Échec de la macro (ligne {line}, col. {column}) : {error}',
  noticeMacroRunErrorNoLoc: 'Échec de la macro : {error}',
  noticeMacroUnsupportedAction:
    'Action de macro non prise en charge « {action} » (ligne {line}, col. {column}). Toutes les modifications ont été annulées.',
  noticeMacroRollbackObjectLoss:
    'La macro a été arrêtée et annulée pour éviter la perte d’objets ou de notes du document.',
  managerTitle: 'Gérer les macros',
  newMacroBtn: 'Nouvelle macro',
  importBtn: 'Importer (.ieummacro)',
  recordStartBtn: 'Démarrer l’enregistrement',
  recordStopBtn: 'Arrêter l’enregistrement',
  emptyMacros:
    'Aucune macro enregistrée. Créez une macro, enregistrez des actions ou importez un fichier .ieummacro.',
  colName: 'Nom',
  colOrigin: 'Origine',
  colShortcut: 'Raccourci',
  colActions: 'Actions',
  originRecorded: 'Enregistrée',
  originManual: 'Manuelle',
  originAi: 'Brouillon IA',
  originImported: 'Importée',
  slotNone: 'Aucun',
  runBtn: 'Exécuter',
  editBtn: 'Modifier',
  exportBtn: 'Exporter',
  deleteBtn: 'Supprimer',
  closeBtn: 'Fermer',
  cancelBtn: 'Annuler',
  saveBtn: 'Enregistrer',
  noticeMacroSaved: 'Macro « {name} » enregistrée.',
  noticeMacroDeleted: 'Macro « {name} » supprimée.',
  noticeMacroExported: 'Macro « {name} » exportée.',
  noticeMacroImported: 'Macro « {name} » importée.',
  noticeSlotAssigned: '{shortcut} attribué à « {name} ».',
  noticeSlotCleared: 'Raccourci effacé pour « {name} ».',
  errorActionFailed: 'Échec de l’opération : {error}',
  storeErrorTitle: 'Impossible de lire le magasin de macros',
  storeErrorCorruptBody:
    'Le fichier de macros est endommagé. La modification est désactivée pour protéger vos macros existantes.',
  storeErrorTooLargeBody:
    'Le fichier de macros dépasse la limite de taille. La modification est désactivée pour protéger vos macros existantes.',
  storeErrorReadBody:
    'Le fichier de macros est illisible. La modification est désactivée pour protéger vos macros existantes.',
  storeErrorBackupNote: 'Votre fichier d’origine a été conservé à l’emplacement :',
  storeErrorDisabledHint:
    'Résolvez le problème du fichier puis cliquez sur Réessayer pour reprendre la gestion des macros.',
  storeRetryBtn: 'Réessayer',
  storeNearLimitTitle: 'Magasin de macros proche de la limite',
  storeNearLimitBody:
    'Le magasin utilise {size} sur {max}. Pensez à supprimer les macros inutilisées ou à exporter une sauvegarde.',
  errorStoreWriteTooLarge:
    'Cette modification porterait le magasin à {actual}, au-delà de la limite de {max}. Rien n’a été écrasé.',
  errorStoreWriteTooLargeGeneric:
    'Cette modification dépasse la limite de taille du magasin de macros. Rien n’a été écrasé.',
  importPreviewTitle: 'Vérifier la macro importée',
  importPreviewWarning:
    'Examinez l’intégralité du script ci-dessous avant d’enregistrer. Les macros importées ne peuvent pas être exécutées avant leur enregistrement.',
  importPreviewFile: 'Fichier : {fileName}',
  importPreviewName: 'Nom',
  importPreviewDesc: 'Description',
  importPreviewScript: 'Script (lecture seule)',
  importPreviewSyntaxOk: 'Vérification syntaxique réussie.',
  importPreviewSyntaxError:
    'Erreur de syntaxe ligne {line}, colonne {column} : {error} (vous pouvez tout de même enregistrer et corriger dans l’éditeur).',
  importConfirmBtn: 'Enregistrer la macro importée',
  importErrorInvalidFormat: 'Ce fichier n’est pas un fichier macro .ieummacro valide.',
  importErrorTooLarge: 'Le fichier macro sélectionné dépasse la taille maximale autorisée.',
  editorNewTitle: 'Nouvelle macro',
  editorEditTitle: 'Modifier la macro',
  editorRecordedTitle: 'Enregistrer la macro capturée',
  fieldName: 'Nom',
  fieldNamePlaceholder: 'Saisir le nom de la macro…',
  fieldDescription: 'Description',
  fieldDescriptionPlaceholder: 'Note facultative sur le rôle de cette macro…',
  fieldShortcut: 'Emplacement de raccourci',
  fieldScript: 'Script de macro',
  fieldScriptPlaceholder: '// Écrivez un script avec insertText(), replaceAll(), etc.',
  validationNameRequired: 'Veuillez saisir un nom de macro.',
  validationScriptRequired: 'Veuillez saisir un script de macro.',
  syntaxOk: 'Syntaxe valide',
  syntaxError: 'Erreur de syntaxe (ligne {line}, col. {column}) : {error}',
  skippedActionsTitle: '{count} action(s) non enregistrable(s) ignorée(s) :',
  editorRunBtn: 'Exécuter',
  editorSaveBtn: 'Enregistrer',
  aiSectionTitle: 'Rédiger avec l’IA',
  aiPromptPlaceholder:
    'Décrivez ce que la macro doit faire (ex. remplacer les doubles espaces par un espace simple)…',
  aiWriteBtn: 'Rédiger avec l’IA',
  aiWritingBtn: 'Rédaction…',
  aiCancelBtn: 'Annuler',
  aiReviewHint:
    'Seule votre description est envoyée à l’IA (aucun contenu du document). Le script généré est placé dans l’éditeur pour vérification et n’est jamais enregistré ni exécuté automatiquement.',
  aiEmptyPrompt: 'Décrivez d’abord ce que la macro doit faire.',
  aiDraftReady:
    'Brouillon inséré dans l’éditeur. Vérifiez-le avant de l’enregistrer ou de l’exécuter.',
  aiDraftFailed: 'Impossible de générer le script de macro : {error}',
  aiNoOutput: 'L’IA n’a renvoyé aucun script de macro.',
  importPreviewSlotHint:
    'Les raccourcis ne sont pas importés automatiquement. Attribuez un raccourci après l’enregistrement.',
  importPreviewBidiWarning:
    'Ce script contient des caractères de contrôle directionnels ou de largeur nulle masqués (affichés sous forme [U+XXXX]).',
  noticeMacroOutsideBody:
    'Les macros ne peuvent être enregistrées ou exécutées que lorsque le curseur se trouve dans un paragraphe du corps.',
  noticeMacroRunNotRecorded:
    'L’exécution d’une autre macro n’est pas enregistrée pendant l’enregistrement.',
  noticeMacroRollbackObjectLossAt:
    'La macro s’est arrêtée et a annulé les modifications (ligne {line}, col. {column}) pour éviter de perdre des objets ou des commentaires.',
  noticeMacroRollbackObjectLossPostRun:
    'La macro s’est arrêtée et a annulé les modifications lors du contrôle final pour éviter de perdre des objets ou des commentaires.',
  noticeMacroRunErrorPostRun: 'Échec de la macro lors du contrôle final : {error}',
  cmdUndo: 'Annuler',
  cmdRedo: 'Rétablir',
  cmdCopy: 'Copier',
  cmdCut: 'Couper',
  cmdPaste: 'Coller',
  cmdFind: 'Rechercher',
  cmdInsertImage: 'Insérer une image',
  cmdInsertFootnote: 'Insérer une note de bas de page',
  cmdInsertEndnote: 'Insérer une note de fin',
  cmdInsertHyperlink: 'Insérer un lien hypertexte',
  cmdInsertBookmark: 'Insérer un signet',
  cmdLineBreak: 'Saut de ligne',
  cmdTab: 'Tabulation',
  cmdDeleteObject: 'Supprimer l’objet du document',
  cmdOutsideBody: 'Modification hors du corps',
  cmdOtherAction: 'Action d’édition non prise en charge ({id})',
  noticeOutsideBodyIgnored:
    'Les actions effectuées hors des paragraphes du corps (tableaux, zones de texte, notes, en-têtes/pieds de page) ne sont pas enregistrées.',
  noticeMacroRegexTimeout:
    'La macro s’est arrêtée et a annulé les modifications, car l’expression régulière a pris trop de temps.',
  noticeMacroRegexTimeoutAt:
    'La macro s’est arrêtée et a annulé les modifications (ligne {line}, col. {column}), car l’expression régulière a pris trop de temps.',
} satisfies Record<keyof typeof zh, string>
