import type { zh } from './zh'

export const th = {
  sheetsToolbarFormat: 'รูปแบบเซลล์',
  sheetsToolbarRows: 'แถวและคอลัมน์',
  sheetsToolbarSort: 'เรียงลำดับและกรอง',
  sheetsToolbarInsert: 'แทรก',
  sheetsToolbarInsertValues: 'วันที่และแผ่นงาน',
  sheetsToolbarToday: 'วันที่วันนี้',
  sheetsToolbarTimeNow: 'เวลาปัจจุบัน',
  sheetsToolbarNewSheet: 'แผ่นงานใหม่',
  sheetsToolbarFind: 'ค้นหา',
  sheetsToolbarViewOnly:
    'แผนภูมิ ตาราง Pivot และการจัดรูปแบบตามเงื่อนไขดูได้อย่างเดียวที่นี่ เปิดไฟล์บนคอมพิวเตอร์เพื่อแก้ไข',
  sheetsToolbarFullLoaded: 'โหลดเวิร์กบุ๊กทั้งหมดแล้ว แตะเรียงลำดับหรือกรองอีกครั้ง',
} as const satisfies Record<keyof typeof zh, string>
