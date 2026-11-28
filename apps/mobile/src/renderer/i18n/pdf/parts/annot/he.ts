import type { zh } from './zh'

export const he = {
  pdfAnnotHighlight: 'הדגשה',
  pdfAnnotUnderline: 'קו תחתון',
  pdfAnnotSquiggly: 'קו גלי',
  pdfAnnotStrikeout: 'קו חוצה',
  pdfAnnotModeSelect: 'בחירת טקסט',
  pdfAnnotModeNote: 'הצבת הערה',
  pdfAnnotHintSelect:
    'כדי לבחור, גררו הצידה על הטקסט, או לחצו לחיצה ארוכה ואז גררו. הקישו על סימון כדי לשנות את צבעו או להסיר אותו.',
  pdfAnnotHintNote: 'הקישו במקום שבו תוצב ההערה.',
  pdfAnnotPen: 'מרקר {n}',
  pdfAnnotColor: 'צבע {n}',
  pdfAnnotRemove: 'הסרת סימון',
  pdfAnnotMarkupTitle: 'צבע הסימון',
  pdfAnnotClearSelection: 'ביטול הבחירה',
  pdfAnnotNoText: 'אין בעמוד זה טקסט שאפשר לבחור.',
  pdfAnnotOpenNote: 'פתיחת הערה',
  pdfAnnotFailed: 'לא ניתן היה לשנות את ההערה.',
  pdfAnnotNewNote: 'הערה חדשה',
  pdfAnnotReplyPlaceholder: 'כתבו תשובה',
} as const satisfies Record<keyof typeof zh, string>
