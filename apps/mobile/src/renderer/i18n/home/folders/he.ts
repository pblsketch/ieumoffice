import type { zh } from './zh'

export const he = {
  homeFolderListLabel: 'תיקיות מקושרות',
  homeFolderEmptyTitle: 'עדיין לא קושרו תיקיות',
  homeFolderEmptyBody: 'קשרו תיקייה שאתם משתמשים בה הרבה, והמסמכים והתמונות שבה יופיעו כאן מיד.',
  homeFolderLink: 'קישור תיקייה',
  homeFolderRelink: 'קישור מחדש',
  homeFolderRelinkNamed: 'קישור מחדש של {name}',
  homeFolderOk: 'מקושרת',
  homeFolderLostRevoked: 'ההרשאה לתיקייה הזו אבדה. קשרו אותה מחדש.',
  homeFolderLostMissing: 'התיקייה לא נמצאה. אם העברתם או מחקתם אותה, קשרו אותה מחדש.',
  homeFolderLost: 'אין גישה לתיקייה. קשרו אותה שוב.',
  homeFolderMenu: 'תפריט עבור {name}',
  homeFolderRemove: 'הסרה',
  homeFolderRemoveTitle: 'להסיר את התיקייה "{name}"?',
  homeFolderRemoveBody:
    'גם {count} הרשומות באחרונים ובמועדפים של קבצים בתיקייה הזו יוסרו. הקבצים עצמם נשארים.',
  homeFolderRemoved: 'התיקייה הוסרה.',
  homeFolderBack: 'לתיקייה שמעל',
  homeFolderPath: 'התיקייה הנוכחית',
  homeFolderSubfolder: 'תיקייה',
  homeFolderInsideEmpty: 'אין בתיקייה הזו מסמכים או תמונות לפתיחה.',
} as const satisfies Record<keyof typeof zh, string>
