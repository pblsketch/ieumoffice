import type { zh } from './zh'

export const pl = {
  pdfFormAddCheck: 'Dodaj znacznik wyboru',
  pdfFormAddCross: 'Dodaj krzyżyk',
  pdfFormPlaceCheck: 'Dotknij strony, aby umieścić znacznik wyboru',
  pdfFormPlaceCross: 'Dotknij strony, aby umieścić znak X',
  pdfFormCheckMark: 'Znacznik wyboru',
  pdfFormCrossMark: 'Krzyżyk',
  pdfFormDeleteMark: 'Usuń znacznik',
  pdfFormDone: 'Gotowe',
  pdfFormSignField: 'Dotknij, aby podpisać',
  pdfFormDateInvalid: 'Wpisz datę w formacie {format}',
  pdfFormDatePick: 'Wybierz datę',
} as const satisfies Record<keyof typeof zh, string>
