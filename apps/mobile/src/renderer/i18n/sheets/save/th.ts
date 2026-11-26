import type { zh } from './zh'

export const th = {
  sheetsShareFailed: 'ไม่สามารถแชร์ไฟล์นี้ได้',
  sheetsSaveFailed: 'บันทึกไม่ได้ ไฟล์ต้นฉบับยังเหมือนเดิม',
  sheetsSaveAsTitle: 'บันทึกเป็น',
  sheetsShareTitle: 'แชร์เป็น',
  sheetsFormatWorkbook: 'เวิร์กบุ๊ก Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'เวิร์กบุ๊ก Excel ที่เปิดใช้งานแมโคร (.xlsm)',
  sheetsFormatCsv: 'CSV (เฉพาะชีตปัจจุบัน)',
  sheetsFormatOds: 'สเปรดชีต ODS (สำเนาเวิร์กบุ๊ก)',
  sheetsFormatPdf: 'PDF (ชีตปัจจุบัน)',
  sheetsOdsEncrypted: 'เวิร์กบุ๊กที่มีรหัสผ่านส่งออกเป็น ODS ไม่ได้',
  sheetsChoiceCancel: 'ยกเลิก',
  sheetsCsvAskTitle: 'บันทึกไฟล์ CSV',
  sheetsCsvAskMessage: 'ไฟล์ CSV เก็บเฉพาะค่าของชีตปัจจุบัน',
  sheetsCsvAskCsv: 'บันทึกเป็น CSV (ไม่รวมรูปแบบและชีตอื่น)',
  sheetsCsvAskXlsx: 'บันทึกเป็นไฟล์ Excel',
  sheetsCsvFormulaTitle: 'สูตรจะเหลือเฉพาะค่า',
  sheetsCsvFormulaMessage:
    'สูตรในชีตนี้จะถูกเก็บใน CSV เป็นค่าที่คำนวณแล้วเท่านั้น หากต้องการเก็บสูตร ให้บันทึกเป็นไฟล์ Excel',
  sheetsCsvContinue: 'บันทึกเป็น CSV ต่อ',
  sheetsOdsLossTitle: 'ส่งออกเป็น ODS',
  sheetsOdsLossMessage:
    'คุณลักษณะ {count} รายการที่ ODS เก็บไม่ได้ (สูตร แผนภูมิ รูปภาพ การจัดรูปแบบตามเงื่อนไข ฯลฯ) จะไม่อยู่ในสำเนา',
  sheetsOdsContinue: 'ดำเนินการต่อ',
  sheetsOdsUnreadable: 'เปิดไฟล์ ODS ที่สร้างขึ้นอีกครั้งไม่ได้ จึงไม่ได้เขียนไฟล์',
  sheetsOdsFailed: 'ส่งออกเป็น ODS ไม่ได้',
  sheetsCopySaved: 'บันทึกสำเนาแล้ว: {name}',
  sheetsPdfWorking: 'กำลังสร้าง PDF…',
  sheetsPdfFailed: 'สร้าง PDF ไม่ได้',
  sheetsPdfSkippedVisuals: 'ใส่รูปภาพหรือแผนภูมิ {count} รายการลงใน PDF ไม่ได้',
  sheetsPdfMissingGlyphs: 'อักขระ {count} ตัวที่ไม่มีในฟอนต์จะแสดงเป็นกล่องว่างใน PDF',
  sheetsSaveErrDiskChanged:
    'มีแอปอื่นเปลี่ยนต้นฉบับหลังจากเปิด จึงไม่ได้เขียนทับ โปรดใช้บันทึกเป็นแทน',
  sheetsSaveErrTooLarge:
    'ไฟล์ใหญ่เกินไป (เกินประมาณ 14MB) จึงเขียนบนโทรศัพท์นี้ไม่ได้ ต้นฉบับยังเหมือนเดิม',
  sheetsSaveErrUnreadable: 'เปิดเวิร์กบุ๊กที่บันทึกอีกครั้งไม่ได้ จึงคงต้นฉบับไว้ตามเดิม',
  sheetsSaveErrLockFailed: 'ล็อกเวิร์กบุ๊กด้วยรหัสผ่านเดิมอีกครั้งไม่ได้ จึงคงต้นฉบับไว้ตามเดิม',
  sheetsSaveBusy: 'กำลังบันทึกอยู่ โปรดลองอีกครั้งเมื่อเสร็จแล้ว',
} as const satisfies Record<keyof typeof zh, string>
