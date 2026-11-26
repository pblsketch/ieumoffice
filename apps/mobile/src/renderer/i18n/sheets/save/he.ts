import type { zh } from './zh'

export const he = {
  sheetsShareFailed: 'לא ניתן לשתף את הקובץ הזה.',
  sheetsSaveFailed: 'השמירה נכשלה. הקובץ המקורי לא השתנה.',
  sheetsSaveAsTitle: 'שמירה בשם',
  sheetsShareTitle: 'שיתוף בתבנית',
  sheetsFormatWorkbook: 'חוברת עבודה של Excel ‏(.xlsx)',
  sheetsFormatWorkbookMacro: 'חוברת עבודה של Excel עם מאקרו ‏(.xlsm)',
  sheetsFormatCsv: 'CSV (הגיליון הנוכחי בלבד)',
  sheetsFormatOds: 'גיליון ODS (עותק של חוברת העבודה)',
  sheetsFormatPdf: 'PDF (הגיליון הנוכחי)',
  sheetsOdsEncrypted: 'אי אפשר לייצא ל-ODS חוברת עבודה עם סיסמה.',
  sheetsChoiceCancel: 'ביטול',
  sheetsCsvAskTitle: 'שמירת קובץ CSV',
  sheetsCsvAskMessage: 'קובץ CSV שומר רק את הערכים של הגיליון הנוכחי.',
  sheetsCsvAskCsv: 'שמירה כ-CSV (בלי עיצוב וגיליונות אחרים)',
  sheetsCsvAskXlsx: 'שמירה כקובץ Excel',
  sheetsCsvFormulaTitle: 'בנוסחאות יישארו רק הערכים',
  sheetsCsvFormulaMessage:
    'הנוסחאות בגיליון הזה יישמרו ב-CSV רק כערכים מחושבים. כדי לשמור את הנוסחאות, שמרו כקובץ Excel.',
  sheetsCsvContinue: 'להמשיך כ-CSV',
  sheetsOdsLossTitle: 'ייצוא ל-ODS',
  sheetsOdsLossMessage:
    '{count} תכונות ש-ODS לא יכול להכיל (נוסחאות, תרשימים, תמונות, עיצוב מותנה וכדומה) לא ייכללו בעותק.',
  sheetsOdsContinue: 'המשך',
  sheetsOdsUnreadable: 'לא ניתן היה לפתוח שוב את קובץ ה-ODS, ולכן הוא לא נכתב.',
  sheetsOdsFailed: 'לא ניתן לייצא ל-ODS.',
  sheetsCopySaved: 'העותק נשמר: {name}',
  sheetsPdfWorking: 'יוצר PDF…',
  sheetsPdfFailed: 'לא ניתן ליצור PDF.',
  sheetsPdfSkippedVisuals: 'לא ניתן היה להכניס ל-PDF ‏{count} תמונות או תרשימים.',
  sheetsPdfMissingGlyphs: '{count} תווים שאינם בגופנים מופיעים ב-PDF כתיבות ריקות.',
  sheetsSaveErrDiskChanged:
    'אפליקציה אחרת שינתה את המקור אחרי שנפתח. הוא לא נדרס; השתמשו בשמירה בשם.',
  sheetsSaveErrTooLarge: 'הקובץ גדול מדי (יותר מכ-14MB) לכתיבה בטלפון הזה. המקור לא השתנה.',
  sheetsSaveErrUnreadable:
    'לא ניתן היה לפתוח שוב את חוברת העבודה השמורה, ולכן המקור נשאר כפי שהיה.',
  sheetsSaveErrLockFailed:
    'לא ניתן היה לנעול שוב את חוברת העבודה בסיסמה שלה, ולכן המקור נשאר כפי שהיה.',
  sheetsSaveBusy: 'השמירה מתבצעת. נסו שוב כשתסתיים.',
} as const satisfies Record<keyof typeof zh, string>
