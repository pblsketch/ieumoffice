import type { zh } from './zh'

export const fr = {
  sheetsShareFailed: 'Impossible de partager ce fichier.',
  sheetsSaveFailed: "Enregistrement impossible. Le fichier d'origine est inchangé.",
  sheetsSaveAsTitle: 'Enregistrer sous',
  sheetsShareTitle: 'Partager au format',
  sheetsFormatWorkbook: 'Classeur Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Classeur Excel prenant en charge les macros (.xlsm)',
  sheetsFormatCsv: 'CSV (feuille active uniquement)',
  sheetsFormatOds: 'Feuille de calcul ODS (copie du classeur)',
  sheetsFormatPdf: 'PDF (feuille active)',
  sheetsOdsEncrypted: 'Un classeur protégé par mot de passe ne peut pas être exporté en ODS.',
  sheetsChoiceCancel: 'Annuler',
  sheetsCsvAskTitle: 'Enregistrer le fichier CSV',
  sheetsCsvAskMessage: 'Un fichier CSV ne garde que les valeurs de la feuille active.',
  sheetsCsvAskCsv: 'Enregistrer en CSV (mise en forme et autres feuilles exclues)',
  sheetsCsvAskXlsx: 'Enregistrer comme fichier Excel',
  sheetsCsvFormulaTitle: 'Les formules ne gardent que leurs valeurs',
  sheetsCsvFormulaMessage:
    'Les formules de cette feuille sont gardées sous forme de valeurs calculées dans un fichier CSV. Pour garder les formules, enregistrez comme fichier Excel.',
  sheetsCsvContinue: 'Continuer en CSV',
  sheetsOdsLossTitle: 'Exporter en ODS',
  sheetsOdsLossMessage:
    '{count} fonctionnalités que l’ODS ne peut pas contenir (formules, graphiques, images, mise en forme conditionnelle, etc.) sont exclues de la copie.',
  sheetsOdsContinue: 'Continuer',
  sheetsOdsUnreadable: 'Le fichier ODS n’a pas pu être rouvert ; il n’a donc pas été écrit.',
  sheetsOdsFailed: 'Impossible d’exporter en ODS.',
  sheetsCopySaved: 'Copie enregistrée : {name}',
  sheetsPdfWorking: 'Création du PDF…',
  sheetsPdfFailed: 'Impossible de créer le PDF.',
  sheetsPdfSkippedVisuals: '{count} images ou graphiques n’ont pas pu être placés dans le PDF.',
  sheetsPdfMissingGlyphs:
    '{count} caractères absents des polices apparaissent comme des cases vides dans le PDF.',
  sheetsSaveErrDiskChanged:
    'Une autre application a modifié l’original après son ouverture. Il n’a pas été écrasé ; utilisez Enregistrer sous.',
  sheetsSaveErrTooLarge:
    'Le fichier est trop volumineux (plus de 14 Mo environ) pour être écrit sur ce téléphone. L’original est inchangé.',
  sheetsSaveErrUnreadable:
    'Le classeur enregistré n’a pas pu être rouvert ; l’original a été laissé tel quel.',
  sheetsSaveErrLockFailed:
    'Le classeur n’a pas pu être verrouillé de nouveau avec son mot de passe ; l’original a été laissé tel quel.',
  sheetsSaveBusy: 'Un enregistrement est en cours. Réessayez quand il sera terminé.',
} as const satisfies Record<keyof typeof zh, string>
