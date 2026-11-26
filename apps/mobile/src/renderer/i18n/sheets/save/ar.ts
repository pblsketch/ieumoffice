import type { zh } from './zh'

export const ar = {
  sheetsShareFailed: 'تعذّرت مشاركة هذا الملف.',
  sheetsSaveFailed: 'تعذّر الحفظ. الملف الأصلي لم يتغير.',
  sheetsSaveNotYet: 'لا يمكن حفظ هذا المصنف على الهاتف بعد.',
} as const satisfies Record<keyof typeof zh, string>
