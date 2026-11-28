import type { zh } from './zh'

export const fr = {
  pdfEditPen: 'Stylo',
  pdfEditHighlighter: 'Surligneur',
  pdfEditTextBox: 'Zone de texte',
  pdfEditSign: 'Signer',
  pdfEditPages: 'Organiser les pages',
  pdfEditLink: 'Insérer un lien',
  pdfEditSaveFailed:
    "Impossible d'enregistrer. Vos modifications sont conservées et le fichier n'a pas été modifié.",
  pdfEditSaveSkipped:
    "Certaines modifications de texte de la page {pages} n'ont pas pu être enregistrées.",
  pdfEditShareFailed: 'Impossible de partager.',
  pdfEditReloadFailed: "Enregistré, mais le document n'a pas pu être rechargé. Rouvrez le fichier.",
  pdfEditSignatureUnavailable: "La signature n'est pas encore disponible.",
  pdfEditSaveAsHint:
    'Choisissez le traitement des surlignages, notes et dessins dans la copie. « Incruster dans les pages » incruste aussi les champs de formulaire ; « Exclure les annotations » conserve les liens et les champs.',
  pdfEditKeepAnnots: 'Conserver les annotations (modifiables dans d’autres applis)',
  pdfEditFlattenAnnots: 'Incruster dans les pages (visibles dans toutes les applis)',
  pdfEditStripAnnots: 'Exclure les annotations (liens et champs conservés)',
  pdfEditSaveVerifyFailed:
    "Les modifications de la page {pages} n'ont pas pu être réécrites intégralement ; l'enregistrement a été annulé et le fichier est resté intact. Annulez la modification concernée puis réessayez",
} as const satisfies Record<keyof typeof zh, string>
