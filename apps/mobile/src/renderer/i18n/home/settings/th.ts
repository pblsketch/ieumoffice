import type { zh } from './zh'

export const th = {
  homeSetEditorsTitle: 'ตัวแก้ไข',
  homeSetEditorsHint:
    'ตัวแก้ไขที่ปิดไว้จะไม่อยู่ในรายการเอกสารใหม่ ถ้าปิดทั้งหมดจะถือว่าเปิดทั้งหมด',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'เครื่องมือ PDF',
  homeSetCardsTitle: 'เอกสารใหม่บนหน้าหลัก',
  homeSetCardShow: 'แสดง {name} บนหน้าหลัก',
  homeSetCardUp: 'เลื่อน {name} ขึ้น',
  homeSetCardDown: 'เลื่อน {name} ลง',
  homeSetKeepScreenOn: 'เปิดหน้าจอค้างไว้ขณะอ่าน',
  homeSetKeepScreenOnDesc: 'หน้าจอจะไม่ดับขณะอ่าน PDF หรือ EPUB หรือนำเสนอ PPT',
  homeSetFoldersTitle: 'โฟลเดอร์เอกสาร',
  homeSetFoldersEmpty: 'ยังไม่ได้เชื่อมโฟลเดอร์ เมื่อเชื่อมแล้วจะดูไฟล์ได้ทันทีในแท็บโฟลเดอร์',
  homeSetFolderLink: 'เชื่อมโฟลเดอร์',
  homeSetFolderRelink: 'เชื่อมอีกครั้ง',
  homeSetFolderRemove: 'นำออก',
  homeSetFolderRemoveNamed: 'นำ {name} ออก',
  homeSetFolderOk: 'เชื่อมแล้ว',
  homeSetFolderLost: 'เข้าถึงโฟลเดอร์นี้ไม่ได้ ถ้าย้ายหรือลบไปแล้ว ให้เชื่อมอีกครั้ง',
  homeSetFolderRemoveTitle: 'นำโฟลเดอร์ "{name}" ออกไหม',
  homeSetFolderRemoveBody:
    'รายการล่าสุดและรายการโปรดของไฟล์ในโฟลเดอร์นี้ {count} รายการจะถูกนำออกด้วย ตัวไฟล์จะไม่ถูกลบ',
  homeSetBackupsTotal: 'รวม {size}',
  homeSetStorageTitle: 'พื้นที่จัดเก็บ',
  homeSetStorageRecovery: 'สำเนากู้คืน',
  homeSetStorageTemp: 'ไฟล์ชั่วคราว',
  homeSetStorageBackups: 'สำรองไฟล์ต้นฉบับ HWP',
  homeSetStorageClearTemp: 'ล้างไฟล์ชั่วคราว',
  homeSetStorageClearRecovery: 'ล้างสำเนากู้คืนทั้งหมด',
  homeSetStorageClearTempTitle: 'ล้างไฟล์ชั่วคราวไหม',
  homeSetStorageClearTempBody:
    'จะลบไฟล์ที่สร้างไว้ชั่วคราวตอนแชร์หรือรับไฟล์ ไฟล์เอกสารยังอยู่เหมือนเดิม',
  homeSetStorageClearRecoveryTitle: 'ล้างสำเนากู้คืนทั้งหมดไหม',
  homeSetStorageClearRecoveryBody:
    'การแก้ไขที่ยังไม่ได้บันทึกจะหายไป สำเนากู้คืนของเอกสารที่เปิดอยู่จะยังเก็บไว้',
  homeSetStorageClearAction: 'ล้าง',
  homeSetStorageCleared: 'เพิ่มพื้นที่ว่าง {size} แล้ว',
  homeSetFailed: 'ทำไม่สำเร็จ ลองอีกครั้งในอีกสักครู่',
} as const satisfies Record<keyof typeof zh, string>
