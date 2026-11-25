import type { zh } from './zh'

export const th = {
  pdfTextHint: 'แตะที่ว่างเพื่อเพิ่มข้อความ หรือแตะข้อความเพื่อแก้ไข',
  pdfTextInputLabel: 'ข้อความที่จะเพิ่ม',
  pdfTextEditLabel: 'ข้อความที่จะแก้ไข',
  pdfTextStyleBar: 'รูปแบบข้อความ',
  pdfTextBold: 'ตัวหนา',
  pdfTextSize: 'ขนาดตัวอักษร',
  pdfTextSizeDown: 'ลดขนาดตัวอักษร',
  pdfTextSizeUp: 'เพิ่มขนาดตัวอักษร',
  pdfTextColor: 'สีข้อความ',
  pdfTextColorDocument: 'ใช้สีเดิมของเอกสาร',
  pdfTextFont: 'แบบอักษร',
  pdfTextFontDocument: 'แบบอักษรของเอกสาร',
  pdfTextBack: 'ย้อนกลับ',
  pdfTextDelete: 'ลบ',
  pdfTextDone: 'ตกลง',
  pdfTextCannotDraw: 'ไม่สามารถเพิ่มอักขระเหล่านี้ได้: {chars}',
  pdfTextFontSubstituted: 'อักขระเหล่านี้จะใช้แบบอักษรอื่น: {chars}',
  pdfTextScannedPage: 'หน้านี้ไม่มีข้อความ เพิ่มได้เฉพาะข้อความใหม่เท่านั้น',
  pdfTextNoMatch: 'แก้ไขข้อความนี้ไม่ได้ เนื่องจากไม่พบในเอกสาร',
  pdfTextOverflow: 'ข้อความที่แก้ไขจะทับข้อความด้านล่าง โปรดย่อให้สั้นลง',
} as const satisfies Record<keyof typeof zh, string>
