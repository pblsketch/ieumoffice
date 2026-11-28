import type { zh } from './zh'

export const he = {
  pdfEditPen: 'עט',
  pdfEditHighlighter: 'מרקר',
  pdfEditTextBox: 'תיבת טקסט',
  pdfEditSign: 'חתימה',
  pdfEditPages: 'סידור עמודים',
  pdfEditLink: 'הוספת קישור',
  pdfEditSaveFailed: 'לא ניתן לשמור. השינויים שלך נשארו והקובץ לא שונה.',
  pdfEditSaveSkipped: 'לא ניתן היה לשמור חלק מעריכות הטקסט בעמוד {pages}.',
  pdfEditShareFailed: 'לא ניתן לשתף.',
  pdfEditReloadFailed: 'נשמר, אך לא ניתן לטעון מחדש את המסמך. פתחו את הקובץ שוב.',
  pdfEditSignatureUnavailable: 'חתימה עדיין אינה זמינה.',
  pdfEditSaveAsHint:
    'בחר כיצד לטפל בהדגשות, בפתקים ובציורים בעותק. „צרוב בעמודים” צורב גם שדות טופס; „השמט הערות” שומר על קישורים ושדות טופס.',
  pdfEditKeepAnnots: 'שמור הערות (ניתנות לעריכה באפליקציות אחרות)',
  pdfEditFlattenAnnots: 'צרוב בעמודים (נראה בכל אפליקציה)',
  pdfEditStripAnnots: 'השמט הערות (קישורים ושדות נשמרים)',
  pdfEditSaveVerifyFailed:
    'לא ניתן היה לכתוב את השינויים בעמוד {pages} במלואם; השמירה בוטלה והקובץ לא שונה. בטלו את העריכה הרלוונטית ונסו שוב',
} as const satisfies Record<keyof typeof zh, string>
