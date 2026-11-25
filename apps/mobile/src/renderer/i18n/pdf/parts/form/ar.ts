import type { zh } from './zh'

export const ar = {
  pdfFormAddCheck: 'إضافة علامة صح',
  pdfFormAddCross: 'إضافة علامة X',
  pdfFormPlaceCheck: 'اضغط على الصفحة لوضع علامة صح',
  pdfFormPlaceCross: 'اضغط على الصفحة لوضع علامة X',
  pdfFormCheckMark: 'علامة صح',
  pdfFormCrossMark: 'علامة X',
  pdfFormDeleteMark: 'حذف العلامة',
  pdfFormDone: 'تم',
  pdfFormSignField: 'اضغط للتوقيع',
  pdfFormDateInvalid: 'أدخل التاريخ بالتنسيق {format}',
  pdfFormDatePick: 'اختيار تاريخ',
} as const satisfies Record<keyof typeof zh, string>
