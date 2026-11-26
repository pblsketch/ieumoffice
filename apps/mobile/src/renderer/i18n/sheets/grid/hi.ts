import type { zh } from './zh'

export const hi = {
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
