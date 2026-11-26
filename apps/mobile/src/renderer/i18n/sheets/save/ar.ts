import type { zh } from './zh'

export const ar = {
  sheetsShareFailed: 'تعذّرت مشاركة هذا الملف.',
  sheetsSaveFailed: 'تعذّر الحفظ. الملف الأصلي لم يتغير.',
  sheetsSaveAsTitle: 'حفظ باسم',
  sheetsShareTitle: 'المشاركة بتنسيق',
  sheetsFormatWorkbook: 'مصنف Excel ‏(.xlsx)',
  sheetsFormatWorkbookMacro: 'مصنف Excel ممكّن للماكرو ‏(.xlsm)',
  sheetsFormatCsv: 'CSV (الورقة الحالية فقط)',
  sheetsFormatOds: 'جدول بيانات ODS (نسخة من المصنف)',
  sheetsFormatPdf: 'PDF (الورقة الحالية)',
  sheetsOdsEncrypted: 'لا يمكن تصدير مصنف محمي بكلمة مرور بتنسيق ODS.',
  sheetsChoiceCancel: 'إلغاء',
  sheetsCsvAskTitle: 'حفظ ملف CSV',
  sheetsCsvAskMessage: 'يحتفظ ملف CSV بقيم الورقة الحالية فقط.',
  sheetsCsvAskCsv: 'حفظ بتنسيق CSV (من دون التنسيق والأوراق الأخرى)',
  sheetsCsvAskXlsx: 'حفظ كملف Excel',
  sheetsCsvFormulaTitle: 'تبقى قيم الصيغ فقط',
  sheetsCsvFormulaMessage:
    'تُحفظ صيغ هذه الورقة في ملف CSV كقيم محسوبة فقط. للاحتفاظ بالصيغ، احفظ كملف Excel.',
  sheetsCsvContinue: 'المتابعة بتنسيق CSV',
  sheetsOdsLossTitle: 'تصدير بتنسيق ODS',
  sheetsOdsLossMessage:
    'لن تُضمَّن في النسخة {count} من الميزات التي لا يحتملها ODS (الصيغ والمخططات والصور والتنسيق الشرطي ونحوها).',
  sheetsOdsContinue: 'متابعة',
  sheetsOdsUnreadable: 'تعذّر فتح ملف ODS مرة أخرى، لذلك لم تتم كتابته.',
  sheetsOdsFailed: 'تعذّر التصدير بتنسيق ODS.',
  sheetsCopySaved: 'تم حفظ النسخة: {name}',
  sheetsPdfWorking: 'جارٍ إنشاء PDF…',
  sheetsPdfFailed: 'تعذّر إنشاء PDF.',
  sheetsPdfSkippedVisuals: 'تعذّر وضع {count} من الصور أو المخططات في PDF.',
  sheetsPdfMissingGlyphs: 'تظهر {count} من الأحرف غير الموجودة في الخطوط كمربعات فارغة في PDF.',
  sheetsSaveErrDiskChanged:
    'غيّر تطبيق آخر الملف الأصلي بعد فتحه. لم تتم الكتابة فوقه؛ استخدم حفظ باسم.',
  sheetsSaveErrTooLarge:
    'الملف كبير جدًا (أكثر من 14 ميغابايت تقريبًا) للكتابة على هذا الهاتف. الملف الأصلي لم يتغير.',
  sheetsSaveErrUnreadable: 'تعذّر فتح المصنف المحفوظ مرة أخرى، لذا تُرك الأصلي كما هو.',
  sheetsSaveErrLockFailed: 'تعذّر قفل المصنف مرة أخرى بكلمة مروره، لذا تُرك الأصلي كما هو.',
  sheetsSaveBusy: 'الحفظ جارٍ. أعد المحاولة بعد انتهائه.',
} as const satisfies Record<keyof typeof zh, string>
