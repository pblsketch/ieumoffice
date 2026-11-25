import type { zh } from './zh'

export const hi = {
  pdfFormAddCheck: 'सही का निशान लगाएँ',
  pdfFormAddCross: 'X का निशान लगाएँ',
  pdfFormPlaceCheck: 'सही का निशान रखने के लिए पृष्ठ पर टैप करें',
  pdfFormPlaceCross: 'X का निशान रखने के लिए पृष्ठ पर टैप करें',
  pdfFormCheckMark: 'सही का निशान',
  pdfFormCrossMark: 'X का निशान',
  pdfFormDeleteMark: 'निशान हटाएँ',
  pdfFormDone: 'हो गया',
  pdfFormSignField: 'हस्ताक्षर के लिए टैप करें',
  pdfFormDateInvalid: 'तारीख {format} प्रारूप में लिखें',
  pdfFormDatePick: 'तारीख चुनें',
} as const satisfies Record<keyof typeof zh, string>
