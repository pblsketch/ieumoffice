import type { zh } from './zh'

export const fr = {
  pdfFormAddCheck: 'Ajouter une coche',
  pdfFormAddCross: 'Ajouter une croix',
  pdfFormPlaceCheck: 'Touchez la page pour placer une coche',
  pdfFormPlaceCross: 'Touchez la page pour placer une croix (X)',
  pdfFormCheckMark: 'Coche',
  pdfFormCrossMark: 'Croix',
  pdfFormDeleteMark: 'Supprimer la marque',
  pdfFormDone: 'Terminé',
  pdfFormSignField: 'Toucher pour signer',
  pdfFormDateInvalid: 'Saisissez une date au format {format}',
  pdfFormDatePick: 'Choisir une date',
} as const satisfies Record<keyof typeof zh, string>
