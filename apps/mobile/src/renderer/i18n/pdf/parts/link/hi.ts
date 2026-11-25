import type { zh } from './zh'

export const hi = {
  pdfLinkPlaceHint: 'पृष्ठ पर वहाँ एक बॉक्स खींचें जहाँ लिंक जाएगा',
  pdfLinkEditTitle: 'लिंक संपादित करें',
  pdfLinkUrlLabel: 'वेब पता (http, https, mailto)',
  pdfLinkPageLabel: 'या इस दस्तावेज़ का कोई पृष्ठ (1–{count})',
  pdfLinkUrlInvalid: 'केवल http, https और mailto पते लिंक किए जा सकते हैं',
  pdfLinkPageInvalid: '1 से {count} तक की पृष्ठ संख्या दर्ज करें',
  pdfLinkNeedTarget: 'वेब पता या पृष्ठ संख्या दर्ज करें',
  pdfLinkApply: 'लिंक जोड़ें',
  pdfLinkDelete: 'लिंक हटाएँ',
  pdfLinkPending: 'जोड़ा जाने वाला लिंक: {target}',
  pdfLinkToPage: 'पृष्ठ {page}',
  pdfLinkFailed: 'लिंक बदला नहीं जा सका। सहेजना पूरा होने के बाद फिर से कोशिश करें।',
  pdfLinkUpdate: 'लागू करें',
} as const satisfies Record<keyof typeof zh, string>
