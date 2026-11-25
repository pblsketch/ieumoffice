import { createI18n, defineStrings } from '@genoffice/i18n'
import { ar } from './ar'
import { cs } from './cs'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { he } from './he'
import { hi } from './hi'
import { id } from './id'
import { it } from './it'
import { ja } from './ja'
import { ko } from './ko'
import { ms } from './ms'
import { nl } from './nl'
import { pl } from './pl'
import { pt } from './pt'
import { ru } from './ru'
import { th } from './th'
import { tr } from './tr'
import { vi } from './vi'
import { zh } from './zh'
import { zhTW } from './zh-TW'
import { aiStrings } from './ai'
import { homeStrings } from './home'
import { pdfStrings } from './pdf'
import { pdfToolsStrings } from './pdfTools'
import { readersStrings } from './readers'
import { sheetsStrings } from './sheets'
import { webStrings } from './web'

// Each language is the base dictionary followed by the per-track bundles
// (see the index.ts of each bundle folder for its owner and key prefix).
export const MOBILE_DICTS = defineStrings({
  zh: {
    ...zh,
    ...sheetsStrings.zh,
    ...pdfStrings.zh,
    ...pdfToolsStrings.zh,
    ...webStrings.zh,
    ...readersStrings.zh,
    ...homeStrings.zh,
    ...aiStrings.zh,
  },
  en: {
    ...en,
    ...sheetsStrings.en,
    ...pdfStrings.en,
    ...pdfToolsStrings.en,
    ...webStrings.en,
    ...readersStrings.en,
    ...homeStrings.en,
    ...aiStrings.en,
  },
  ja: {
    ...ja,
    ...sheetsStrings.ja,
    ...pdfStrings.ja,
    ...pdfToolsStrings.ja,
    ...webStrings.ja,
    ...readersStrings.ja,
    ...homeStrings.ja,
    ...aiStrings.ja,
  },
  ko: {
    ...ko,
    ...sheetsStrings.ko,
    ...pdfStrings.ko,
    ...pdfToolsStrings.ko,
    ...webStrings.ko,
    ...readersStrings.ko,
    ...homeStrings.ko,
    ...aiStrings.ko,
  },
  fr: {
    ...fr,
    ...sheetsStrings.fr,
    ...pdfStrings.fr,
    ...pdfToolsStrings.fr,
    ...webStrings.fr,
    ...readersStrings.fr,
    ...homeStrings.fr,
    ...aiStrings.fr,
  },
  de: {
    ...de,
    ...sheetsStrings.de,
    ...pdfStrings.de,
    ...pdfToolsStrings.de,
    ...webStrings.de,
    ...readersStrings.de,
    ...homeStrings.de,
    ...aiStrings.de,
  },
  es: {
    ...es,
    ...sheetsStrings.es,
    ...pdfStrings.es,
    ...pdfToolsStrings.es,
    ...webStrings.es,
    ...readersStrings.es,
    ...homeStrings.es,
    ...aiStrings.es,
  },
  th: {
    ...th,
    ...sheetsStrings.th,
    ...pdfStrings.th,
    ...pdfToolsStrings.th,
    ...webStrings.th,
    ...readersStrings.th,
    ...homeStrings.th,
    ...aiStrings.th,
  },
  id: {
    ...id,
    ...sheetsStrings.id,
    ...pdfStrings.id,
    ...pdfToolsStrings.id,
    ...webStrings.id,
    ...readersStrings.id,
    ...homeStrings.id,
    ...aiStrings.id,
  },
  ru: {
    ...ru,
    ...sheetsStrings.ru,
    ...pdfStrings.ru,
    ...pdfToolsStrings.ru,
    ...webStrings.ru,
    ...readersStrings.ru,
    ...homeStrings.ru,
    ...aiStrings.ru,
  },
  ar: {
    ...ar,
    ...sheetsStrings.ar,
    ...pdfStrings.ar,
    ...pdfToolsStrings.ar,
    ...webStrings.ar,
    ...readersStrings.ar,
    ...homeStrings.ar,
    ...aiStrings.ar,
  },
  pt: {
    ...pt,
    ...sheetsStrings.pt,
    ...pdfStrings.pt,
    ...pdfToolsStrings.pt,
    ...webStrings.pt,
    ...readersStrings.pt,
    ...homeStrings.pt,
    ...aiStrings.pt,
  },
  it: {
    ...it,
    ...sheetsStrings.it,
    ...pdfStrings.it,
    ...pdfToolsStrings.it,
    ...webStrings.it,
    ...readersStrings.it,
    ...homeStrings.it,
    ...aiStrings.it,
  },
  pl: {
    ...pl,
    ...sheetsStrings.pl,
    ...pdfStrings.pl,
    ...pdfToolsStrings.pl,
    ...webStrings.pl,
    ...readersStrings.pl,
    ...homeStrings.pl,
    ...aiStrings.pl,
  },
  cs: {
    ...cs,
    ...sheetsStrings.cs,
    ...pdfStrings.cs,
    ...pdfToolsStrings.cs,
    ...webStrings.cs,
    ...readersStrings.cs,
    ...homeStrings.cs,
    ...aiStrings.cs,
  },
  nl: {
    ...nl,
    ...sheetsStrings.nl,
    ...pdfStrings.nl,
    ...pdfToolsStrings.nl,
    ...webStrings.nl,
    ...readersStrings.nl,
    ...homeStrings.nl,
    ...aiStrings.nl,
  },
  ms: {
    ...ms,
    ...sheetsStrings.ms,
    ...pdfStrings.ms,
    ...pdfToolsStrings.ms,
    ...webStrings.ms,
    ...readersStrings.ms,
    ...homeStrings.ms,
    ...aiStrings.ms,
  },
  he: {
    ...he,
    ...sheetsStrings.he,
    ...pdfStrings.he,
    ...pdfToolsStrings.he,
    ...webStrings.he,
    ...readersStrings.he,
    ...homeStrings.he,
    ...aiStrings.he,
  },
  hi: {
    ...hi,
    ...sheetsStrings.hi,
    ...pdfStrings.hi,
    ...pdfToolsStrings.hi,
    ...webStrings.hi,
    ...readersStrings.hi,
    ...homeStrings.hi,
    ...aiStrings.hi,
  },
  'zh-TW': {
    ...zhTW,
    ...sheetsStrings['zh-TW'],
    ...pdfStrings['zh-TW'],
    ...pdfToolsStrings['zh-TW'],
    ...webStrings['zh-TW'],
    ...readersStrings['zh-TW'],
    ...homeStrings['zh-TW'],
    ...aiStrings['zh-TW'],
  },
  vi: {
    ...vi,
    ...sheetsStrings.vi,
    ...pdfStrings.vi,
    ...pdfToolsStrings.vi,
    ...webStrings.vi,
    ...readersStrings.vi,
    ...homeStrings.vi,
    ...aiStrings.vi,
  },
  tr: {
    ...tr,
    ...sheetsStrings.tr,
    ...pdfStrings.tr,
    ...pdfToolsStrings.tr,
    ...webStrings.tr,
    ...readersStrings.tr,
    ...homeStrings.tr,
    ...aiStrings.tr,
  },
})

export type MobileStringKey = keyof typeof MOBILE_DICTS.zh

export const translateMobile = createI18n(MOBILE_DICTS)
