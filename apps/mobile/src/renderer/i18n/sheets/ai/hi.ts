import type { zh } from './zh'

export const hi = {
  sheetsAiUndoRefused: 'AI के बदलावों के बाद शीट संपादित हुई, इसलिए उन्हें पूर्ववत नहीं किया गया।',
  sheetsAiUndoPartial: 'AI के कुछ बदलाव पूर्ववत नहीं हो सके। कृपया शीट जाँचें।',
  sheetsAiUndoExpired:
    'AI के बदलाव अब एक बार में पूर्ववत नहीं हो सकते (उसके बाद वर्कबुक सहेजी गई या बहुत बदली गई)। पूर्ववत करें का उपयोग करें।',
} as const satisfies Record<keyof typeof zh, string>
