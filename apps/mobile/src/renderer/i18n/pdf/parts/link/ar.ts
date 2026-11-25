import type { zh } from './zh'

export const ar = {
  pdfLinkPlaceHint: 'اسحب مربعًا على الصفحة حيث سيوضع الرابط',
  pdfLinkEditTitle: 'تعديل الرابط',
  pdfLinkUrlLabel: 'عنوان الويب (http أو https أو mailto)',
  pdfLinkPageLabel: 'أو صفحة في هذا المستند (1–{count})',
  pdfLinkUrlInvalid: 'يمكن الربط بعناوين http وhttps وmailto فقط',
  pdfLinkPageInvalid: 'أدخل رقم صفحة من 1 إلى {count}',
  pdfLinkNeedTarget: 'أدخل عنوان ويب أو رقم صفحة',
  pdfLinkApply: 'إضافة الرابط',
  pdfLinkDelete: 'حذف الرابط',
  pdfLinkPending: 'رابط سيُضاف: {target}',
  pdfLinkToPage: 'الصفحة {page}',
  pdfLinkFailed: 'تعذّر تغيير الرابط. حاول مرة أخرى بعد انتهاء الحفظ.',
  pdfLinkUpdate: 'تطبيق',
} as const satisfies Record<keyof typeof zh, string>
