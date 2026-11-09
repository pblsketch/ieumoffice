import type { zh } from './zh'

export const th = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'เชื่อมต่อเซิร์ฟเวอร์ WebDAV (เช่น Nextcloud หรือ Synology NAS) เพื่อเปิดไฟล์บนเซิร์ฟเวอร์ที่นี่ เมื่อบันทึก การเปลี่ยนแปลงจะถูกส่งกลับไปยังเซิร์ฟเวอร์',
  webdavNoServers: 'ยังไม่มีเซิร์ฟเวอร์ที่เชื่อมต่อ',
  webdavAdd: 'เพิ่มเซิร์ฟเวอร์',
  webdavFieldName: 'ชื่อ',
  webdavFieldUrl: 'ที่อยู่เซิร์ฟเวอร์',
  webdavFieldUser: 'ชื่อผู้ใช้',
  webdavFieldPassword: 'รหัสผ่านหรือรหัสผ่านแอป',
  webdavUserHint: 'หากเซิร์ฟเวอร์ไม่ต้องลงชื่อเข้าใช้ ให้เว้นชื่อผู้ใช้ว่างไว้',
  webdavInsecureWarn:
    'นี่คือการเชื่อมต่อ HTTP ที่ไม่เข้ารหัส รหัสผ่านและไฟล์จะผ่านเครือข่ายในรูปแบบที่อ่านได้',
  webdavInsecureConfirm: 'ฉันเข้าใจความเสี่ยงและต้องการใช้ HTTP',
  webdavSave: 'เชื่อมต่อ',
  webdavCancel: 'ยกเลิก',
  webdavChecking: 'กำลังตรวจสอบการเชื่อมต่อ…',
  webdavRemove: 'ลบเซิร์ฟเวอร์',
  webdavRemoveConfirm:
    'ลบข้อมูลการเชื่อมต่อของเซิร์ฟเวอร์นี้ออกจากพีซีเครื่องนี้ใช่ไหม ไฟล์บนเซิร์ฟเวอร์จะไม่ถูกลบ',
  webdavRemoveYes: 'ลบ',
  webdavNeedPassword: 'พีซีเครื่องนี้เก็บรหัสผ่านแบบเข้ารหัสไม่ได้ โปรดกรอกอีกครั้ง',
  webdavNotPersisted: 'พีซีเครื่องนี้เก็บรหัสผ่านแบบเข้ารหัสไม่ได้ คุณจึงต้องกรอกใหม่หลังปิดแอป',
  webdavPrivacy:
    'รหัสผ่านอยู่ในพีซีเครื่องนี้เท่านั้น และเข้ารหัสโดยระบบ ไฟล์จะส่งไปมาระหว่างพีซีเครื่องนี้กับเซิร์ฟเวอร์ที่คุณระบุเฉพาะตอนเปิดหรือบันทึก',
  webdavEmptyTitle: 'ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์ WebDAV',
  webdavEmptyBody:
    'เพิ่มเซิร์ฟเวอร์ที่ การตั้งค่า → การเชื่อมต่อ แล้วเรียกดูและเปิดไฟล์ของเซิร์ฟเวอร์ได้ที่นี่',
  webdavOpenSettings: 'เปิดการตั้งค่า',
  webdavRoot: 'ราก',
  webdavFolderEmpty: 'โฟลเดอร์นี้ว่างเปล่า',
  webdavLoading: 'กำลังโหลด…',
  webdavRefresh: 'รีเฟรช',
  webdavUnsupported: 'แอปเปิดรูปแบบนี้ไม่ได้',
  webdavOpening: 'กำลังเปิด…',
  webdavServer: 'เซิร์ฟเวอร์',
  webdavErrUrl: 'ที่อยู่ไม่ถูกต้อง โปรดกรอกที่อยู่แบบเต็มที่ขึ้นต้นด้วย https:// หรือ http://',
  webdavErrInsecure: 'ติ๊กช่องยืนยันก่อนใช้การเชื่อมต่อ HTTP ที่ไม่เข้ารหัส',
  webdavErrAuth:
    'เซิร์ฟเวอร์ปฏิเสธการลงชื่อเข้าใช้ โปรดตรวจสอบชื่อผู้ใช้และรหัสผ่าน (หลายบริการต้องใช้รหัสผ่านแอป)',
  webdavErrNotFound: 'ไม่พบโฟลเดอร์หรือไฟล์นี้บนเซิร์ฟเวอร์',
  webdavErrForbidden: 'บัญชีนี้ไม่มีสิทธิ์ทำสิ่งนั้น',
  webdavErrNetwork: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ โปรดตรวจสอบที่อยู่และเครือข่าย',
  webdavErrLimit: 'เชื่อมต่อเซิร์ฟเวอร์ได้สูงสุด 10 เครื่อง',
  webdavErrTooLarge: 'ไฟล์ใหญ่เกินกว่าจะเปิดได้',
  webdavErrRateLimit: 'เซิร์ฟเวอร์ขอให้ลองใหม่ภายหลัง',
  webdavErrLocked: 'มีคนอื่นล็อกไฟล์นี้อยู่',
  webdavErrDisk: 'บันทึกไฟล์ลงพีซีเครื่องนี้ไม่ได้',
} satisfies Record<keyof typeof zh, string>
