import type { zh } from './zh'

export const he = {
  homeTabNav: 'תפריט מסך הבית',
  homeTabRecent: 'אחרונים',
  homeTabFolders: 'תיקיות',
  homeTabTools: 'כלים',
  homeTabSettings: 'הגדרות',
  homeListAll: 'הכול',
  homeListFavorites: 'מועדפים',
  homeListChips: 'סינון הרשימה',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'אין עדיין מועדפים. אפשר להוסיף קובץ למועדפים דרך התפריט [⋯] שלו.',
  homeListGroupEmpty: 'אין עדיין קבצים בקבוצה הזו.',
  homeListFavoriteLost: 'לא ניתן לפתוח את הקובץ. ייתכן שהוא הועבר או נמחק.',
  homeEmptyText: 'עדיין לא פתחת אף מסמך. אפשר לנסות את מסמך הדוגמה או לפתוח קובץ.',
  homeEmptySample: 'פתיחת מסמך הדוגמה',
  homeEmptyCreate: 'יצירת חדש',
  homeCreateFab: 'יצירת חדש',
  homeCreateTitle: 'יצירת חדש',
  homeCreateClose: 'סגירה',
  homeCreatePdfTools: 'כלי PDF',
} as const satisfies Record<keyof typeof zh, string>
