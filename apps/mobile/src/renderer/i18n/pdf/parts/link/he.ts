import type { zh } from './zh'

export const he = {
  pdfLinkPlaceHint: 'גררו מסגרת בעמוד במקום שבו יופיע הקישור',
  pdfLinkEditTitle: 'עריכת קישור',
  pdfLinkUrlLabel: 'כתובת אתר (http, https, mailto)',
  pdfLinkPageLabel: 'או עמוד במסמך זה (1–{count})',
  pdfLinkUrlInvalid: 'אפשר לקשר רק לכתובות http, https ו-mailto',
  pdfLinkPageInvalid: 'הזינו מספר עמוד בין 1 ל-{count}',
  pdfLinkNeedTarget: 'הזינו כתובת אתר או מספר עמוד',
  pdfLinkApply: 'הוספת קישור',
  pdfLinkDelete: 'מחיקת קישור',
  pdfLinkPending: 'קישור שיתווסף: {target}',
  pdfLinkToPage: 'עמוד {page}',
  pdfLinkFailed: 'לא ניתן לשנות את הקישור. נסו שוב בסיום השמירה.',
  pdfLinkUpdate: 'החלה',
} as const satisfies Record<keyof typeof zh, string>
