import type { zh } from './zh'

export const th = {
  sheetsProvisionalNotice: 'ตารางรุ่นทดลอง: การแก้ไขของคุณยังไม่ถูกบันทึก',
  sheetsLoading: 'กำลังโหลดตาราง…',
  sheetsShareFailed: 'ไม่สามารถแชร์ไฟล์นี้ได้',
  sheetsFreezeTopRow: 'ตรึงแถวบนสุด',
  sheetsFreezeFirstColumn: 'ตรึงคอลัมน์แรก',
  sheetsUnfreeze: 'ยกเลิกการตรึงแนว',
  sheetsKeyboardBar: 'เครื่องมือป้อนสูตร',
  sheetsInsertSum: 'ฟังก์ชันผลรวม',
  sheetsInsertParens: 'วงเล็บ',
  sheetsNumericKeys: 'แป้นพิมพ์ตัวเลข',
  sheetsCancelEdit: 'ยกเลิก',
  sheetsConfirmEdit: 'ตกลง',
} as const satisfies Record<keyof typeof zh, string>
