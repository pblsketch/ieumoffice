import type { zh } from './zh'

export const hi = {
  pdfAnnotHighlight: 'हाइलाइट',
  pdfAnnotUnderline: 'रेखांकन',
  pdfAnnotSquiggly: 'लहरदार रेखा',
  pdfAnnotStrikeout: 'स्ट्राइकथ्रू',
  pdfAnnotModeSelect: 'टेक्स्ट चुनें',
  pdfAnnotModeNote: 'नोट रखें',
  pdfAnnotHintSelect:
    'चुनने के लिए टेक्स्ट पर बगल की ओर खींचें, या देर तक दबाकर फिर खींचें। रंग बदलने या हटाने के लिए किसी चिह्न पर टैप करें।',
  pdfAnnotHintNote: 'जहाँ नोट रखना है वहाँ टैप करें।',
  pdfAnnotPen: 'हाइलाइटर {n}',
  pdfAnnotColor: 'रंग {n}',
  pdfAnnotRemove: 'चिह्न हटाएँ',
  pdfAnnotMarkupTitle: 'चिह्न का रंग',
  pdfAnnotClearSelection: 'चयन हटाएँ',
  pdfAnnotNoText: 'इस पेज पर चुनने लायक कोई टेक्स्ट नहीं है।',
  pdfAnnotOpenNote: 'नोट खोलें',
  pdfAnnotFailed: 'एनोटेशन बदला नहीं जा सका।',
  pdfAnnotNewNote: 'नया नोट',
  pdfAnnotReplyPlaceholder: 'जवाब लिखें',
} as const satisfies Record<keyof typeof zh, string>
