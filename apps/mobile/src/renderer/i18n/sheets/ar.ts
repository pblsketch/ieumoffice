import type { zh } from './zh'

export const ar = {
  sheetsProvisionalNotice: 'شبكة تجريبية: لا تُحفظ تغييراتك بعد.',
  sheetsLoading: 'جارٍ تحميل الشبكة…',
  sheetsShareFailed: 'تعذّرت مشاركة هذا الملف.',
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
