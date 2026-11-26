import type { zh } from './zh'

export const hi = {
  homeSetEditorsTitle: 'एडिटर',
  homeSetEditorsHint:
    'बंद किए गए एडिटर नए दस्तावेज़ की सूची में नहीं दिखते। सभी बंद करने पर सभी चालू माने जाते हैं।',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF टूल',
  homeSetCardsTitle: 'होम स्क्रीन पर नए दस्तावेज़',
  homeSetCardShow: 'होम स्क्रीन पर {name} दिखाएँ',
  homeSetCardUp: '{name} ऊपर ले जाएँ',
  homeSetCardDown: '{name} नीचे ले जाएँ',
  homeSetKeepScreenOn: 'पढ़ते समय स्क्रीन चालू रखें',
  homeSetKeepScreenOnDesc: 'PDF या EPUB पढ़ते समय या PPT प्रस्तुत करते समय स्क्रीन बंद नहीं होती।',
  homeSetFoldersTitle: 'दस्तावेज़ फ़ोल्डर',
  homeSetFoldersEmpty:
    'अभी कोई फ़ोल्डर जुड़ा नहीं है। फ़ोल्डर जोड़ने पर उसकी फ़ाइलें फ़ोल्डर टैब में सीधे दिखेंगी।',
  homeSetFolderLink: 'फ़ोल्डर जोड़ें',
  homeSetFolderRelink: 'फिर से जोड़ें',
  homeSetFolderRemove: 'हटाएँ',
  homeSetFolderRemoveNamed: '{name} हटाएँ',
  homeSetFolderOk: 'जुड़ा हुआ',
  homeSetFolderLost:
    'इस फ़ोल्डर तक पहुँच नहीं हो पा रही। अगर आपने इसे हटाया या कहीं और ले गए हैं, तो फिर से जोड़ें।',
  homeSetFolderRemoveTitle: '"{name}" फ़ोल्डर हटाएँ?',
  homeSetFolderRemoveBody:
    'इस फ़ोल्डर की फ़ाइलों की हाल की और पसंदीदा सूची की {count} प्रविष्टियाँ भी हट जाएँगी। फ़ाइलें खुद नहीं हटेंगी।',
  homeSetBackupsTotal: 'कुल {size}',
  homeSetStorageTitle: 'स्टोरेज',
  homeSetStorageRecovery: 'रिकवरी कॉपी',
  homeSetStorageTemp: 'अस्थायी फ़ाइलें',
  homeSetStorageBackups: 'HWP मूल बैकअप',
  homeSetStorageClearTemp: 'अस्थायी फ़ाइलें मिटाएँ',
  homeSetStorageClearRecovery: 'सभी रिकवरी कॉपी मिटाएँ',
  homeSetStorageClearTempTitle: 'अस्थायी फ़ाइलें मिटाएँ?',
  homeSetStorageClearTempBody:
    'शेयर करते या पाते समय थोड़ी देर के लिए बनी फ़ाइलें मिट जाएँगी। आपके दस्तावेज़ वैसे ही रहेंगे।',
  homeSetStorageClearRecoveryTitle: 'सभी रिकवरी कॉपी मिटाएँ?',
  homeSetStorageClearRecoveryBody:
    'बिना सहेजे बदलाव खो जाएँगे। अभी खुले दस्तावेज़ की रिकवरी कॉपी रखी जाएगी।',
  homeSetStorageClearAction: 'मिटाएँ',
  homeSetStorageCleared: '{size} जगह खाली हुई।',
  homeSetFailed: 'यह नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।',
} as const satisfies Record<keyof typeof zh, string>
