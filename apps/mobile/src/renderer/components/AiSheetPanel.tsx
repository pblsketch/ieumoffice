import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { AgentMessage } from '@genoffice/agent-core'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import { htmlLang, type Lang } from '@genoffice/i18n'
import {
  AiChangesCard,
  AiMark,
  AiQuestionCard,
  type ActiveQuestionCardState,
  type QuestionCardSubmission,
} from '@genoffice/ui'
import { evaluateMobileAiSendGate } from '@genoffice/mobile-bridge/ai-bridge'
import type {
  MobileAiSettingsSnapshot,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import { ModelPickerSheet } from '../ai/ModelPickerSheet'
import type { MobileCurrentModel, MobileModelGroup } from '../ai/modelChoice'
import type { AiNoticeKind } from '../ai/notices'
import type { PendingPhoto } from '../ai/photos'
import { QueueStrip, type QueueStripItem } from '../ai/QueueStrip'
import { IconAiPhoto } from './icons/ai'
import { IconChevronDown, IconClose, IconSend, IconStop } from './MobileIcons'
import './AiSheetPanel.css'

/** How close to the end the message list must be to keep following new messages (one hit size). */
const FOLLOW_SLACK_PX = 48

/** The notice the panel shows; the name stays for the ChatGPT notices it started with. */
export type ChatGptRecoveryNoticeKind = AiNoticeKind | null

/** The card of a run that changed the document (decision 0151). */
export interface AiPanelChangeCard {
  readonly id: number
  /** the message the card sits under (an index into `messages`); out of range: after the last */
  readonly afterIndex: number
  /** the editor's own summary, shown as a line of its own under the card */
  readonly summary: string
  readonly state: 'applied' | 'reverted'
  /** only the most recent changing run's card can take its run back */
  readonly onUndo?: () => void
  /** the undo was pressed and the editor has not answered yet */
  readonly undoBusy?: boolean
}

/** The queue strip above the composer (PC's useChatRunQueue). */
export interface AiPanelQueue {
  readonly items: readonly QueueStripItem[]
  readonly paused: boolean
  readonly onResume: () => void
  readonly onClear: () => void
  readonly onUpdate: (id: string, text: string) => void
  readonly onMove: (id: string, toIndex: number) => void
  readonly onRemove: (id: string) => void
}

export interface AiSheetPanelProps {
  readonly aiEnabled: boolean
  readonly aiSettings: MobileAiSettingsSnapshot | null
  readonly chatgptStatus: MobileChatGptStatus | null
  readonly messages: readonly AgentMessage[]
  readonly streaming: boolean
  readonly canMutate: boolean
  readonly autoSwitchedNotice: boolean
  readonly recoveryNotice: ChatGptRecoveryNoticeKind
  /** free-limit: when the free allowance resets (epoch ms), when known */
  readonly noticeResetsAt?: number | null
  /** sends now, or queues while a run is going (the hook decides) */
  readonly onSend: (prompt: string) => void
  readonly onStop: () => void
  readonly onOpenSettings: () => void
  readonly onAcknowledgeSubscriptionNotice: () => void
  readonly onChatgptReconsent: () => void
  readonly onChatgptReconnect: () => void
  readonly onRetryLast?: () => void
  /** The shared A2UI question card the AI is asking with (ask_questions), if any. */
  readonly questionCard?: ActiveQuestionCardState | null
  readonly onQuestionSubmit?: (answer: QuestionCardSubmission) => void
  readonly onQuestionSkip?: () => void
  /** the model the next turn runs on (the chip at the top) */
  readonly currentModel?: MobileCurrentModel | null
  readonly modelGroups?: readonly MobileModelGroup[]
  readonly modelSheetOpen?: boolean
  readonly onOpenModelSheet?: () => void
  readonly onCloseModelSheet?: () => void
  readonly onChooseModel?: (provider: string, model: string) => void
  readonly changeCards?: readonly AiPanelChangeCard[]
  readonly queue?: AiPanelQueue | null
  /** photos picked for the next message */
  readonly photos?: readonly PendingPhoto[]
  /** the model in use can look at pictures */
  readonly photosAllowed?: boolean
  readonly onAddPhoto?: () => void
  readonly onRemovePhoto?: (id: string) => void
  /** the last picked file was not a readable picture */
  readonly photoError?: boolean
  /** text put back into the composer (a message not sent); a new nonce applies it again */
  readonly restoreDraft?: { readonly text: string; readonly nonce: number } | null
}

function resetTimeText(lang: Lang, at: number): string | null {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  try {
    return new Intl.DateTimeFormat(
      htmlLang(lang),
      sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    ).format(date)
  } catch {
    return date.toISOString()
  }
}

function Notice({
  testId,
  title,
  text,
  children,
}: {
  readonly testId: string
  readonly title: string
  readonly text: string
  readonly children?: ReactNode
}) {
  return (
    <div className="mobile-inline-alert" role="alert" data-testid={testId}>
      <strong>{title}</strong>
      <p className="mobile-alert-text">{text}</p>
      {children}
    </div>
  )
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
  noticeResetsAt,
  onSend,
  onStop,
  onOpenSettings,
  onAcknowledgeSubscriptionNotice,
  onChatgptReconsent,
  onChatgptReconnect,
  onRetryLast,
  questionCard,
  onQuestionSubmit,
  onQuestionSkip,
  currentModel = null,
  modelGroups = [],
  modelSheetOpen = false,
  onOpenModelSheet,
  onCloseModelSheet,
  onChooseModel,
  changeCards = [],
  queue = null,
  photos = [],
  photosAllowed = false,
  onAddPhoto,
  onRemovePhoto,
  photoError = false,
  restoreDraft = null,
}: AiSheetPanelProps) {
  const { t, lang } = useMobileLocale()
  const [draft, setDraft] = useState('')

  const restoreNonce = restoreDraft?.nonce
  useEffect(() => {
    if (restoreDraft) setDraft(restoreDraft.text)
    // applied once per nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreNonce])

  // The message list follows what arrives (replies, change cards, a question card)
  // while the person is at its end; scrolled up to read, it stays where it is.
  const listRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)
  const last = messages[messages.length - 1]
  const contentKey = [
    messages.length,
    last && last.role !== 'tool' ? last.text.length : 0,
    changeCards.map((card) => `${card.id}${card.state}`).join(),
    questionCard?.id ?? '',
  ].join('|')
  useLayoutEffect(() => {
    const list = listRef.current
    if (list && followRef.current) list.scrollTop = list.scrollHeight
  }, [contentKey])
  const onListScroll = () => {
    const list = listRef.current
    if (!list) return
    followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_SLACK_PX
  }

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
  const keyRoute = currentModel !== null && currentModel.provider !== 'chatgpt'
  const photoBlocked = photos.length > 0 && !photosAllowed

  /** The one send path of the composer, the quick requests and [resend]: the gate first. */
  const sendText = (text: string): boolean => {
    const trimmed = text.trim()
    if (!trimmed) return false
    if (gate.kind === 'connect') return false
    if (gate.kind === 'notice') {
      onAcknowledgeSubscriptionNotice()
      return false
    }
    if (photoBlocked) return false
    // the person's own message always brings the list to its end
    followRef.current = true
    onSend(trimmed)
    return true
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (sendText(draft)) setDraft('')
  }

  const resetsText =
    effectiveRecovery === 'free-limit' && typeof noticeResetsAt === 'number'
      ? resetTimeText(lang, noticeResetsAt)
      : null

  const cardsAfter = (index: number) =>
    changeCards.filter((card) =>
      index === messages.length - 1
        ? card.afterIndex >= index || card.afterIndex < 0
        : card.afterIndex === index,
    )
  const renderCard = (card: AiPanelChangeCard) => (
    <div
      key={`card-${card.id}`}
      className="mobile-ai-change"
      data-testid="ai-changes-card"
      data-state={card.state}
    >
      <AiChangesCard
        lang={lang}
        state={card.state}
        canRevert={!streaming && !card.undoBusy}
        onRevert={card.state === 'applied' ? card.onUndo : undefined}
      />
      {card.summary && (
        <p className="mobile-ai-change-summary" dir="auto">
          {card.summary}
        </p>
      )}
    </div>
  )

  const showQuick = gate.kind !== 'connect' && (messages.length === 0 || !draft.trim())

  return (
    <div className="mobile-ai-panel" data-testid="mobile-ai-panel">
      {gate.kind !== 'connect' && currentModel && (
        <div className="mobile-ai-model-row">
          <button
            type="button"
            className="mobile-ai-model-chip"
            data-testid="ai-model-chip"
            disabled={streaming || !onOpenModelSheet}
            aria-label={t('aiModelChipLabel', {
              model: currentModel.model || currentModel.provider,
            })}
            title={streaming ? t('aiModelBusyHint') : t('aiModelPickTitle')}
            onClick={onOpenModelSheet}
          >
            <span className="mobile-ai-model-chip-text" dir="auto">
              {currentModel.model ||
                (currentModel.provider === 'custom'
                  ? t('aiModelCustomServer')
                  : currentModel.provider)}
            </span>
            <IconChevronDown size={14} />
          </button>
        </div>
      )}

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
        <Notice
          testId="ai-recovery-usage-limit"
          title={t('aiUsageLimitTitle')}
          text={t('aiUsageLimitDesc')}
        >
          <a
            href={SUBSCRIPTION_CHATGPT_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-link-btn"
          >
            {t('aiManageUsage')}
          </a>
        </Notice>
      )}

      {effectiveRecovery === 'sharing-declined' && (
        <Notice
          testId="ai-recovery-sharing"
          title={t('aiSharingDeclinedTitle')}
          text={t('aiSharingDeclinedDesc')}
        >
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onChatgptReconsent}
          >
            {t('aiEnableSharing')}
          </button>
        </Notice>
      )}

      {effectiveRecovery === 'reauth' && (
        <Notice testId="ai-recovery-reauth" title={t('aiReauthTitle')} text={t('aiReauthDesc')}>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={onChatgptReconnect}
          >
            {t('aiReconnect')}
          </button>
        </Notice>
      )}

      {effectiveRecovery === 'connection-error' && (
        <Notice
          testId="ai-recovery-error"
          title={keyRoute ? t('aiKeyConnectionErrorTitle') : t('aiConnectionErrorTitle')}
          text={t('aiConnectionErrorDesc')}
        >
          {onRetryLast && (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              onClick={onRetryLast}
            >
              {t('aiRetry')}
            </button>
          )}
        </Notice>
      )}

      {effectiveRecovery === 'free-limit' && (
        <Notice
          testId="ai-recovery-free-limit"
          title={t('aiFreeLimitTitle')}
          text={t('aiFreeLimitDesc')}
        >
          {resetsText && (
            <p className="mobile-alert-text" data-testid="ai-free-limit-resets">
              {t('aiFreeLimitResets', { time: resetsText })}
            </p>
          )}
        </Notice>
      )}

      {effectiveRecovery === 'free-tier-model' && (
        <Notice
          testId="ai-recovery-free-tier-model"
          title={t('aiFreeTierModelTitle')}
          text={t('aiFreeTierModelDesc')}
        >
          {onOpenModelSheet && (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              data-testid="ai-notice-pick-model"
              disabled={streaming}
              onClick={onOpenModelSheet}
            >
              {t('aiModelPickTitle')}
            </button>
          )}
        </Notice>
      )}

      {effectiveRecovery === 'credits' && (
        <Notice
          testId="ai-recovery-credits"
          title={t('aiCreditsTitle')}
          text={t('aiCreditsDesc')}
        />
      )}

      {effectiveRecovery === 'overloaded' && (
        <Notice
          testId="ai-recovery-overloaded"
          title={t('aiOverloadedTitle')}
          text={t('aiOverloadedDesc')}
        >
          {onRetryLast && (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              data-testid="ai-notice-resend"
              onClick={onRetryLast}
            >
              {t('aiResend')}
            </button>
          )}
        </Notice>
      )}

      {effectiveRecovery === 'auth' && (
        <Notice testId="ai-recovery-auth" title={t('aiAuthTitle')} text={t('aiAuthDesc')}>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="ai-notice-open-settings"
            onClick={onOpenSettings}
          >
            {t('aiOpenSettings')}
          </button>
        </Notice>
      )}

      {effectiveRecovery === 'blocked-hidden' && (
        <Notice
          testId="ai-blocked-hidden"
          title={t('aiBlockedHiddenTitle')}
          text={t('aiBlockedHiddenDesc')}
        >
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            data-testid="ai-blocked-resend"
            disabled={streaming || !draft.trim()}
            onClick={() => {
              if (sendText(draft)) setDraft('')
            }}
          >
            {t('aiResend')}
          </button>
        </Notice>
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

      <div
        className="mobile-ai-messages"
        data-testid="ai-message-list"
        ref={listRef}
        onScroll={onListScroll}
      >
        {messages.length === 0 ? (
          <>
            <div className="mobile-ai-empty">
              <span className="mobile-ai-empty-mark">
                <AiMark size={22} />
              </span>
              <p className="mobile-muted">{t('aiEmptyHint')}</p>
            </div>
            {changeCards.map(renderCard)}
          </>
        ) : (
          messages.map((msg, idx) => (
            <Fragment key={`${msg.role}-${idx}`}>
              {msg.role !== 'tool' && (
                <div
                  className={
                    msg.role === 'user'
                      ? 'mobile-ai-bubble mobile-ai-user'
                      : 'mobile-ai-bubble mobile-ai-assistant'
                  }
                >
                  {msg.text}
                </div>
              )}
              {cardsAfter(idx).map(renderCard)}
            </Fragment>
          ))
        )}
        {questionCard && (
          <AiQuestionCard
            key={questionCard.id}
            lang={lang}
            view={questionCard.view}
            status={questionCard.status}
            answer={questionCard.answer}
            onSubmit={onQuestionSubmit}
            onSkip={onQuestionSkip}
          />
        )}
      </div>

      {queue && (
        <QueueStrip
          items={queue.items}
          paused={queue.paused}
          onResume={queue.onResume}
          onClear={queue.onClear}
          onUpdate={queue.onUpdate}
          onMove={queue.onMove}
          onRemove={queue.onRemove}
        />
      )}

      {photos.length > 0 && (
        <ul className="mobile-ai-photos" data-testid="ai-photo-chips">
          {photos.map((photo) => (
            <li key={photo.id} className="mobile-ai-photo" data-testid="ai-photo-chip">
              <img
                className="mobile-ai-photo-thumb"
                src={`data:${photo.mime};base64,${photo.base64}`}
                alt={photo.name}
                draggable={false}
              />
              {onRemovePhoto && (
                <button
                  type="button"
                  className="mobile-ai-photo-remove"
                  aria-label={t('aiPhotoRemove')}
                  title={t('aiPhotoRemove')}
                  onClick={() => onRemovePhoto(photo.id)}
                >
                  <IconClose size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {photoError && (
        <div className="mobile-inline-alert" role="alert" data-testid="ai-photo-error">
          {t('aiPhotoUnreadable')}
        </div>
      )}

      {showQuick && (
        <div className="mobile-ai-quick" data-testid="ai-quick-chips">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-secondary"
            data-testid="ai-quick-easy"
            onClick={() => sendText(t('aiQuickEasyPrompt'))}
          >
            {t('aiQuickEasy')}
          </button>
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-secondary"
            data-testid="ai-quick-translate"
            onClick={() => sendText(t('aiQuickTranslatePrompt'))}
          >
            {t('aiQuickTranslate')}
          </button>
        </div>
      )}

      <form className="mobile-ai-composer" onSubmit={handleSubmit}>
        {onAddPhoto && (
          <button
            type="button"
            className="mobile-ai-photo-btn"
            data-testid="ai-photo-btn"
            onClick={onAddPhoto}
            disabled={gate.kind === 'connect' || !photosAllowed}
            aria-label={t('aiPhotoAttach')}
            title={photosAllowed ? t('aiPhotoAttach') : t('aiPhotoNoVision')}
          >
            <IconAiPhoto size={18} />
          </button>
        )}
        <input
          type="text"
          className="mobile-ai-composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('aiPlaceholder')}
          disabled={gate.kind === 'connect'}
          aria-label={t('aiPlaceholder')}
        />
        {streaming && (
          <button
            type="button"
            className="mobile-ai-send-btn mobile-btn-secondary"
            onClick={onStop}
            aria-label={t('aiStop')}
            title={t('aiStop')}
            data-testid="ai-stop-btn"
          >
            <IconStop size={16} />
          </button>
        )}
        {(!streaming || draft.trim()) && (
          <button
            type="submit"
            className="mobile-ai-send-btn mobile-btn-primary"
            disabled={!draft.trim() || gate.kind === 'connect' || photoBlocked}
            aria-label={t('aiSend')}
            title={t('aiSend')}
          >
            <IconSend size={17} />
          </button>
        )}
      </form>

      {onAddPhoto && gate.kind !== 'connect' && currentModel && !photosAllowed && (
        <p className="mobile-ai-photo-reason" data-testid="ai-photo-no-vision">
          {t('aiPhotoNoVision')}
        </p>
      )}

      {onChooseModel && onCloseModelSheet && (
        <ModelPickerSheet
          open={modelSheetOpen && !streaming}
          groups={modelGroups}
          current={currentModel}
          onChoose={onChooseModel}
          onClose={onCloseModelSheet}
        />
      )}
    </div>
  )
}
