import type { zh } from './zh'

export const th = {
  pdfDrawSettings: 'การตั้งค่าปากกา',
  pdfDrawTool: 'เครื่องมือ',
  pdfDrawPen: 'ปากกา',
  pdfDrawRect: 'สี่เหลี่ยม',
  pdfDrawEllipse: 'วงรี',
  pdfDrawLine: 'เส้น',
  pdfDrawArrow: 'ลูกศร',
  pdfDrawEraser: 'ยางลบ',
  pdfDrawColor: 'สี',
  pdfDrawColorRed: 'แดง',
  pdfDrawColorYellow: 'เหลือง',
  pdfDrawColorGreen: 'เขียว',
  pdfDrawColorBlue: 'น้ำเงิน',
  pdfDrawColorBlack: 'ดำ',
  pdfDrawWidth: 'ความหนา',
  pdfDrawWidthValue: '{width} พอยต์',
  pdfDrawFinger: 'วาดด้วยนิ้วด้วย',
  pdfDrawFingerHint:
    'เมื่อเปิด นิ้วยังวาดได้แม้ใช้ปากกาไปแล้ว เมื่อปิด หลังจากใช้ปากกาแล้ว นิ้วจะใช้เลื่อนหน้า',
  pdfDrawEraserHint: 'ยางลบลบได้เฉพาะเส้นและรูปทรงที่ยังไม่ได้บันทึก',
  pdfDrawRefused: 'ตอนนี้วาดไม่ได้ ลองอีกครั้งในอีกสักครู่',
} as const satisfies Record<keyof typeof zh, string>
