import { useState } from 'react'
import { LANGS, type Lang } from '@genoffice/i18n'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import type {
  HwpBackupEntry,
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
  MobileRestoreTarget,
  MobileTheme,
} from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import {
  DocTypeIcon,
  IconBack,
  IconChevronDown,
  IconChevronRight,
  IeumAppIcon,
} from '../components/MobileIcons'

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

const BYOK_PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter (BYOK)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'mistral', label: 'Mistral' },
] as const

export interface SettingsScreenProps {
  readonly prefs: MobileAppPrefs
  readonly aiSettings: MobileAiSettingsSnapshot
  readonly chatgptStatus: MobileChatGptStatus
  readonly backups: readonly HwpBackupEntry[]
  readonly onBack: () => void
  readonly onUpdatePrefs: (patch: MobileAppPrefsPatch) => void
  readonly onSelectProvider: (provider: string) => void
  readonly onValidateAndSaveKey: (params: {
    readonly provider: string
    readonly apiKey: string
    readonly freeOnly?: boolean
  }) => Promise<void>
  readonly onRemoveKey: (provider: string) => Promise<void>
  readonly onChatgptSignIn: (reconsent?: boolean) => Promise<void>
  readonly onChatgptSignOut: () => Promise<void>
  readonly onRestoreBackup: (backupId: string, target: MobileRestoreTarget) => Promise<void>
  readonly onDeleteBackup: (backupId: string) => Promise<void>
}

