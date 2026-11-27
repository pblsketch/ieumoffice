import type { zh } from './zh'

export const th = {
  staleDialogTitle: 'มีรายการที่ต้องอัปเดต',
  staleDialogBody:
    'รายการต่อไปนี้อาจไม่เป็นปัจจุบันหลังการแก้ไขล่าสุด ต้องการรีเฟรชก่อนดำเนินการต่อหรือไม่?',
  staleActionSave: 'บันทึก',
  staleActionPrint: 'พิมพ์',
  staleActionPdf: 'ส่งออก PDF',
  staleActionSubmission: 'บันทึกสำเนาสำหรับส่ง',
  staleBtnRefreshAll: 'รีเฟรชทั้งหมด',
  staleBtnContinue: 'ดำเนินการต่อตามเดิม',
  staleBtnCancel: 'ยกเลิก',
  staleReasonPagesChanged: 'เลขหน้าเปลี่ยนแปลง',
  staleReasonEntriesChanged: 'เนื้อหารายการเปลี่ยนแปลง',
  staleKindTocBody: 'สารบัญ',
  staleKindTocTable: 'สารบัญตาราง',
  staleKindTocFigure: 'สารบัญภาพ',
  staleKindTocEquation: 'สารบัญสมการ',
  staleKindIndex: 'ดัชนี',
  staleKindBibliography: 'บรรณานุกรม',
  staleManualConfirmTitle: 'พบการแก้ไขด้วยตนเอง',
  staleManualConfirmBody:
    'พบการแก้ไขด้วยตนเองใน: {items} ต้องการเขียนทับและรีเฟรชหรือไม่?',
  staleManualOverwrite: 'เขียนทับและรีเฟรช',
  staleManualSkip: 'ข้าม',
  staleRefreshDone: 'อัปเดตแล้ว {count} รายการ',
  staleRefreshFailed: 'ไม่สามารถอัปเดตบางรายการได้: {error}',
  submissionMenuLabel: 'บันทึกเป็นสำเนาสำหรับส่ง…',
  submissionMenuDesc:
    'บันทึกสำเนาที่สะอาดแยกต่างหากโดยนำเครื่องหมายดัชนี การอ้างอิง และการตั้งค่าออก',
  submissionSaving: 'กำลังสร้างสำเนาสำหรับส่ง…',
  submissionSaved: 'บันทึกสำเนาสำหรับส่งแล้ว: {name}',
  submissionSavedTailsLost:
    'บันทึกสำเนาสำหรับส่งแล้ว ({name}) บางหน้าต้นแบบหรือความคิดเห็นอาจไม่ได้ถูกเก็บไว้',
  submissionFailedProtected: 'ไม่สามารถบันทึกเอกสารที่มีรหัสผ่านเป็นสำเนาสำหรับส่งได้',
  submissionFailedTracked: 'ไม่สามารถบันทึกเอกสารที่มีการติดตามการเปลี่ยนแปลงเป็นสำเนาสำหรับส่งได้',
  submissionFailedVerify:
    'ตรวจสอบสำเนาสำหรับส่งไม่ผ่าน ({before} → {after} หน้า) ลองบันทึกเป็นรูปแบบ HWPX แทน',
  submissionFailedExport: 'ไม่สามารถสร้างสำเนาสำหรับส่งได้: {error}',
  submissionFailedWrite: 'ไม่สามารถบันทึกสำเนาสำหรับส่งได้: {error}',
} satisfies Record<keyof typeof zh, string>
