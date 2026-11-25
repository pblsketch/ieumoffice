import type { zh } from './zh'

export const th = {
  pdfAnnotHighlight: 'ไฮไลต์',
  pdfAnnotUnderline: 'ขีดเส้นใต้',
  pdfAnnotSquiggly: 'เส้นหยัก',
  pdfAnnotStrikeout: 'ขีดฆ่า',
  pdfAnnotModeSelect: 'เลือกข้อความ',
  pdfAnnotModeNote: 'วางโน้ต',
  pdfAnnotHintSelect:
    'ลากไปด้านข้างบนข้อความ หรือกดค้างแล้วลาก เพื่อเลือก แตะเครื่องหมายเพื่อเปลี่ยนสีหรือลบ',
  pdfAnnotHintNote: 'แตะตำแหน่งที่จะวางโน้ต',
  pdfAnnotPen: 'ปากกาเน้นข้อความ {n}',
  pdfAnnotColor: 'สี {n}',
  pdfAnnotRemove: 'ลบเครื่องหมาย',
  pdfAnnotMarkupTitle: 'สีของเครื่องหมาย',
  pdfAnnotClearSelection: 'ยกเลิกการเลือก',
  pdfAnnotNoText: 'หน้านี้ไม่มีข้อความที่เลือกได้',
  pdfAnnotOpenNote: 'เปิดโน้ต',
  pdfAnnotFailed: 'เปลี่ยนคำอธิบายประกอบไม่ได้',
  pdfAnnotNewNote: 'โน้ตใหม่',
  pdfAnnotReplyPlaceholder: 'เขียนคำตอบ',
} as const satisfies Record<keyof typeof zh, string>
