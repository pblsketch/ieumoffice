import type { zh } from './zh'

export const ko = {
  pdfFormAddCheck: '체크 표시 넣기',
  pdfFormAddCross: 'X 표시 넣기',
  pdfFormPlaceCheck: '체크 표시를 놓을 곳을 누르세요',
  pdfFormPlaceCross: 'X 표시를 놓을 곳을 누르세요',
  pdfFormCheckMark: '체크 표시',
  pdfFormCrossMark: 'X 표시',
  pdfFormDeleteMark: '표시 지우기',
  pdfFormDone: '완료',
  pdfFormSignField: '눌러서 서명',
  pdfFormDateInvalid: '날짜를 {format} 형식으로 입력하세요',
  pdfFormDatePick: '날짜 고르기',
} as const satisfies Record<keyof typeof zh, string>
