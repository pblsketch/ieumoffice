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
  homeRunWelcomeTitle: 'स्वागत है',
  homeRunWelcomeBody:
    'GenOffice से HWP, PDF, Markdown और दूसरे दस्तावेज़ खोलें और संपादित करें। न खाता, न विज्ञापन, और आपके दस्तावेज़ इसी डिवाइस पर रहते हैं।',
  homeRunStart: 'शुरू करें',
  homeRunTipEditButton: 'बदलाव करने के लिए [संपादित करें] पर टैप करें',
  homeRunTipFlowView: 'स्क्रीन के हिसाब से पढ़ने के लिए [पठन दृश्य] पर टैप करें',
  homeRunTipFirstEdit:
    'रिकवरी कॉपी अपने आप बनती है। मूल फ़ाइल तब सहेजी जाती है जब आप [पूर्ण] पर टैप करते हैं',
  homeRunTipFirstKeyboard: '[Aa] से टेक्स्ट का फ़ॉर्मैट बदलें',
} as const satisfies Record<keyof typeof zh, string>
