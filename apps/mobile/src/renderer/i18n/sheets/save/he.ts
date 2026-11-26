import type { zh } from './zh'

export const he = {
  sheetsShareFailed: 'לא ניתן לשתף את הקובץ הזה.',
  sheetsSaveFailed: 'השמירה נכשלה. הקובץ המקורי לא השתנה.',
  sheetsSaveNotYet: 'עדיין אי אפשר לשמור את חוברת העבודה בטלפון.',
} as const satisfies Record<keyof typeof zh, string>
