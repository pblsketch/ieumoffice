import type { zh } from './zh'

export const pt = {
  pdfFormAddCheck: 'Adicionar marca de seleção',
  pdfFormAddCross: 'Adicionar X',
  pdfFormPlaceCheck: 'Toque na página para colocar uma marca de seleção',
  pdfFormPlaceCross: 'Toque na página para colocar um X',
  pdfFormCheckMark: 'Marca de seleção',
  pdfFormCrossMark: 'Marca X',
  pdfFormDeleteMark: 'Excluir marca',
  pdfFormDone: 'Concluído',
  pdfFormSignField: 'Toque para assinar',
  pdfFormDateInvalid: 'Insira uma data no formato {format}',
  pdfFormDatePick: 'Escolher uma data',
} as const satisfies Record<keyof typeof zh, string>
