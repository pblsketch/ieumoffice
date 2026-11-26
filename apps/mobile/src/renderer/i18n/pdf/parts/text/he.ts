import type { zh } from './zh'

export const he = {
  pdfTextHint: 'הקישו על מקום ריק כדי להוסיף טקסט, או על טקסט כדי לערוך אותו.',
  pdfTextInputLabel: 'טקסט להוספה',
  pdfTextEditLabel: 'טקסט לעריכה',
  pdfTextStyleBar: 'סגנון טקסט',
  pdfTextBold: 'מודגש',
  pdfTextSize: 'גודל טקסט',
  pdfTextSizeDown: 'הקטנת טקסט',
  pdfTextSizeUp: 'הגדלת טקסט',
  pdfTextColor: 'צבע טקסט',
  pdfTextColorDocument: 'שמירה על צבע המסמך',
  pdfTextFont: 'גופן',
  pdfTextFontDocument: 'גופן המסמך',
  pdfTextBack: 'חזרה',
  pdfTextDelete: 'מחיקה',
  pdfTextDone: 'סיום',
  pdfTextCannotDraw: 'לא ניתן להוסיף את התווים האלה: {chars}',
  pdfTextFontSubstituted: 'התווים האלה יוצגו בגופן אחר: {chars}',
  pdfTextScannedPage: 'בעמוד הזה אין טקסט. אפשר רק להוסיף טקסט חדש.',
  pdfTextNoMatch: 'לא ניתן לערוך את הטקסט הזה: הוא לא נמצא במסמך.',
  pdfTextOverflow: 'הטקסט הערוך יחפוף לטקסט שמתחתיו. נא לקצר אותו.',
} as const satisfies Record<keyof typeof zh, string>
