import type { zh } from './zh'

export const th = {
  homeTabNav: 'เมนูหน้าแรก',
  homeTabRecent: 'ล่าสุด',
  homeTabFolders: 'โฟลเดอร์',
  homeTabTools: 'เครื่องมือ',
  homeTabSettings: 'การตั้งค่า',
  homeListAll: 'ทั้งหมด',
  homeListFavorites: 'รายการโปรด',
  homeListChips: 'กรองรายการ',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'ยังไม่มีรายการโปรด ใช้ [⋯] ของไฟล์เพื่อเพิ่มลงในรายการโปรด',
  homeListGroupEmpty: 'ยังไม่มีไฟล์ในกลุ่มนี้',
  homeListFavoriteLost: 'เปิดไฟล์นี้ไม่ได้ ไฟล์อาจถูกย้ายหรือลบไปแล้ว',
  homeEmptyText: 'ยังไม่ได้เปิดเอกสารใดเลย ลองดูเอกสารตัวอย่างหรือเปิดไฟล์',
  homeEmptySample: 'เปิดเอกสารตัวอย่าง',
  homeEmptyCreate: 'สร้างใหม่',
  homeCreateFab: 'สร้างใหม่',
  homeCreateTitle: 'สร้างใหม่',
  homeCreateClose: 'ปิด',
  homeCreatePdfTools: 'เครื่องมือ PDF',
} as const satisfies Record<keyof typeof zh, string>
