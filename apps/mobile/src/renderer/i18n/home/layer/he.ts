import type { zh } from './zh'

export const he = {
  homeRunEditorOffTitle: 'עורך {name} כבוי',
  homeRunEditorOffBody: 'הפעילו אותו כדי לפתוח את הקובץ הזה. אפשר לכבות אותו שוב בהגדרות.',
  homeRunEditorOffConfirm: 'הפעלה ופתיחה',
  homeRunStripSample: 'מסמך לדוגמה · לקריאה בלבד',
  homeRunStripReceived: 'קובץ שהתקבל · לקריאה בלבד',
  homeRunStripReadOnly: 'לקריאה בלבד',
  homeRunStripCopy: 'עריכת עותק',
  homeRunStripClose: 'סגירת ההודעה',
  homeRunReceiveTitle: 'קבצים שהתקבלו',
  homeRunReceiveCount: '{count} קבצים',
  homeRunReceiveClose: 'סגירת הקבצים שהתקבלו',
  homeRunReceiveOpen: 'פתיחה',
  homeRunReceivePdfOff: 'כלי ה-PDF כבויים',
  homeRunReceivePdfOn: 'הפעלה והמשך',
  homeRunGuideLabel: 'מדריך פתיחה',
  homeRunWelcomeTitle: 'ברוכים הבאים',
  homeRunWelcomeBody:
    'פותחים ועורכים מסמכי HWP, PDF, Markdown ועוד עם GenOffice. בלי חשבון, בלי פרסומות, והמסמכים נשארים במכשיר הזה.',
  homeRunStart: 'מתחילים',
  homeRunTipEditButton: 'כדי לשנות, הקישו על [ערוך]',
  homeRunTipFlowView: 'עברנו לתצוגת קריאה לקריאה נוחה · תצוגת עמוד נמצאת כאן',
  homeRunTipFirstEdit: 'עותק שחזור נוצר אוטומטית. המקור נשמר כשמקישים על [סיום]',
  homeRunTipFirstKeyboard: 'משנים את עיצוב הטקסט עם [Aa]',
} as const satisfies Record<keyof typeof zh, string>
