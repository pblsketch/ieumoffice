import type { zh } from './zh'

export const th = {
  pdfEditPen: 'ปากกา',
  pdfEditHighlighter: 'ปากกาเน้นข้อความ',
  pdfEditTextBox: 'กล่องข้อความ',
  pdfEditSign: 'ลงนาม',
  pdfEditPages: 'จัดระเบียบหน้า',
  pdfEditLink: 'แทรกลิงก์',
  pdfEditSaveFailed: 'บันทึกไม่ได้ การแก้ไขของคุณยังอยู่และไฟล์ไม่ถูกเปลี่ยนแปลง',
  pdfEditSaveSkipped: 'บันทึกการแก้ไขข้อความบางส่วนในหน้า {pages} ไม่ได้',
  pdfEditShareFailed: 'แชร์ไม่ได้',
  pdfEditReloadFailed: 'บันทึกแล้ว แต่โหลดเอกสารใหม่ไม่ได้ โปรดเปิดไฟล์อีกครั้ง',
  pdfEditSignatureUnavailable: 'ยังใช้การลงนามไม่ได้',
  pdfEditSaveAsHint:
    'เลือกวิธีจัดการไฮไลต์ โน้ต และภาพวาดในสำเนา “ฝังลงในหน้า” จะฝังช่องแบบฟอร์มด้วย ส่วน “ไม่รวมคำอธิบายประกอบ” จะเก็บลิงก์และช่องแบบฟอร์มไว้',
  pdfEditKeepAnnots: 'เก็บคำอธิบายประกอบ (แก้ไขได้ในแอปอื่น)',
  pdfEditFlattenAnnots: 'ฝังลงในหน้า (มองเห็นได้ในทุกแอป)',
  pdfEditStripAnnots: 'ไม่รวมคำอธิบายประกอบ (เก็บลิงก์และช่องแบบฟอร์ม)',
  pdfEditSaveVerifyFailed:
    'ไม่สามารถเขียนการแก้ไขในหน้า {pages} กลับได้ครบถ้วน จึงยกเลิกการบันทึกและไฟล์ไม่ถูกแก้ไข โปรดเลิกทำการแก้ไขที่เกี่ยวข้องแล้วลองอีกครั้ง',
} as const satisfies Record<keyof typeof zh, string>
