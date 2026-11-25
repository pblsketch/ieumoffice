import type { zh } from './zh'

export const hi = {
  pdfEditPen: 'पेन',
  pdfEditHighlighter: 'हाइलाइटर',
  pdfEditTextBox: 'टेक्स्ट बॉक्स',
  pdfEditSign: 'हस्ताक्षर',
  pdfEditPages: 'पेज व्यवस्थित करें',
  pdfEditLink: 'लिंक डालें',
  pdfEditSaveFailed: 'सहेजा नहीं जा सका। आपके बदलाव बने हुए हैं और फ़ाइल नहीं बदली।',
  pdfEditSaveSkipped: 'पेज {pages} पर कुछ टेक्स्ट संपादन सहेजे नहीं जा सके।',
  pdfEditShareFailed: 'साझा नहीं किया जा सका।',
  pdfEditReloadFailed: 'सहेजा गया, लेकिन दस्तावेज़ फिर से लोड नहीं हो सका। फ़ाइल फिर से खोलें।',
  pdfEditSignatureUnavailable: 'हस्ताक्षर अभी उपलब्ध नहीं है।',
  pdfEditSaveAsHint:
    'चुनें कि प्रति में हाइलाइट, नोट और चित्र कैसे रखे जाएँ। “पेजों में जोड़ें” फ़ॉर्म फ़ील्ड भी जोड़ता है; “एनोटेशन छोड़ दें” लिंक और फ़ॉर्म फ़ील्ड रखता है।',
  pdfEditKeepAnnots: 'एनोटेशन रखें (दूसरे ऐप में संपादन योग्य)',
  pdfEditFlattenAnnots: 'पेजों में जोड़ें (हर ऐप में दिखे)',
  pdfEditStripAnnots: 'एनोटेशन छोड़ दें (लिंक और फ़ील्ड रहें)',
  pdfEditSaveVerifyFailed:
    'पृष्ठ {pages} के बदलाव पूरी तरह लिखे नहीं जा सके; सहेजना रद्द कर दिया गया और फ़ाइल अपरिवर्तित रही। प्रभावित संपादन को पूर्ववत करें और फिर से प्रयास करें',
} as const satisfies Record<keyof typeof zh, string>
