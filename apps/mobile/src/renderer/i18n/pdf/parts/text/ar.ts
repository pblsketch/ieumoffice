import type { zh } from './zh'

export const ar = {
  pdfTextHint: 'انقر على مساحة فارغة لإضافة نص، أو انقر على نص لتعديله.',
  pdfTextInputLabel: 'النص المراد إضافته',
  pdfTextEditLabel: 'النص المراد تعديله',
  pdfTextStyleBar: 'نمط النص',
  pdfTextBold: 'غامق',
  pdfTextSize: 'حجم الخط',
  pdfTextSizeDown: 'تصغير النص',
  pdfTextSizeUp: 'تكبير النص',
  pdfTextColor: 'لون النص',
  pdfTextColorDocument: 'الإبقاء على لون المستند',
  pdfTextFont: 'الخط',
  pdfTextFontDocument: 'خط المستند',
  pdfTextBack: 'رجوع',
  pdfTextDelete: 'حذف',
  pdfTextDone: 'تم',
  pdfTextCannotDraw: 'لا يمكن إضافة هذه الأحرف: {chars}',
  pdfTextFontSubstituted: 'ستُعرض هذه الأحرف بخط آخر: {chars}',
  pdfTextScannedPage: 'لا تحتوي هذه الصفحة على نص. يمكنك إضافة نص جديد فقط.',
  pdfTextNoMatch: 'لا يمكن تعديل هذا النص: لم يُعثر عليه في المستند.',
  pdfTextOverflow: 'سيتداخل النص المعدّل مع النص الموجود أسفله. يُرجى تقصيره.',
} as const satisfies Record<keyof typeof zh, string>
