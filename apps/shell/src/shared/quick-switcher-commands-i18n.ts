import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/** 22-language command titles for the Global Quick Switcher (usable in shell main & renderer). */
export const QUICK_SWITCHER_COMMAND_STRINGS = defineStrings({
  zh: { cmdSettings: '设置', cmdAiSettings: 'AI 设置' },
  en: { cmdSettings: 'Settings', cmdAiSettings: 'AI Settings' },
  ja: { cmdSettings: '設定', cmdAiSettings: 'AI 設定' },
  ko: { cmdSettings: '설정', cmdAiSettings: 'AI 설정' },
  fr: { cmdSettings: 'Paramètres', cmdAiSettings: 'Paramètres IA' },
  de: { cmdSettings: 'Einstellungen', cmdAiSettings: 'KI-Einstellungen' },
  es: { cmdSettings: 'Configuración', cmdAiSettings: 'Configuración de IA' },
  th: { cmdSettings: 'การตั้งค่า', cmdAiSettings: 'การตั้งค่า AI' },
  id: { cmdSettings: 'Pengaturan', cmdAiSettings: 'Pengaturan AI' },
  ru: { cmdSettings: 'Настройки', cmdAiSettings: 'Настройки ИИ' },
  ar: { cmdSettings: 'الإعدادات', cmdAiSettings: 'إعدادات الذكاء الاصطناعي' },
  pt: { cmdSettings: 'Configurações', cmdAiSettings: 'Configurações de IA' },
  it: { cmdSettings: 'Impostazioni', cmdAiSettings: 'Impostazioni IA' },
  pl: { cmdSettings: 'Ustawienia', cmdAiSettings: 'Ustawienia AI' },
  cs: { cmdSettings: 'Nastavení', cmdAiSettings: 'Nastavení AI' },
  nl: { cmdSettings: 'Instellingen', cmdAiSettings: 'AI-instellingen' },
  ms: { cmdSettings: 'Tetapan', cmdAiSettings: 'Tetapan AI' },
  he: { cmdSettings: 'הגדרות', cmdAiSettings: 'הגדרות בינה מלאכותית' },
  hi: { cmdSettings: 'सेटिंग्स', cmdAiSettings: 'AI सेटिंग्स' },
  'zh-TW': { cmdSettings: '設定', cmdAiSettings: 'AI 設定' },
  vi: { cmdSettings: 'Cài đặt', cmdAiSettings: 'Cài đặt AI' },
  tr: { cmdSettings: 'Ayarlar', cmdAiSettings: 'Yapay Zeka Ayarları' },
})

export type QuickSwitcherCommandStringKey = keyof typeof QUICK_SWITCHER_COMMAND_STRINGS.zh

export const quickSwitcherCommandText: (
  lang: Lang,
  key: QuickSwitcherCommandStringKey,
  params?: Params,
) => string = createI18n(QUICK_SWITCHER_COMMAND_STRINGS)
