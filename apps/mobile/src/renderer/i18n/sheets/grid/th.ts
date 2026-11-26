import type { zh } from './zh'

export const th = {
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
