import type { zh } from './zh'

export const he = {
  sheetsToolbarFormat: 'עיצוב תא',
  sheetsToolbarRows: 'שורות ועמודות',
  sheetsToolbarSort: 'מיון וסינון',
  sheetsToolbarInsert: 'הוספה',
  sheetsToolbarInsertValues: 'תאריכים וגיליונות',
  sheetsToolbarToday: 'התאריך של היום',
  sheetsToolbarTimeNow: 'השעה הנוכחית',
  sheetsToolbarNewSheet: 'גיליון חדש',
  sheetsToolbarFind: 'חיפוש',
  sheetsToolbarViewOnly:
    'תרשימים, טבלאות ציר ועיצוב מותנה זמינים כאן לצפייה בלבד. כדי לשנות אותם, פתחו את הקובץ במחשב.',
  sheetsToolbarFullLoaded: 'כל חוברת העבודה נטענה. הקישו שוב על מיון או סינון.',
} as const satisfies Record<keyof typeof zh, string>
