import type { zh } from './zh'

export const fr = {
  pdfTextHint:
    'Touchez un espace vide pour ajouter du texte, ou touchez un texte pour le modifier.',
  pdfTextInputLabel: 'Texte à ajouter',
  pdfTextEditLabel: 'Texte à modifier',
  pdfTextStyleBar: 'Style du texte',
  pdfTextBold: 'Gras',
  pdfTextSize: 'Taille du texte',
  pdfTextSizeDown: 'Réduire le texte',
  pdfTextSizeUp: 'Agrandir le texte',
  pdfTextColor: 'Couleur du texte',
  pdfTextColorDocument: 'Garder la couleur du document',
  pdfTextFont: 'Police',
  pdfTextFontDocument: 'Police du document',
  pdfTextBack: 'Retour',
  pdfTextDelete: 'Supprimer',
  pdfTextDone: 'Valider',
  pdfTextCannotDraw: 'Ces caractères ne peuvent pas être ajoutés : {chars}',
  pdfTextFontSubstituted: 'Ces caractères utiliseront une autre police : {chars}',
  pdfTextScannedPage:
    'Cette page ne contient pas de texte. Vous pouvez seulement ajouter du texte.',
  pdfTextNoMatch: 'Ce texte ne peut pas être modifié : il est introuvable dans le document.',
  pdfTextOverflow: 'Le texte modifié chevaucherait le texte en dessous. Raccourcissez-le.',
} as const satisfies Record<keyof typeof zh, string>
