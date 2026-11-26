import type { zh } from './zh'

export const ar = {
  aiOutboundTitle: 'هل تريد جلب هذا العنوان؟',
  aiOutboundIntro: 'يريد الذكاء الاصطناعي جلب عنوان لم يظهر في المحادثة.',
  aiOutboundHint: 'إذا كان العنوان يحتوي على نص من مستندك أو كان الموقع غير معروف، فاحظره.',
  aiOutboundBlock: 'حظر',
  aiOutboundAllow: 'سماح',
} as const satisfies Record<keyof typeof zh, string>
