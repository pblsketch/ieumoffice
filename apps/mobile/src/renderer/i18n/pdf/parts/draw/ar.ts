import type { zh } from './zh'

export const ar = {
  pdfDrawSettings: 'إعدادات القلم',
  pdfDrawTool: 'الأداة',
  pdfDrawPen: 'قلم',
  pdfDrawRect: 'مستطيل',
  pdfDrawEllipse: 'قطع ناقص',
  pdfDrawLine: 'خط',
  pdfDrawArrow: 'سهم',
  pdfDrawEraser: 'ممحاة',
  pdfDrawColor: 'اللون',
  pdfDrawColorRed: 'أحمر',
  pdfDrawColorYellow: 'أصفر',
  pdfDrawColorGreen: 'أخضر',
  pdfDrawColorBlue: 'أزرق',
  pdfDrawColorBlack: 'أسود',
  pdfDrawWidth: 'السُمك',
  pdfDrawWidthValue: '{width} نقطة',
  pdfDrawFinger: 'الرسم بالإصبع أيضًا',
  pdfDrawFingerHint:
    'عند التشغيل، يظل الإصبع يرسم حتى بعد استخدام القلم. عند الإيقاف، يحرّك الإصبع الصفحة بعد استخدام القلم.',
  pdfDrawEraserHint: 'تمسح الممحاة فقط الخطوط والأشكال التي لم تُحفظ بعد.',
  pdfDrawRefused: 'لا يمكن الرسم الآن. حاول مرة أخرى بعد قليل.',
} as const satisfies Record<keyof typeof zh, string>
