import type { zh } from './zh'

export const hi = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'WebDAV सर्वर (जैसे Nextcloud या Synology NAS) जोड़ें ताकि उसकी फ़ाइलें यहीं खोली जा सकें। सहेजने पर बदलाव सर्वर पर वापस चले जाते हैं।',
  webdavNoServers: 'अभी कोई सर्वर जुड़ा नहीं है।',
  webdavAdd: 'सर्वर जोड़ें',
  webdavFieldName: 'नाम',
  webdavFieldUrl: 'सर्वर का पता',
  webdavFieldUser: 'उपयोगकर्ता नाम',
  webdavFieldPassword: 'पासवर्ड या ऐप पासवर्ड',
  webdavUserHint: 'अगर सर्वर को साइन-इन नहीं चाहिए तो उपयोगकर्ता नाम खाली छोड़ें।',
  webdavInsecureWarn:
    'यह बिना एन्क्रिप्शन वाला HTTP कनेक्शन है। पासवर्ड और फ़ाइलें नेटवर्क पर पढ़ने योग्य रूप में जाती हैं।',
  webdavInsecureConfirm: 'मैं जोखिम समझता/समझती हूँ और HTTP इस्तेमाल करना चाहता/चाहती हूँ',
  webdavSave: 'जोड़ें',
  webdavCancel: 'रद्द करें',
  webdavChecking: 'कनेक्शन जाँचा जा रहा है…',
  webdavRemove: 'सर्वर हटाएँ',
  webdavRemoveConfirm: 'इस PC से इस सर्वर का कनेक्शन हटाएँ? सर्वर पर मौजूद फ़ाइलें नहीं हटेंगी।',
  webdavRemoveYes: 'हटाएँ',
  webdavNeedPassword: 'यह PC पासवर्ड को एन्क्रिप्ट करके नहीं रख सका। उसे फिर से दर्ज करें।',
  webdavNotPersisted:
    'यह PC पासवर्ड को एन्क्रिप्ट करके नहीं रख सकता, इसलिए ऐप बंद होने के बाद उसे फिर दर्ज करना होगा।',
  webdavPrivacy:
    'पासवर्ड केवल इसी PC पर रहता है, सिस्टम द्वारा एन्क्रिप्टेड। फ़ाइलें केवल खोलने या सहेजने पर इस PC और आपके दिए सर्वर के बीच आती-जाती हैं।',
  webdavEmptyTitle: 'कोई WebDAV सर्वर जुड़ा नहीं है',
  webdavEmptyBody:
    'सेटिंग → इंटीग्रेशन में सर्वर जोड़ें, फिर यहाँ उसकी फ़ाइलें ब्राउज़ करें और खोलें।',
  webdavOpenSettings: 'सेटिंग खोलें',
  webdavRoot: 'रूट',
  webdavFolderEmpty: 'यह फ़ोल्डर खाली है।',
  webdavLoading: 'लोड हो रहा है…',
  webdavRefresh: 'ताज़ा करें',
  webdavUnsupported: 'ऐप इस फ़ॉर्मैट को नहीं खोल सकता',
  webdavOpening: 'खुल रहा है…',
  webdavServer: 'सर्वर',
  webdavErrUrl: 'पता मान्य नहीं है। https:// या http:// से शुरू होने वाला पूरा पता दर्ज करें।',
  webdavErrInsecure: 'बिना एन्क्रिप्शन वाला HTTP कनेक्शन इस्तेमाल करने से पहले पुष्टि पर टिक करें।',
  webdavErrAuth:
    'सर्वर ने साइन-इन अस्वीकार कर दिया। उपयोगकर्ता नाम और पासवर्ड जाँचें (कई सेवाओं में ऐप पासवर्ड चाहिए होता है)।',
  webdavErrNotFound: 'वह फ़ोल्डर या फ़ाइल सर्वर पर नहीं है।',
  webdavErrForbidden: 'इस खाते को यह करने की अनुमति नहीं है।',
  webdavErrNetwork: 'सर्वर तक नहीं पहुँचा जा सका। पता और नेटवर्क जाँचें।',
  webdavErrLimit: 'अधिकतम 10 सर्वर जोड़े जा सकते हैं।',
  webdavErrTooLarge: 'फ़ाइल खोलने के लिए बहुत बड़ी है।',
  webdavErrRateLimit: 'सर्वर ने बाद में फिर कोशिश करने को कहा है।',
  webdavErrLocked: 'किसी और ने यह फ़ाइल लॉक कर रखी है।',
  webdavErrDisk: 'फ़ाइल इस PC पर सहेजी नहीं जा सकी।',
} satisfies Record<keyof typeof zh, string>
