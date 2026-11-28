import { useState, type FormEvent } from 'react'
import type { AgentMessage } from '@genoffice/agent-core'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import { AiMark } from '@genoffice/ui'
import { evaluateMobileAiSendGate } from '@genoffice/mobile-bridge/ai-bridge'
import type {
  MobileAiSettingsSnapshot,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import { IconSend, IconStop } from './MobileIcons'

export type ChatGptRecoveryNoticeKind =
  'usage-limit' | 'sharing-declined' | 'reauth' | 'connection-error' | null

export interface AiSheetPanelProps {
  readonly aiEnabled: boolean
  readonly aiSettings: MobileAiSettingsSnapshot | null
  readonly chatgptStatus: MobileChatGptStatus | null
  readonly messages: readonly AgentMessage[]
  readonly streaming: boolean
  readonly canMutate: boolean
  readonly autoSwitchedNotice: boolean
  readonly recoveryNotice: ChatGptRecoveryNoticeKind
  readonly lastChangeSummary?: string | null
  readonly onUndoLastChange?: () => void
  readonly onSend: (prompt: string) => void
  readonly onStop: () => void
  readonly onOpenSettings: () => void
  readonly onAcknowledgeSubscriptionNotice: () => void
  readonly onChatgptReconsent: () => void
  readonly onChatgptReconnect: () => void
  readonly onRetryLast?: () => void
}

export function AiSheetPanel({
  aiEnabled,
  aiSettings,
  chatgptStatus,
  messages,
  streaming,
  canMutate,
  autoSwitchedNotice,
  recoveryNotice,
  lastChangeSummary,
  onUndoLastChange,
  onSend,
  onStop,
  onOpenSettings,
  onAcknowledgeSubscriptionNotice,
  onChatgptReconsent,
  onChatgptReconnect,
  onRetryLast,
}: AiSheetPanelProps) {
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState('')

  if (!aiEnabled) {
    return (
      <div className="mobile-ai-panel" data-testid="mobile-ai-off">
        <div className="mobile-ai-empty">
          <span className="mobile-ai-empty-mark">
            <AiMark size={22} />
          </span>
          <p className="mobile-muted">{t('aiOffNotice')}</p>
        </div>
      </div>
    )
  }

  const gate = evaluateMobileAiSendGate(aiSettings, chatgptStatus)
  const effectiveRecovery: ChatGptRecoveryNoticeKind =
    recoveryNotice ??
    (chatgptStatus?.sharing === false || chatgptStatus?.loginFailure?.reason === 'no-plan'
      ? 'sharing-declined'
      : chatgptStatus?.state === 'error'
        ? 'connection-error'
        : null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || streaming) return
    if (gate.kind === 'connect') return
    if (gate.kind === 'notice') {
      onAcknowledgeSubscriptionNotice()
      return
    }
    setDraft('')
    onSend(trimmed)
  }

  return (
    <div className="mobile-ai-panel" data-testid="mobile-ai-panel">
      {!canMutate && (
        <div className="mobile-inline-info" role="status">
          {t('aiReadOnlyHint')}
        </div>
      )}

      {autoSwitchedNotice && (
        <div className="mobile-inline-info" role="status" data-testid="ai-auto-edit-notice">
          {t('aiSwitchedToEditNotice')}
        </div>
      )}

      {effectiveRecovery === 'usage-limit' && (
        <div className="mobile-inline-alert" role="alert" data-testid="ai-recovery-usage-limit">
          <strong>{t('aiUsageLimitTitle')}</strong>
          <p className="mobile-alert-text">{t('aiUsageLimitDesc')}</p>
          <a
            href={SUBSCRIPTION_CHATGPT_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-link-btn"
          >
            {t('aiManageUsage')}
          </a>
        </div>
      )}

      {effectiveRecovery === 'sharing-declined' && (
        <div className="mobile-inline-alert" role="alert" data-testid="ai-recovery-sharing">
          <strong>{t('aiSharingDeclinedTitle')}</strong>
          <p className="mobile-alert-text">{t('aiSharingDeclinedDesc')}</p>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onChatgptReconsent}
          >
            {t('aiEnableSharing')}
          </button>
        </div>
      )}

      {effectiveRecovery === 'reauth' && (
        <div className="mobile-inline-alert" role="alert" data-testid="ai-recovery-reauth">
          <strong>{t('aiReauthTitle')}</strong>
          <p className="mobile-alert-text">{t('aiReauthDesc')}</p>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onChatgptReconnect}
          >
            {t('aiReconnect')}
          </button>
        </div>
      )}

      {effectiveRecovery === 'connection-error' && (
        <div className="mobile-inline-alert" role="alert" data-testid="ai-recovery-error">
          <strong>{t('aiConnectionErrorTitle')}</strong>
          <p className="mobile-alert-text">{t('aiConnectionErrorDesc')}</p>
          {onRetryLast && (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              onClick={onRetryLast}
            >
              {t('aiRetry')}
            </button>
          )}
        </div>
      )}

      {gate.kind === 'connect' && (
        <div className="mobile-ai-connect-card" data-testid="ai-connect-prompt">
          <div className="mobile-ai-connect-head">
            <span className="mobile-ai-empty-mark">
              <AiMark size={20} />
            </span>
            <strong>{t('aiNotConnectedTitle')}</strong>
          </div>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onOpenSettings}
          >
            {t('aiOpenSettings')}
          </button>
        </div>
      )}

      {gate.kind === 'notice' && (
        <div className="mobile-card" data-testid="ai-subscription-notice">
          <p className="mobile-muted">{t('settingsChatgptConnectedPlan')}</p>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onAcknowledgeSubscriptionNotice}
          >
            {t('settingsChatgptContinue')}
          </button>
        </div>
      )}

      <div className="mobile-ai-messages" data-testid="ai-message-list">
        {messages.length === 0 ? (
          <div className="mobile-ai-empty">
            <span className="mobile-ai-empty-mark">
              <AiMark size={22} />
            </span>
            <p className="mobile-muted">{t('aiEmptyHint')}</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            if (msg.role === 'tool') return null
            return (
              <div
                key={`${msg.role}-${idx}`}
                className={
                  msg.role === 'user'
                    ? 'mobile-ai-bubble mobile-ai-user'
                    : 'mobile-ai-bubble mobile-ai-assistant'
                }
              >
                {msg.text}
              </div>
            )
          })
        )}
      </div>

      {lastChangeSummary && onUndoLastChange && (
        <div className="mobile-changes-card" data-testid="ai-changes-card">
          <span className="mobile-changes-summary">{lastChangeSummary}</span>
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-secondary"
            onClick={onUndoLastChange}
          >
            {t('undo')}
          </button>
        </div>
      )}

      <form className="mobile-ai-composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="mobile-ai-composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('aiPlaceholder')}
          disabled={gate.kind === 'connect'}
          aria-label={t('aiPlaceholder')}
        />
        {streaming ? (
          <button
            type="button"
            className="mobile-ai-send-btn mobile-btn-secondary"
            onClick={onStop}
            aria-label={t('aiStop')}
            title={t('aiStop')}
          >
            <IconStop size={16} />
          </button>
        ) : (
          <button
            type="submit"
            className="mobile-ai-send-btn mobile-btn-primary"
            disabled={!draft.trim() || gate.kind === 'connect'}
            aria-label={t('aiSend')}
            title={t('aiSend')}
          >
            <IconSend size={17} />
          </button>
        )}
      </form>
    </div>
  )
}