export function SettingsScreen({
  prefs,
  aiSettings,
  chatgptStatus,
  backups,
  onBack,
  onUpdatePrefs,
  onSelectProvider,
  onValidateAndSaveKey,
  onRemoveKey,
  onChatgptSignIn,
  onChatgptSignOut,
  onRestoreBackup,
  onDeleteBackup,
}: SettingsScreenProps) {
  const { t } = useMobileLocale()
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null)
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)

  const setDraft = (slot: string, value: string) => {
    setKeyDrafts((prev) => ({ ...prev, [slot]: value }))
  }

  const toggleSlot = (slot: string) => {
    setExpandedSlot((prev) => (prev === slot ? null : slot))
  }

  const saveKey = async (slot: string, provider: string, freeOnly?: boolean) => {
    const apiKey = (keyDrafts[slot] ?? '').trim()
    if (!apiKey) return
    setBusyProvider(slot)
    setKeyError(null)
    try {
      await onValidateAndSaveKey({ provider, apiKey, freeOnly })
      setDraft(slot, '')
      setExpandedSlot(null)
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyProvider(null)
    }
  }

  const openRouterConfigured = aiSettings.configuredProviders.openrouter
  const geminiConfigured = aiSettings.configuredProviders.gemini
  const themeDisplay =
    prefs.theme === 'light'
      ? t('themeLight')
      : prefs.theme === 'dark'
        ? t('themeDark')
        : t('themeSystem')

  const renderProviderAccordion = (opts: {
    slot: string
    providerId: string
    label: string
    connected: boolean
    freeOnly?: boolean
  }) => {
    const isExpanded = expandedSlot === opts.slot
    const isSelected = aiSettings.selectedProvider === opts.providerId
    return (
      <div key={opts.slot} className="mobile-accordion-item">
        <button
          type="button"
          className="mobile-accordion-trigger"
          onClick={() => toggleSlot(opts.slot)}
          aria-expanded={isExpanded}
        >
          <span className="mobile-accordion-left">
            <span
              className={opts.connected ? 'mobile-status-dot connected' : 'mobile-status-dot'}
              aria-hidden="true"
            />
            <span className="mobile-accordion-title">{opts.label}</span>
          </span>
          <span className="mobile-accordion-right">
            {opts.connected && (
              <span className={isSelected ? 'mobile-badge mobile-badge-ok' : 'mobile-badge'}>
                {t('settingsKeyConnected')}
              </span>
            )}
            {isExpanded ? (
              <IconChevronDown size={17} className="mobile-chevron" />
            ) : (
              <IconChevronRight size={17} className="mobile-chevron" />
            )}
          </span>
        </button>

        {isExpanded && (
          <div className="mobile-accordion-body">
            {opts.connected ? (
              <div className="mobile-row-actions">
                <button
                  type="button"
                  className="mobile-touch-btn mobile-btn-secondary"
                  onClick={() => onSelectProvider(opts.providerId)}
                >
                  {opts.label}
                </button>
                <button
                  type="button"
                  className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
                  onClick={() => void onRemoveKey(opts.providerId)}
                >
                  {t('settingsKeyRemove')}
                </button>
              </div>
            ) : (
              <div className="mobile-key-form">
                <input
                  type="password"
                  className="mobile-input"
                  value={keyDrafts[opts.slot] ?? ''}
                  onChange={(e) => setDraft(opts.slot, e.target.value)}
                  placeholder={t('settingsApiKeyPlaceholder')}
                  aria-label={opts.label}
                />
                <button
                  type="button"
                  className="mobile-touch-btn mobile-btn-primary"
                  disabled={busyProvider === opts.slot || !(keyDrafts[opts.slot] ?? '').trim()}
                  onClick={() => void saveKey(opts.slot, opts.providerId, opts.freeOnly)}
                >
                  {t('settingsValidateAndSave')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mobile-page" data-testid="mobile-settings-screen">
      <header className="mobile-appbar">
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onBack}
          aria-label={t('back')}
          title={t('back')}
        >
          <IconBack size={22} />
        </button>
        <h1 className="mobile-appbar-title">{t('settingsTitle')}</h1>
        <span className="mobile-header-spacer" aria-hidden="true" />
      </header>

      <main className="mobile-page-body">
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
                onChange={(e) =>
                  onUpdatePrefs({ hwpDefaultFormat: e.target.value as 'hwp' | 'hwpx' })
                }
                data-testid="settings-hwp-format-select"
              >
                <option value="hwp">.hwp</option>
                <option value="hwpx">.hwpx</option>
              </select>
            </span>
          </label>

          <label className="mobile-set-row">
            <span className="mobile-set-label">{t('settingsAiEnabled')}</span>
            <input
              type="checkbox"
              className="mobile-switch"
              checked={prefs.aiEnabled}
              onChange={(e) => onUpdatePrefs({ aiEnabled: e.target.checked })}
              data-testid="settings-ai-enabled-toggle"
            />
          </label>
        </section>

        {prefs.aiEnabled && (
          <section className="mobile-section" aria-label={t('settingsAiSection')}>
            <h2 className="mobile-section-heading">{t('settingsAiSection')}</h2>
            {keyError && (
              <div className="mobile-inline-alert" role="alert">
                {keyError}
              </div>
            )}

            {aiSettings.chatgptVisible && (
              <div className="mobile-card" data-testid="settings-chatgpt-card">
                <div className="mobile-list-row">
                  <strong>{t('settingsChatgptCard')}</strong>
                  <span
                    className={
                      chatgptStatus.state === 'ready'
                        ? 'mobile-badge mobile-badge-ok'
                        : 'mobile-badge'
                    }
                  >
                    {chatgptStatus.state}
                  </span>
                </div>
                {chatgptStatus.state === 'ready' ? (
                  <>
                    <p className="mobile-muted">
                      {chatgptStatus.account ? `${chatgptStatus.account} · ` : ''}
                      {t('settingsChatgptConnectedPlan')}
                    </p>
                    <div className="mobile-row-actions">
                      <a
                        href={SUBSCRIPTION_CHATGPT_USAGE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mobile-link-btn"
                        data-testid="chatgpt-manage-usage-link"
                      >
                        {t('aiManageUsage')}
                      </a>
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-secondary"
                        onClick={() => onSelectProvider('chatgpt')}
                      >
                        {t('settingsChatgptCard')}
                      </button>
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
                        onClick={() => void onChatgptSignOut()}
                      >
                        {t('settingsChatgptDisconnect')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {chatgptStatus.loginFailure?.reason === 'no-plan' && (
                      <div className="mobile-inline-alert" role="alert">
                        <strong>{t('aiSharingDeclinedTitle')}</strong>
                        <p className="mobile-alert-text">{t('aiSharingDeclinedDesc')}</p>
                        <button
                          type="button"
                          className="mobile-touch-btn mobile-btn-primary"
                          onClick={() => void onChatgptSignIn(true)}
                        >
                          {t('aiEnableSharing')}
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-primary"
                      onClick={() => void onChatgptSignIn(false)}
                    >
                      {t('settingsChatgptContinue')}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="mobile-card" data-testid="settings-free-ai-section">
              <h3 className="mobile-card-subtitle">{t('settingsFreeAiSection')}</h3>
              <div className="mobile-accordion-group">
                {renderProviderAccordion({
                  slot: 'openrouter-free',
                  providerId: 'openrouter',
                  label: t('settingsOpenRouterFree'),
                  connected: Boolean(openRouterConfigured?.hasKey && openRouterConfigured.freeOnly),
                  freeOnly: true,
                })}
                {renderProviderAccordion({
                  slot: 'gemini-free',
                  providerId: 'gemini',
                  label: t('settingsGeminiFree'),
                  connected: Boolean(geminiConfigured?.hasKey),
                })}
              </div>
            </div>

            <div className="mobile-card" data-testid="settings-byok-section">
              <h3 className="mobile-card-subtitle">{t('settingsByokSection')}</h3>
              <div className="mobile-accordion-group">
                {BYOK_PROVIDERS.map(({ id, label }) => {
                  const info = aiSettings.configuredProviders[id]
                  const isConnected =
                    id === 'openrouter'
                      ? Boolean(info?.hasKey && !info.freeOnly)
                      : Boolean(info?.hasKey)
                  return renderProviderAccordion({
                    slot: `byok-${id}`,
                    providerId: id,
                    label,
                    connected: isConnected,
                    freeOnly: id === 'openrouter' ? false : undefined,
                  })
                })}
              </div>
            </div>
          </section>
        )}

        <section className="mobile-section" aria-label={t('settingsBackupsSection')}>
          <h2 className="mobile-section-heading">{t('settingsBackupsSection')}</h2>
          <div className="mobile-card">
            {backups.length === 0 ? (
              <p className="mobile-muted">{t('settingsBackupsEmpty')}</p>
            ) : (
              <ul className="mobile-list" data-testid="settings-backup-list">
                {backups.map((item) => (
                  <li key={item.backupId} className="mobile-list-item-col mobile-backup-item">
                    <div className="mobile-list-row">
                      <div className="mobile-list-meta">
                        <DocTypeIcon format={item.format} size={26} />
                        <span className="mobile-list-name">{item.originalName}</span>
                      </div>
                      <span className="mobile-badge">{item.format.toUpperCase()}</span>
                    </div>
                    <div className="mobile-row-actions">
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-secondary"
                        onClick={() => void onRestoreBackup(item.backupId, 'in-place')}
                      >
                        {t('backupRestoreInPlace')}
                      </button>
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-secondary"
                        onClick={() => void onRestoreBackup(item.backupId, 'save-as')}
                      >
                        {t('backupRestoreSaveAs')}
                      </button>
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
                        onClick={() => void onDeleteBackup(item.backupId)}
                      >
                        {t('backupDelete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <footer className="mobile-about-footer">
          <IeumAppIcon size={24} />
          <span className="mobile-about-name">{t('appTitle')}</span>
          <span className="mobile-about-ver">v0.1.0</span>
        </footer>
      </main>
    </div>
  )
}
