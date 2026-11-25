import type { zh } from './zh'

export const th = {
  pdfLinkPlaceHint: 'ลากกรอบบนหน้าตรงที่จะวางลิงก์',
  pdfLinkEditTitle: 'แก้ไขลิงก์',
  pdfLinkUrlLabel: 'ที่อยู่เว็บ (http, https, mailto)',
  pdfLinkPageLabel: 'หรือหน้าในเอกสารนี้ (1–{count})',
  pdfLinkUrlInvalid: 'ลิงก์ได้เฉพาะที่อยู่ http, https และ mailto เท่านั้น',
  pdfLinkPageInvalid: 'ป้อนหมายเลขหน้าตั้งแต่ 1 ถึง {count}',
  pdfLinkNeedTarget: 'ป้อนที่อยู่เว็บหรือหมายเลขหน้า',
  pdfLinkApply: 'เพิ่มลิงก์',
  pdfLinkDelete: 'ลบลิงก์',
  pdfLinkPending: 'ลิงก์ที่จะเพิ่ม: {target}',
  pdfLinkToPage: 'หน้า {page}',
  pdfLinkFailed: 'เปลี่ยนลิงก์ไม่ได้ ลองอีกครั้งเมื่อบันทึกเสร็จแล้ว',
  pdfLinkUpdate: 'ใช้',
} as const satisfies Record<keyof typeof zh, string>
