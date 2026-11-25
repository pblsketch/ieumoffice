import type { zh } from './zh'

export const hi = {
  homeFolderListLabel: 'जोड़े गए फ़ोल्डर',
  homeFolderEmptyTitle: 'अभी कोई फ़ोल्डर नहीं जोड़ा गया',
  homeFolderEmptyBody:
    'अक्सर इस्तेमाल होने वाला फ़ोल्डर जोड़ें, उसके दस्तावेज़ और तस्वीरें यहीं दिखेंगी।',
  homeFolderLink: 'फ़ोल्डर जोड़ें',
  homeFolderRelink: 'फिर से जोड़ें',
  homeFolderRelinkNamed: '{name} फिर से जोड़ें',
  homeFolderOk: 'जुड़ा हुआ',
  homeFolderLostRevoked: 'इस फ़ोल्डर की अनुमति खत्म हो गई है। इसे फिर से जोड़ें।',
  homeFolderLostMissing:
    'यह फ़ोल्डर नहीं मिला। अगर आपने इसे हटाया या कहीं और ले गए हैं, तो फिर से जोड़ें।',
  homeFolderLost: 'फ़ोल्डर तक पहुँच नहीं हो पा रही। फ़ोल्डर फिर से जोड़ें।',
  homeFolderMenu: '{name} का मेनू',
  homeFolderRemove: 'हटाएँ',
  homeFolderRemoveTitle: '"{name}" फ़ोल्डर हटाएँ?',
  homeFolderRemoveBody:
    'इस फ़ोल्डर की फ़ाइलों की हाल की और पसंदीदा सूची की {count} प्रविष्टियाँ भी हट जाएँगी। फ़ाइलें खुद नहीं हटेंगी।',
  homeFolderRemoved: 'फ़ोल्डर हटा दिया गया।',
  homeFolderBack: 'ऊपर वाला फ़ोल्डर',
  homeFolderPath: 'मौजूदा फ़ोल्डर',
  homeFolderSubfolder: 'फ़ोल्डर',
  homeFolderInsideEmpty: 'इस फ़ोल्डर में खोलने लायक कोई दस्तावेज़ या तस्वीर नहीं है।',
} as const satisfies Record<keyof typeof zh, string>
