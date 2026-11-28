import type { zh } from './zh'

export const hi = {
  sheetsToolbarFormat: 'सेल फ़ॉर्मेट',
  sheetsToolbarRows: 'पंक्तियाँ और कॉलम',
  sheetsToolbarSort: 'सॉर्ट और फ़िल्टर',
  sheetsToolbarInsert: 'डालें',
  sheetsToolbarInsertValues: 'तारीख और शीट',
  sheetsToolbarToday: 'आज की तारीख',
  sheetsToolbarTimeNow: 'अभी का समय',
  sheetsToolbarNewSheet: 'नई शीट',
  sheetsToolbarFind: 'खोजें',
  sheetsToolbarViewOnly:
    'चार्ट, पिवट टेबल और सशर्त फ़ॉर्मेटिंग यहाँ केवल देखी जा सकती हैं। इन्हें बदलने के लिए फ़ाइल कंप्यूटर पर खोलें।',
  sheetsToolbarFullLoaded: 'पूरी वर्कबुक लोड हो गई है। सॉर्ट या फ़िल्टर फिर से टैप करें।',
} as const satisfies Record<keyof typeof zh, string>
