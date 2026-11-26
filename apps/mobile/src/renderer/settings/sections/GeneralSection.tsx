// Owner: track T6 (general settings: language, theme, new HWP default format, editors, home cards,
// keeping the screen on).
import type { ReactNode } from 'react'
import { LANGS, type Lang } from '@genoffice/i18n'
import type {
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileTheme,
} from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../../i18n'
import { IconChevronDown } from '../../components/MobileIcons'
import { EditorsRows } from './EditorsRows'
import { HomeKindsRows } from './HomeKindsRows'
import { KeepScreenOnRow } from './KeepScreenOnRow'

const LANG_NATIVE_LABELS: Record<Lang, string> = {
  ar: 'العربية',
  cs: 'Čeština',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  he: 'עברית',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  ms: 'Bahasa Melayu',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  th: 'ไทย',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  zh: '简体中文',
  'zh-TW': '繁體中文',
}

export interface GeneralSectionProps {
  readonly prefs: MobileAppPrefs
  readonly onUpdatePrefs: (patch: MobileAppPrefsPatch) => void
  /** Extra rows drawn at the end of the general card (the AI switch, which stays the last row). */
  readonly children?: ReactNode
}

export function GeneralSection({ prefs, onUpdatePrefs, children }: GeneralSectionProps) {
  const { t } = useMobileLocale()
  const themeDisplay =
    prefs.theme === 'light'
      ? t('themeLight')
      : prefs.theme === 'dark'
        ? t('themeDark')
        : t('themeSystem')

  return (
    <section className="mobile-set-card">
      <label className="mobile-set-row">
        <span className="mobile-set-label">{t('settingsLanguage')}</span>
        <span className="mobile-set-select-wrap">
          <span className="mobile-set-select-text">
            {LANG_NATIVE_LABELS[prefs.lang as Lang] ?? prefs.lang}
          </span>
          <IconChevronDown size={15} className="mobile-chevron" />
          <select
            className="mobile-set-select-native"
            value={prefs.lang}
            onChange={(e) => onUpdatePrefs({ lang: e.target.value as Lang })}
            data-testid="settings-lang-select"
          >
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {LANG_NATIVE_LABELS[code] ?? code}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="mobile-set-row">
        <span className="mobile-set-label">{t('settingsTheme')}</span>
        <span className="mobile-set-select-wrap">
          <span className="mobile-set-select-text">{themeDisplay}</span>
          <IconChevronDown size={15} className="mobile-chevron" />
          <select
            className="mobile-set-select-native"
            value={prefs.theme}
            onChange={(e) => onUpdatePrefs({ theme: e.target.value as MobileTheme })}
            data-testid="settings-theme-select"
          >
            <option value="system">{t('themeSystem')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </span>
      </label>

      <label className="mobile-set-row">
        <span className="mobile-set-label">{t('settingsHwpFormat')}</span>
        <span className="mobile-set-select-wrap">
          <span className="mobile-set-select-text">.{prefs.hwpDefaultFormat}</span>
          <IconChevronDown size={15} className="mobile-chevron" />
          <select
            className="mobile-set-select-native"
            value={prefs.hwpDefaultFormat}
            onChange={(e) => onUpdatePrefs({ hwpDefaultFormat: e.target.value as 'hwp' | 'hwpx' })}
            data-testid="settings-hwp-format-select"
          >
            <option value="hwp">.hwp</option>
            <option value="hwpx">.hwpx</option>
          </select>
        </span>
      </label>

      <EditorsRows />
      <HomeKindsRows />
      <KeepScreenOnRow />

      {children}
    </section>
  )
}
