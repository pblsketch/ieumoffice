import type { zh } from './zh'

export const en = {
  pdfFormAddCheck: 'Add check mark',
  pdfFormAddCross: 'Add X mark',
  pdfFormPlaceCheck: 'Tap the page to place a check mark',
  pdfFormPlaceCross: 'Tap the page to place an X mark',
  pdfFormCheckMark: 'Check mark',
  pdfFormCrossMark: 'X mark',
  pdfFormDeleteMark: 'Delete mark',
  pdfFormDone: 'Done',
  pdfFormSignField: 'Tap to sign',
  pdfFormDateInvalid: 'Enter a date as {format}',
  pdfFormDatePick: 'Pick a date',
} as const satisfies Record<keyof typeof zh, string>
