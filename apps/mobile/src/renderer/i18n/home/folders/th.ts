import type { zh } from './zh'

export const th = {
  homeFolderListLabel: 'โฟลเดอร์ที่เชื่อมไว้',
  homeFolderEmptyTitle: 'ยังไม่ได้เชื่อมโฟลเดอร์',
  homeFolderEmptyBody:
    'เชื่อมโฟลเดอร์ที่ใช้บ่อย แล้วเอกสารและรูปภาพในโฟลเดอร์นั้นจะแสดงที่นี่ทันที',
  homeFolderLink: 'เชื่อมโฟลเดอร์',
  homeFolderRelink: 'เชื่อมอีกครั้ง',
  homeFolderRelinkNamed: 'เชื่อม {name} อีกครั้ง',
  homeFolderOk: 'เชื่อมแล้ว',
  homeFolderLostRevoked: 'สิทธิ์เข้าถึงโฟลเดอร์นี้หายไปแล้ว ให้เชื่อมอีกครั้ง',
  homeFolderLostMissing: 'หาโฟลเดอร์นี้ไม่พบ ถ้าย้ายหรือลบไปแล้ว ให้เชื่อมอีกครั้ง',
  homeFolderLost: 'เข้าถึงโฟลเดอร์ไม่ได้ โปรดเชื่อมโฟลเดอร์อีกครั้ง',
  homeFolderMenu: 'เมนูของ {name}',
  homeFolderRemove: 'นำออก',
  homeFolderRemoveTitle: 'นำโฟลเดอร์ "{name}" ออกไหม',
  homeFolderRemoveBody:
    'รายการล่าสุดและรายการโปรดของไฟล์ในโฟลเดอร์นี้ {count} รายการจะถูกนำออกด้วย ตัวไฟล์จะไม่ถูกลบ',
  homeFolderRemoved: 'นำโฟลเดอร์ออกแล้ว',
  homeFolderBack: 'ไปโฟลเดอร์ระดับบน',
  homeFolderPath: 'โฟลเดอร์ปัจจุบัน',
  homeFolderSubfolder: 'โฟลเดอร์',
  homeFolderInsideEmpty: 'โฟลเดอร์นี้ไม่มีเอกสารหรือรูปภาพที่เปิดได้',
} as const satisfies Record<keyof typeof zh, string>
