import type { zh } from './zh'

export const ar = {
  sheetsFreezeTopRow: 'تجميد الصف العلوي',
  sheetsFreezeFirstColumn: 'تجميد العمود الأول',
  sheetsUnfreeze: 'إلغاء تجميد الأجزاء',
  sheetsKeyboardBar: 'أدوات إدخال الصيغ',
  sheetsInsertSum: 'دالة الجمع',
  sheetsInsertParens: 'أقواس',
  sheetsNumericKeys: 'لوحة مفاتيح رقمية',
  sheetsCancelEdit: 'إلغاء',
  sheetsConfirmEdit: 'تم',
} as const satisfies Record<keyof typeof zh, string>
