import type { zh } from './zh'

export const ar = {
  pdfEditPen: 'قلم',
  pdfEditHighlighter: 'قلم تمييز',
  pdfEditTextBox: 'مربع نص',
  pdfEditSign: 'توقيع',
  pdfEditPages: 'ترتيب الصفحات',
  pdfEditLink: 'إدراج رابط',
  pdfEditSaveFailed: 'تعذّر الحفظ. ما زالت تعديلاتك موجودة ولم يتغيّر الملف.',
  pdfEditSaveSkipped: 'تعذّر حفظ بعض تعديلات النص في الصفحة {pages}.',
  pdfEditShareFailed: 'تعذّرت المشاركة.',
  pdfEditReloadFailed: 'تم الحفظ، لكن تعذّرت إعادة تحميل المستند. افتح الملف مرة أخرى.',
  pdfEditSignatureUnavailable: 'التوقيع غير متاح بعد.',
  pdfEditSaveAsHint:
    'اختر كيفية التعامل مع التمييزات والملاحظات والرسومات في النسخة. «دمجها في الصفحات» يدمج حقول النماذج أيضًا، و«استبعاد التعليقات» يبقي الروابط وحقول النماذج.',
  pdfEditKeepAnnots: 'الاحتفاظ بالتعليقات (قابلة للتحرير في تطبيقات أخرى)',
  pdfEditFlattenAnnots: 'دمجها في الصفحات (تظهر في كل التطبيقات)',
  pdfEditStripAnnots: 'استبعاد التعليقات (تبقى الروابط وحقول النماذج)',
  pdfEditSaveVerifyFailed:
    'تعذّرت كتابة تعديلات الصفحة {pages} بالكامل؛ أُلغي الحفظ ولم يتغيّر الملف. تراجع عن التعديل المعني ثم حاول مجددًا',
} as const satisfies Record<keyof typeof zh, string>
