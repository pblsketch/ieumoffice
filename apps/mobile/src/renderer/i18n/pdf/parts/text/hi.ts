import type { zh } from './zh'

export const hi = {
  pdfTextHint:
    'टेक्स्ट जोड़ने के लिए खाली जगह पर टैप करें, या संपादित करने के लिए टेक्स्ट पर टैप करें।',
  pdfTextInputLabel: 'जोड़ने वाला टेक्स्ट',
  pdfTextEditLabel: 'संपादित करने वाला टेक्स्ट',
  pdfTextStyleBar: 'टेक्स्ट शैली',
  pdfTextBold: 'बोल्ड',
  pdfTextSize: 'टेक्स्ट आकार',
  pdfTextSizeDown: 'टेक्स्ट छोटा करें',
  pdfTextSizeUp: 'टेक्स्ट बड़ा करें',
  pdfTextColor: 'टेक्स्ट रंग',
  pdfTextColorDocument: 'दस्तावेज़ का रंग रखें',
  pdfTextFont: 'फ़ॉन्ट',
  pdfTextFontDocument: 'दस्तावेज़ फ़ॉन्ट',
  pdfTextBack: 'वापस',
  pdfTextDelete: 'हटाएँ',
  pdfTextDone: 'हो गया',
  pdfTextCannotDraw: 'ये वर्ण नहीं जोड़े जा सकते: {chars}',
  pdfTextFontSubstituted: 'ये वर्ण किसी दूसरे फ़ॉन्ट में दिखेंगे: {chars}',
  pdfTextScannedPage: 'इस पेज पर कोई टेक्स्ट नहीं है। आप केवल नया टेक्स्ट जोड़ सकते हैं।',
  pdfTextNoMatch: 'यह टेक्स्ट संपादित नहीं हो सकता: यह दस्तावेज़ में नहीं मिला।',
  pdfTextOverflow: 'संपादित टेक्स्ट नीचे के टेक्स्ट पर चढ़ जाएगा। कृपया इसे छोटा करें।',
} as const satisfies Record<keyof typeof zh, string>
