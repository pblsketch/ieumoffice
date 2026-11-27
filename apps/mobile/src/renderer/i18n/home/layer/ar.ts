import type { zh } from './zh'

export const ar = {
  homeRunEditorOffTitle: 'محرر {name} متوقف',
  homeRunEditorOffBody: 'شغّله لفتح هذا الملف. يمكنك إيقافه مرة أخرى من الإعدادات.',
  homeRunEditorOffConfirm: 'التشغيل والفتح',
  homeRunStripSample: 'مستند نموذجي · للقراءة فقط',
  homeRunStripReceived: 'ملف مستلم · للقراءة فقط',
  homeRunStripReadOnly: 'للقراءة فقط',
  homeRunStripCopy: 'تحرير نسخة',
  homeRunStripClose: 'إغلاق التنبيه',
  homeRunReceiveTitle: 'الملفات المستلمة',
  homeRunReceiveCount: 'عدد الملفات: {count}',
  homeRunReceiveClose: 'إغلاق الملفات المستلمة',
  homeRunReceiveOpen: 'فتح',
  homeRunReceivePdfOff: 'أدوات PDF متوقفة',
  homeRunReceivePdfOn: 'التشغيل والمتابعة',
  homeRunGuideLabel: 'دليل البدء',
  homeRunWelcomeTitle: 'مرحبًا بك',
  homeRunWelcomeBody:
    'افتح مستندات HWP وPDF وMarkdown وغيرها وعدّلها باستخدام GenOffice. بلا حساب ولا إعلانات، وتبقى مستنداتك على هذا الجهاز.',
  homeRunStart: 'ابدأ',
  homeRunTipEditButton: 'لإجراء تغييرات، اضغط [تحرير]',
  homeRunTipFlowView: 'تم التبديل إلى عرض القراءة لتسهيل القراءة · عرض الصفحة هنا',
  homeRunTipFirstEdit: 'تُنشأ نسخة استرداد تلقائيًا. يُحفظ الأصل عند الضغط على [تم]',
  homeRunTipFirstKeyboard: 'غيّر تنسيق النص باستخدام [Aa]',
} as const satisfies Record<keyof typeof zh, string>
