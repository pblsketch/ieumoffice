import type { zh } from './zh'

export const he = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'טוען את הרשת…',
  sheetsOpening: 'פותח את חוברת העבודה… קבצים גדולים לוקחים רגע.',
  sheetsPasswordTitle: 'חוברת עבודה מוגנת בסיסמה',
  sheetsPasswordMessage: 'הזינו את הסיסמה כדי לפתוח את חוברת העבודה.',
  sheetsPasswordLabel: 'סיסמה',
  sheetsPasswordWrong: 'הסיסמה שגויה. נסו שוב.',
  sheetsPasswordOpen: 'פתיחה',
  sheetsPasswordCancel: 'ביטול',
  sheetsEncryptionUnsupported: 'לא ניתן לפתוח סוג הגנה זה בסיסמה.',
  sheetsEncryptionDamaged: 'חוברת העבודה המוגנת פגומה ולא ניתן לפתוח אותה.',
  sheetsNoticeMacros: 'פקודות המאקרו נשמרות אך אינן מופעלות.',
  sheetsNoticeExternalLinks: 'תאים שמפנים לקבצים אחרים מציגים את הערכים שנשמרו לאחרונה.',
  sheetsNoticeMacrosAndLinks:
    'פקודות המאקרו נשמרות אך אינן מופעלות. תאים שמפנים לקבצים אחרים מציגים את הערכים שנשמרו לאחרונה.',
} as const satisfies Record<keyof typeof zh, string>
