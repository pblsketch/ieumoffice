import type { zh } from './zh'

export const hi = {
  sheetsProvisionalNotice: 'परीक्षण ग्रिड: आपके बदलाव अभी सहेजे नहीं जाते।',
  sheetsLoading: 'ग्रिड लोड हो रहा है…',
  sheetsShareFailed: 'यह फ़ाइल साझा नहीं की जा सकी।',
  sheetsFreezeTopRow: 'ऊपरी पंक्ति स्थिर करें',
  sheetsFreezeFirstColumn: 'पहला कॉलम स्थिर करें',
  sheetsUnfreeze: 'पैन अस्थिर करें',
  sheetsKeyboardBar: 'सूत्र इनपुट उपकरण',
  sheetsInsertSum: 'योग फ़ंक्शन',
  sheetsInsertParens: 'कोष्ठक',
  sheetsNumericKeys: 'संख्या कीबोर्ड',
  sheetsCancelEdit: 'रद्द करें',
  sheetsConfirmEdit: 'हो गया',
} as const satisfies Record<keyof typeof zh, string>
