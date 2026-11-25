import type { zh } from './zh'

export const he = {
  pdfDrawSettings: 'הגדרות עט',
  pdfDrawTool: 'כלי',
  pdfDrawPen: 'עט',
  pdfDrawRect: 'מלבן',
  pdfDrawEllipse: 'אליפסה',
  pdfDrawLine: 'קו',
  pdfDrawArrow: 'חץ',
  pdfDrawEraser: 'מחק',
  pdfDrawColor: 'צבע',
  pdfDrawColorRed: 'אדום',
  pdfDrawColorYellow: 'צהוב',
  pdfDrawColorGreen: 'ירוק',
  pdfDrawColorBlue: 'כחול',
  pdfDrawColorBlack: 'שחור',
  pdfDrawWidth: 'עובי',
  pdfDrawWidthValue: '{width} נק׳',
  pdfDrawFinger: 'לצייר גם באצבע',
  pdfDrawFingerHint:
    'כשהאפשרות פעילה, האצבע ממשיכה לצייר גם אחרי שימוש בעט. כשהיא כבויה, אחרי שימוש בעט האצבע מזיזה את הדף.',
  pdfDrawEraserHint: 'המחק מוחק רק קווים וצורות שעדיין לא נשמרו.',
  pdfDrawRefused: 'אי אפשר לצייר כרגע. נסו שוב בעוד רגע.',
} as const satisfies Record<keyof typeof zh, string>
