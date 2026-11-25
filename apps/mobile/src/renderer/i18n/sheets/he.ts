import type { zh } from './zh'

export const he = {
  sheetsProvisionalNotice: 'רשת ניסיון: השינויים שלך עדיין לא נשמרים.',
  sheetsLoading: 'טוען את הרשת…',
  sheetsShareFailed: 'לא ניתן לשתף את הקובץ הזה.',
  sheetsFreezeTopRow: 'הקפא את השורה העליונה',
  sheetsFreezeFirstColumn: 'הקפא את העמודה הראשונה',
  sheetsUnfreeze: 'בטל הקפאת חלוניות',
  sheetsKeyboardBar: 'כלי הזנת נוסחאות',
  sheetsInsertSum: 'פונקציית סכום',
  sheetsInsertParens: 'סוגריים',
  sheetsNumericKeys: 'מקלדת מספרים',
  sheetsCancelEdit: 'ביטול',
  sheetsConfirmEdit: 'סיום',
} as const satisfies Record<keyof typeof zh, string>
