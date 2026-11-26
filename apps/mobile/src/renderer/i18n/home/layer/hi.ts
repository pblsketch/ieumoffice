import type { zh } from './zh'

export const hi = {
  homeRunEditorOffTitle: '{name} एडिटर बंद है',
  homeRunEditorOffBody:
    'इस फ़ाइल को खोलने के लिए इसे चालू करें। आप इसे सेटिंग्स में फिर से बंद कर सकते हैं।',
  homeRunEditorOffConfirm: 'चालू करें और खोलें',
  homeRunStripSample: 'नमूना दस्तावेज़ · केवल पढ़ने के लिए',
  homeRunStripReceived: 'प्राप्त फ़ाइल · केवल पढ़ने के लिए',
  homeRunStripReadOnly: 'केवल पढ़ने के लिए',
  homeRunStripCopy: 'प्रति संपादित करें',
  homeRunStripClose: 'सूचना बंद करें',
  homeRunReceiveTitle: 'प्राप्त फ़ाइलें',
  homeRunReceiveCount: '{count} फ़ाइलें',
  homeRunReceiveClose: 'प्राप्त फ़ाइलें बंद करें',
  homeRunReceiveOpen: 'खोलें',
  homeRunReceivePdfOff: 'PDF टूल बंद हैं',
  homeRunReceivePdfOn: 'चालू करें और जारी रखें',
  homeRunGuideLabel: 'शुरुआती गाइड',
  homeRunStep: 'चरण {current} / {total}',
  homeRunWelcomeTitle: 'स्वागत है',
  homeRunWelcomeBody:
    'GenOffice से HWP, PDF, Markdown और दूसरे दस्तावेज़ खोलें और संपादित करें। न खाता, न विज्ञापन, और आपके दस्तावेज़ इसी डिवाइस पर रहते हैं।',
  homeRunNext: 'आगे',
  homeRunSkip: 'छोड़ें',
  homeRunFolderTitle: 'दस्तावेज़ फ़ोल्डर जोड़ें (वैकल्पिक)',
  homeRunFolderBody:
    'अक्सर इस्तेमाल होने वाला फ़ोल्डर जोड़ें, उसकी फ़ाइलें सीधे [फ़ोल्डर] टैब में दिखेंगी।',
  homeRunFolderPick: 'फ़ोल्डर चुनें',
  homeRunLater: 'बाद में',
  homeRunFolderLinked: '✓ दस्तावेज़ फ़ोल्डर जुड़ गया · सेटिंग्स में बदलें',
  homeRunStart: 'शुरू करें',
  homeRunTipEditButton: 'बदलाव करने के लिए [संपादित करें] पर टैप करें',
  homeRunTipFlowView: 'आसानी से पढ़ने के लिए फ़्लो दृश्य पर बदल दिया · पृष्ठ दृश्य यहाँ है',
  homeRunTipFirstEdit:
    'रिकवरी कॉपी अपने आप बनती है। मूल फ़ाइल तब सहेजी जाती है जब आप [पूर्ण] पर टैप करते हैं',
  homeRunTipFirstKeyboard: '[Aa] से टेक्स्ट का फ़ॉर्मैट बदलें',
} as const satisfies Record<keyof typeof zh, string>
