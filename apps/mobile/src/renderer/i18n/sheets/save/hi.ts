import type { zh } from './zh'

export const hi = {
  sheetsShareFailed: 'यह फ़ाइल साझा नहीं की जा सकी।',
  sheetsSaveFailed: 'सहेजा नहीं जा सका। मूल फ़ाइल नहीं बदली।',
  sheetsSaveAsTitle: 'इस रूप में सहेजें',
  sheetsShareTitle: 'इस रूप में साझा करें',
  sheetsFormatWorkbook: 'Excel वर्कबुक (.xlsx)',
  sheetsFormatWorkbookMacro: 'मैक्रो-सक्षम Excel वर्कबुक (.xlsm)',
  sheetsFormatCsv: 'CSV (केवल वर्तमान शीट)',
  sheetsFormatOds: 'ODS स्प्रेडशीट (वर्कबुक की प्रति)',
  sheetsFormatPdf: 'PDF (वर्तमान शीट)',
  sheetsOdsEncrypted: 'पासवर्ड वाली वर्कबुक को ODS में निर्यात नहीं किया जा सकता।',
  sheetsChoiceCancel: 'रद्द करें',
  sheetsCsvAskTitle: 'CSV फ़ाइल सहेजें',
  sheetsCsvAskMessage: 'CSV फ़ाइल में केवल वर्तमान शीट के मान रहते हैं।',
  sheetsCsvAskCsv: 'CSV के रूप में सहेजें (फ़ॉर्मैटिंग और अन्य शीट शामिल नहीं)',
  sheetsCsvAskXlsx: 'Excel फ़ाइल के रूप में सहेजें',
  sheetsCsvFormulaTitle: 'सूत्रों के केवल मान रहेंगे',
  sheetsCsvFormulaMessage:
    'इस शीट के सूत्र CSV में केवल गणना किए गए मान के रूप में रहेंगे। सूत्र रखने के लिए Excel फ़ाइल के रूप में सहेजें।',
  sheetsCsvContinue: 'CSV के रूप में जारी रखें',
  sheetsOdsLossTitle: 'ODS में निर्यात करें',
  sheetsOdsLossMessage:
    'ODS में न आ सकने वाली {count} सुविधाएँ (सूत्र, चार्ट, चित्र, सशर्त फ़ॉर्मैटिंग आदि) प्रति में शामिल नहीं होंगी।',
  sheetsOdsContinue: 'जारी रखें',
  sheetsOdsUnreadable: 'बनी ODS फ़ाइल फिर से नहीं खुली, इसलिए उसे लिखा नहीं गया।',
  sheetsOdsFailed: 'ODS में निर्यात नहीं हो सका।',
  sheetsCopySaved: 'प्रति सहेजी गई: {name}',
  sheetsPdfWorking: 'PDF बन रहा है…',
  sheetsPdfFailed: 'PDF नहीं बन सका।',
  sheetsPdfSkippedVisuals: '{count} चित्र या चार्ट PDF में नहीं डाले जा सके।',
  sheetsPdfMissingGlyphs:
    'फ़ॉन्ट में न मौजूद {count} अक्षर PDF में खाली खानों के रूप में दिखते हैं।',
  sheetsSaveErrDiskChanged:
    'खोलने के बाद किसी दूसरे ऐप ने मूल फ़ाइल बदल दी। उसे अधिलेखित नहीं किया गया; इस रूप में सहेजें का उपयोग करें।',
  sheetsSaveErrTooLarge:
    'फ़ाइल इस फ़ोन पर लिखने के लिए बहुत बड़ी है (लगभग 14 MB से अधिक)। मूल फ़ाइल नहीं बदली।',
  sheetsSaveErrUnreadable:
    'सहेजी गई वर्कबुक फिर से नहीं खुली, इसलिए मूल फ़ाइल जैसी थी वैसी ही रखी गई।',
  sheetsSaveErrLockFailed:
    'वर्कबुक को उसके पासवर्ड से फिर से लॉक नहीं किया जा सका, इसलिए मूल फ़ाइल जैसी थी वैसी ही रखी गई।',
  sheetsSaveBusy: 'सहेजा जा रहा है। पूरा होने के बाद फिर से कोशिश करें।',
} as const satisfies Record<keyof typeof zh, string>
