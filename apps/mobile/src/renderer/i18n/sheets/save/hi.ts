import type { zh } from './zh'

export const hi = {
  sheetsShareFailed: 'यह फ़ाइल साझा नहीं की जा सकी।',
  sheetsSaveFailed: 'सहेजा नहीं जा सका। मूल फ़ाइल नहीं बदली।',
  sheetsSaveNotYet: 'यह वर्कबुक अभी फ़ोन पर सहेजी नहीं जा सकती।',
} as const satisfies Record<keyof typeof zh, string>
