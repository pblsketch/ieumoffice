import type { zh } from './zh'

export const fr = {
  pdfLinkPlaceHint: 'Tracez un cadre sur la page à l’endroit du lien',
  pdfLinkEditTitle: 'Modifier le lien',
  pdfLinkUrlLabel: 'Adresse web (http, https, mailto)',
  pdfLinkPageLabel: 'Ou une page de ce document (1–{count})',
  pdfLinkUrlInvalid: 'Seules les adresses http, https et mailto peuvent être liées',
  pdfLinkPageInvalid: 'Saisissez un numéro de page de 1 à {count}',
  pdfLinkNeedTarget: 'Saisissez une adresse web ou un numéro de page',
  pdfLinkApply: 'Ajouter le lien',
  pdfLinkDelete: 'Supprimer le lien',
  pdfLinkPending: 'Lien à ajouter : {target}',
  pdfLinkToPage: 'Page {page}',
  pdfLinkFailed: 'Impossible de modifier le lien. Réessayez une fois l’enregistrement terminé.',
  pdfLinkUpdate: 'Appliquer',
} as const satisfies Record<keyof typeof zh, string>
