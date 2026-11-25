// Owner: track T7 (AI switch, AI connections and AI storage rows).
import { useState } from 'react'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import type { MobileAiSettingsSlot } from '../../ai/settingsSlot'
import { useMobileLocale } from '../../i18n'
import { IconChevronDown, IconChevronRight } from '../../components/MobileIcons'

const BYOK_PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter (BYOK)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'mistral', label: 'Mistral' },
] as const

export interface AiEnabledRowProps {
  readonly prefs: MobileAppPrefs
  readonly onUpdatePrefs: (patch: MobileAppPrefsPatch) => void
}

/** The AI on/off switch: one row inside the general settings card. */
export function AiEnabledRow({ prefs, onUpdatePrefs }: AiEnabledRowProps) {
  const { t } = useMobileLocale()
  return (
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
  )
}

export interface AiSectionProps {
  readonly prefs: MobileAppPrefs
  readonly aiSettings: MobileAiSettingsSnapshot
  readonly chatgptStatus: MobileChatGptStatus
  readonly onSelectProvider: (provider: string) => void
  readonly onValidateAndSaveKey: (params: {
    readonly provider: string
    readonly apiKey: string
    readonly freeOnly?: boolean
  }) => Promise<void>
  readonly onRemoveKey: (provider: string) => Promise<void>
  readonly onChatgptSignIn: (reconsent?: boolean) => Promise<void>
  readonly onChatgptSignOut: () => Promise<void>
  readonly slot?: MobileAiSettingsSlot
}

/**
 * The AI connections section. It stays mounted and draws nothing while AI is
 * off, so key drafts and the open provider survive switching AI off and on.
 */
export function AiSection({
  prefs,
  aiSettings,
  chatgptStatus,
  onSelectProvider,
  onValidateAndSaveKey,
  onRemoveKey,
  onChatgptSignIn,
  onChatgptSignOut,
}: AiSectionProps) {
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

  if (!prefs.aiEnabled) return null

  return (
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
                chatgptStatus.state === 'ready' ? 'mobile-badge mobile-badge-ok' : 'mobile-badge'
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
              id === 'openrouter' ? Boolean(info?.hasKey && !info.freeOnly) : Boolean(info?.hasKey)
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
  )
}

export interface AiStorageRowsProps {
  readonly slot?: MobileAiSettingsSlot
}

/** AI result store size and clear rows, drawn by the storage section. Empty for now. */
export function AiStorageRows(_props: AiStorageRowsProps) {
  return null
}
