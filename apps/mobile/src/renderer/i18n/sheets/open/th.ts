import type { zh } from './zh'

export const th = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'กำลังโหลดตาราง…',
  sheetsOpening: 'กำลังเปิดเวิร์กบุ๊ก… ไฟล์ขนาดใหญ่อาจใช้เวลาสักครู่',
  sheetsPasswordTitle: 'เวิร์กบุ๊กที่ป้องกันด้วยรหัสผ่าน',
  sheetsPasswordMessage: 'ป้อนรหัสผ่านเพื่อเปิดเวิร์กบุ๊กนี้',
  sheetsPasswordLabel: 'รหัสผ่าน',
  sheetsPasswordWrong: 'รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง',
  sheetsPasswordOpen: 'เปิด',
  sheetsPasswordCancel: 'ยกเลิก',
  sheetsEncryptionUnsupported: 'ไม่สามารถเปิดการป้องกันด้วยรหัสผ่านประเภทนี้ได้',
  sheetsEncryptionDamaged: 'เวิร์กบุ๊กที่ป้องกันนี้เสียหายและเปิดไม่ได้',
  sheetsNoticeMacros: 'แมโครจะคงไว้แต่จะไม่ทำงาน',
  sheetsNoticeExternalLinks: 'เซลล์ที่อ้างอิงไฟล์อื่นจะแสดงค่าที่บันทึกไว้ล่าสุด',
  sheetsNoticeMacrosAndLinks:
    'แมโครจะคงไว้แต่จะไม่ทำงาน เซลล์ที่อ้างอิงไฟล์อื่นจะแสดงค่าที่บันทึกไว้ล่าสุด',
} as const satisfies Record<keyof typeof zh, string>
