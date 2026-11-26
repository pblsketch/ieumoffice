import type { zh } from './zh'

export const he = {
  pdfFormAddCheck: 'הוספת סימן וי',
  pdfFormAddCross: 'הוספת סימן X',
  pdfFormPlaceCheck: 'הקישו על העמוד כדי למקם סימן וי',
  pdfFormPlaceCross: 'הקישו על העמוד כדי למקם סימן X',
  pdfFormCheckMark: 'סימן וי',
  pdfFormCrossMark: 'סימן X',
  pdfFormDeleteMark: 'מחיקת הסימן',
  pdfFormDone: 'סיום',
  pdfFormSignField: 'הקישו כדי לחתום',
  pdfFormDateInvalid: 'הזינו תאריך בתבנית {format}',
  pdfFormDatePick: 'בחירת תאריך',
} as const satisfies Record<keyof typeof zh, string>
