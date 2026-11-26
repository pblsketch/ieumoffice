// Owner: track T7 (AI switch, AI connections and AI storage rows).
import { useCallback, useState, useSyncExternalStore } from 'react'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import { AiConfirmSheet } from '../../ai/AiConfirmSheet'
import { AiResultsRows } from '../../ai/AiResultsRows'
import { AiToolsCard } from '../../ai/AiToolsCard'
import {
  CustomServerRow,
  EMPTY_CUSTOM_DRAFT,
  type CustomServerDraft,
} from '../../ai/CustomServerRow'
import {
  isMobileAiRunning,
  mobileAiQueuedCount,
  mobileAiRunState,
  stopAllMobileAi,
  subscribeMobileAiRunState,
} from '../../ai/runState'
import type { MobileAiSettingsSlot } from '../../ai/settingsSlot'
import { useMobileLocale } from '../../i18n'
import { IconChevronDown, IconChevronRight } from '../../components/MobileIcons'
import './AiSection.css'

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

/**
 * The AI on/off switch: one row inside the general settings card, with the
 * one-line hint of design system 6.1 under its label. Turning AI off while a
 * run is going or messages wait in the queue asks "stop and turn off?" first;
 * cancelling (or Back) leaves AI on and the work running.
 */
export function AiEnabledRow({ prefs, onUpdatePrefs }: AiEnabledRowProps) {
  const { t } = useMobileLocale()
  const run = useSyncExternalStore(subscribeMobileAiRunState, mobileAiRunState, mobileAiRunState)
  const [askOff, setAskOff] = useState(false)

  const onSwitch = (on: boolean) => {
    if (on) {
      onUpdatePrefs({ aiEnabled: true })
      return
    }
    const busy = run.running || run.queued > 0 || isMobileAiRunning() || mobileAiQueuedCount() > 0
    if (busy) {
      setAskOff(true)
      return
    }
    onUpdatePrefs({ aiEnabled: false })
  }

  const stopAndTurnOff = () => {
    setAskOff(false)
    // stop the run and empty the queue, then save off
    stopAllMobileAi()
    onUpdatePrefs({ aiEnabled: false })
  }

  const keepOn = useCallback(() => setAskOff(false), [])

  return (
    <>
      <label className="mobile-set-row">
        <span className="ai-set-switch-text">
          <span className="mobile-set-label">{t('settingsAiEnabled')}</span>
          <span className="ai-set-hint" data-testid="ai-enabled-hint">
            {t('aiEnabledHint')}
          </span>
        </span>
        <input
          type="checkbox"
          className="mobile-switch"
          checked={prefs.aiEnabled}
          onChange={(e) => onSwitch(e.target.checked)}
          data-testid="settings-ai-enabled-toggle"
        />
      </label>
      <AiConfirmSheet
        open={askOff}
        title={t('aiStopOffTitle')}
        body={t('aiStopOffBody')}
        confirmLabel={t('aiStopOffConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={stopAndTurnOff}
        onCancel={keepOn}
        testId="ai-stop-off-sheet"
      />
    </>
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
  slot: aiSlot,
}: AiSectionProps) {
  const { t } = useMobileLocale()
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [customDraft, setCustomDraft] = useState<CustomServerDraft>(EMPTY_CUSTOM_DRAFT)
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
  // the providers with a key, so the AI tools card reads the ready image providers again
  const keysVersion = Object.entries(aiSettings.configuredProviders)
    .filter(([, info]) => info?.hasKey)
    .map(([id]) => id)
    .sort()
    .join(',')
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
          className="mobile-accordion-trigger ai-set-provider"
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
          {aiSlot?.client && (
            <CustomServerRow
              client={aiSlot.client}
              selectedProvider={aiSettings.selectedProvider}
              applyAiSettings={aiSlot.applyAiSettings}
              draft={customDraft}
              onDraft={(patch) => setCustomDraft((prev) => ({ ...prev, ...patch }))}
              expanded={expandedSlot === 'custom'}
              onToggle={() => toggleSlot('custom')}
            />
          )}
        </div>
      </div>

      {aiSlot?.client && <AiToolsCard keysVersion={keysVersion} />}
    </section>
  )
}

export interface AiStorageRowsProps {
  readonly slot?: MobileAiSettingsSlot
}

/**
 * The AI result store card. The storage section draws it after its own card,
 * so it brings its own card and heading. Shown while AI is off too; nothing
 * without the app's client.
 */
export function AiStorageRows({ slot }: AiStorageRowsProps) {
  const { t } = useMobileLocale()
  if (!slot?.client) return null
  return (
    <div className="mobile-card" data-testid="ai-results-card">
      <h3 className="mobile-card-subtitle">{t('aiResultsTitle')}</h3>
      <AiResultsRows client={slot.client} />
    </div>
  )
}
