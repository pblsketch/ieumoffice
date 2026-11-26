import type { zh } from './zh'

export const ar = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'جارٍ تحميل الشبكة…',
  sheetsOpening: 'جارٍ فتح المصنف… تستغرق الملفات الكبيرة بعض الوقت.',
  sheetsPasswordTitle: 'مصنف محمي بكلمة مرور',
  sheetsPasswordMessage: 'أدخل كلمة المرور لفتح هذا المصنف.',
  sheetsPasswordLabel: 'كلمة المرور',
  sheetsPasswordWrong: 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
  sheetsPasswordOpen: 'فتح',
  sheetsPasswordCancel: 'إلغاء',
  sheetsEncryptionUnsupported: 'لا يمكن فتح هذا النوع من الحماية بكلمة مرور.',
  sheetsEncryptionDamaged: 'هذا المصنف المحمي تالف ولا يمكن فتحه.',
  sheetsNoticeMacros: 'يتم الاحتفاظ بوحدات الماكرو دون تشغيلها.',
  sheetsNoticeExternalLinks: 'تعرض الخلايا التي تشير إلى ملفات أخرى آخر قيم محفوظة.',
  sheetsNoticeMacrosAndLinks:
    'يتم الاحتفاظ بوحدات الماكرو دون تشغيلها. تعرض الخلايا التي تشير إلى ملفات أخرى آخر قيم محفوظة.',
} as const satisfies Record<keyof typeof zh, string>
