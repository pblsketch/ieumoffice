import type { zh } from './zh'

export const hi = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'ग्रिड लोड हो रहा है…',
  sheetsOpening: 'वर्कबुक खुल रही है… बड़ी फ़ाइलों में थोड़ा समय लगता है।',
  sheetsPasswordTitle: 'पासवर्ड से सुरक्षित वर्कबुक',
  sheetsPasswordMessage: 'इस वर्कबुक को खोलने के लिए पासवर्ड डालें।',
  sheetsPasswordLabel: 'पासवर्ड',
  sheetsPasswordWrong: 'पासवर्ड सही नहीं है। फिर से कोशिश करें।',
  sheetsPasswordOpen: 'खोलें',
  sheetsPasswordCancel: 'रद्द करें',
  sheetsEncryptionUnsupported: 'इस तरह की पासवर्ड सुरक्षा वाली फ़ाइल नहीं खुल सकती।',
  sheetsEncryptionDamaged: 'यह सुरक्षित वर्कबुक खराब है और खुल नहीं सकती।',
  sheetsNoticeMacros: 'मैक्रो बने रहते हैं, पर चलाए नहीं जाते।',
  sheetsNoticeExternalLinks: 'दूसरी फ़ाइलों से जुड़े सेल आख़िरी सहेजे गए मान दिखाते हैं।',
  sheetsNoticeMacrosAndLinks:
    'मैक्रो बने रहते हैं, पर चलाए नहीं जाते। दूसरी फ़ाइलों से जुड़े सेल आख़िरी सहेजे गए मान दिखाते हैं।',
} as const satisfies Record<keyof typeof zh, string>
