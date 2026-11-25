import type { zh } from './zh'

export const zhTW = {
  pdfFormAddCheck: '放置勾選標記',
  pdfFormAddCross: '放置叉號',
  pdfFormPlaceCheck: '點按頁面放置勾選標記',
  pdfFormPlaceCross: '點按頁面放置叉號',
  pdfFormCheckMark: '勾選標記',
  pdfFormCrossMark: '叉號',
  pdfFormDeleteMark: '刪除標記',
  pdfFormDone: '完成',
  pdfFormSignField: '點按簽名',
  pdfFormDateInvalid: '請依 {format} 格式輸入日期',
  pdfFormDatePick: '選擇日期',
} as const satisfies Record<keyof typeof zh, string>
