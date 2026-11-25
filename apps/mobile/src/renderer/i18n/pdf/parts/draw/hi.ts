import type { zh } from './zh'

export const hi = {
  pdfDrawSettings: 'पेन सेटिंग',
  pdfDrawTool: 'टूल',
  pdfDrawPen: 'पेन',
  pdfDrawRect: 'आयत',
  pdfDrawEllipse: 'दीर्घवृत्त',
  pdfDrawLine: 'रेखा',
  pdfDrawArrow: 'तीर',
  pdfDrawEraser: 'रबर',
  pdfDrawColor: 'रंग',
  pdfDrawColorRed: 'लाल',
  pdfDrawColorYellow: 'पीला',
  pdfDrawColorGreen: 'हरा',
  pdfDrawColorBlue: 'नीला',
  pdfDrawColorBlack: 'काला',
  pdfDrawWidth: 'मोटाई',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'उँगली से भी बनाएँ',
  pdfDrawFingerHint:
    'चालू होने पर पेन इस्तेमाल करने के बाद भी उँगली से बनता है। बंद होने पर पेन इस्तेमाल करने के बाद उँगली पेज को खिसकाती है।',
  pdfDrawEraserHint: 'रबर केवल वे रेखाएँ और आकृतियाँ मिटाता है जो अभी सहेजी नहीं गई हैं।',
  pdfDrawRefused: 'अभी नहीं बना सकते। थोड़ी देर बाद फिर से कोशिश करें।',
} as const satisfies Record<keyof typeof zh, string>
