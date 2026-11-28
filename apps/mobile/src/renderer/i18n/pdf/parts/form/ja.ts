import type { zh } from './zh'

export const ja = {
  pdfFormAddCheck: 'チェックを置く',
  pdfFormAddCross: 'バツ印を置く',
  pdfFormPlaceCheck: 'ページをタップしてチェック マークを置きます',
  pdfFormPlaceCross: 'ページをタップしてバツ印を置きます',
  pdfFormCheckMark: 'チェック マーク',
  pdfFormCrossMark: 'バツ印',
  pdfFormDeleteMark: '印を削除',
  pdfFormDone: '完了',
  pdfFormSignField: 'タップして署名',
  pdfFormDateInvalid: '日付を {format} の形式で入力してください',
  pdfFormDatePick: '日付を選択',
} as const satisfies Record<keyof typeof zh, string>
