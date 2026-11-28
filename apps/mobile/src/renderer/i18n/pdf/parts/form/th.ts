import type { zh } from './zh'

export const th = {
  pdfFormAddCheck: 'ใส่เครื่องหมายถูก',
  pdfFormAddCross: 'ใส่เครื่องหมาย X',
  pdfFormPlaceCheck: 'แตะหน้าเพื่อวางเครื่องหมายถูก',
  pdfFormPlaceCross: 'แตะหน้าเพื่อวางเครื่องหมาย X',
  pdfFormCheckMark: 'เครื่องหมายถูก',
  pdfFormCrossMark: 'เครื่องหมาย X',
  pdfFormDeleteMark: 'ลบเครื่องหมาย',
  pdfFormDone: 'เสร็จ',
  pdfFormSignField: 'แตะเพื่อลงชื่อ',
  pdfFormDateInvalid: 'ป้อนวันที่ในรูปแบบ {format}',
  pdfFormDatePick: 'เลือกวันที่',
} as const satisfies Record<keyof typeof zh, string>
