import type { zh } from './zh'

export const he = {
  aiOutboundTitle: 'לטעון את הכתובת הזו?',
  aiOutboundIntro: 'ה-AI רוצה לטעון כתובת שלא הופיעה בשיחה.',
  aiOutboundHint: 'אם הכתובת מכילה טקסט מהמסמך או שהאתר אינו מוכר, חסום אותה.',
  aiOutboundBlock: 'חסום',
  aiOutboundAllow: 'אפשר',
} as const satisfies Record<keyof typeof zh, string>
