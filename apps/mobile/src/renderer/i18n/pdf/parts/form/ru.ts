import type { zh } from './zh'

export const ru = {
  pdfFormAddCheck: 'Поставить галочку',
  pdfFormAddCross: 'Поставить крестик',
  pdfFormPlaceCheck: 'Коснитесь страницы, чтобы поставить галочку',
  pdfFormPlaceCross: 'Коснитесь страницы, чтобы поставить крестик (X)',
  pdfFormCheckMark: 'Галочка',
  pdfFormCrossMark: 'Крестик',
  pdfFormDeleteMark: 'Удалить отметку',
  pdfFormDone: 'Готово',
  pdfFormSignField: 'Коснитесь, чтобы подписать',
  pdfFormDateInvalid: 'Введите дату в формате {format}',
  pdfFormDatePick: 'Выбрать дату',
} as const satisfies Record<keyof typeof zh, string>
