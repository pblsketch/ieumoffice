/**
 * Macro Editor modal for creating, editing, and saving recorded macros.
 *
 * Security & business rules:
 * - Live syntax validation via `validateMacroSyntax` with exact `(line, column)`.
 * - The "Write with AI" section is rendered ONLY when `aiEnabled === true`
 *   (respecting decision 0143 Editor Choice & AI Off).
 * - "Write with AI" goes through the shared `useAiSendGate` and shared AI stream,
 *   sends ONLY the user's description + grammar/API reference (zero document
 *   content), and writes the result ONLY into the script textarea. It NEVER
 *   auto-saves and NEVER auto-runs.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { htmlDir, type Lang } from '@genoffice/i18n'
import type { AiSettings, AiSubscriptionStatuses } from '@genoffice/ai-provider/browser'
import {
  AiBlockedNotice,
  AiConnectPrompt,
  AiFirstConnectionNotice,
  useAiSendGate,
  type AiSettingsStore,
} from '@genoffice/ui'
import { IconClose } from '@genoffice/ui/icons'
import { validateMacroSyntax } from '../../../studio-plugin/macro-interpreter.mjs'
import {
  MACRO_SLOT_KEYS,
  type MacroSkippedCommand,
} from '../../../studio-plugin/macro-recorder.mjs'
import type { MacroOrigin, MacroRecord } from '../../shared/ipc'
import { useSubscriptionConnection } from '../ai/subscription-client'
import { localizeSkippedCommandLabel, useMacroI18n } from '../i18n/macro'
import { requestAiMacroDraft, type MacroAiBlockedInfo, type MacroAiStreamClient } from './macro-ai'
import './macro-modal.css'

/** Format shortcut slot 1..11 into its display label (`Alt+1`..`Alt+9`, `Alt+0`, `Alt+-`). */
export function shortcutLabelForSlot(slot: number | null | undefined): string {
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return ''
  const key = MACRO_SLOT_KEYS[slot - 1]
  return key ? `Alt+${key}` : ''
}

export interface MacroEditorDraft {
  id?: string
  name?: string
  description?: string
  script?: string
  slot?: number | null
  origin?: MacroOrigin
  skipped?: MacroSkippedCommand[]
}

export interface MacroEditorSavePayload {
  id?: string
  name: string
  description: string
  script: string
  slot: number | null
  origin: MacroOrigin
}

export interface MacroEditorModalProps {
  mode: 'new' | 'edit' | 'recorded'
  initialMacro?: MacroRecord | null
  initialDraft?: MacroEditorDraft | null
  existingMacros: readonly MacroRecord[]
  /** When false, "Write with AI" is completely hidden from the DOM. */
  aiEnabled: boolean
  /** Disables saving when the macro store is blocked by an error. */
  disabled?: boolean
  onSave: (payload: MacroEditorSavePayload) => Promise<{ ok: boolean; error?: string }>
  onRun?: (script: string, name: string) => Promise<void>
  onClose: () => void
  /** Optional overrides for unit testing without real Electron IPC / CLIs. */
  aiStreamClient?: MacroAiStreamClient
  aiSettingsOverride?: AiSettings | null
  aiStatusesOverride?: AiSubscriptionStatuses | null
  aiStoreOverride?: AiSettingsStore
}

interface MacroAiAssistantProps {
  lang: Lang
  onDraftScript: (script: string) => void
  streamClient?: MacroAiStreamClient
  settingsOverride?: AiSettings | null
  statusesOverride?: AiSubscriptionStatuses | null
  storeOverride?: AiSettingsStore
}

function defaultAiStore(): AiSettingsStore {
  return {
    getSettings: () =>
      window.hwpApi?.getAiSettings ? window.hwpApi.getAiSettings() : Promise.resolve(undefined),
    setSettings: (settings) =>
      window.hwpApi?.setAiSettings ? window.hwpApi.setAiSettings(settings) : Promise.resolve(),
  }
}

function MacroAiAssistant({
  lang,
  onDraftScript,
  streamClient,
  settingsOverride,
  statusesOverride,
  storeOverride,
}: MacroAiAssistantProps): ReactElement {
  const { t } = useMacroI18n()
  const [prompt, setPrompt] = useState('')
  const [writing, setWriting] = useState(false)
  const [statusNotice, setStatusNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  )
  const [blocked, setBlocked] = useState<MacroAiBlockedInfo | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(settingsOverride ?? null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (settingsOverride !== undefined) {
      setAiSettings(settingsOverride)
      return
    }
    let alive = true
    const refresh = (): void => {
      window.hwpApi?.getAiSettings?.().then(
        (next) => {
          if (alive) setAiSettings(next)
        },
        () => {},
      )
    }
    refresh()
    const off = window.hwpApi?.onAiSettingsChanged?.(refresh)
    return () => {
      alive = false
      off?.()
    }
  }, [settingsOverride])

  const subscription = useSubscriptionConnection()
  const statuses = statusesOverride ?? subscription.statuses
  const store = useMemo(() => storeOverride ?? defaultAiStore(), [storeOverride])

  const runDraft = useCallback(
    async (instruction: string, activeSettings: AiSettings | null): Promise<void> => {
      const cleaned = instruction.trim()
      if (!cleaned) {
        setStatusNotice({ tone: 'error', text: t('aiEmptyPrompt') })
        return
      }
      const resolvedSettings =
        activeSettings ??
        (settingsOverride !== undefined
          ? settingsOverride
          : await window.hwpApi?.getAiSettings?.().catch(() => null))
      if (!resolvedSettings) {
        setStatusNotice({ tone: 'error', text: t('aiDraftFailed', { error: 'No AI settings' }) })
        return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setWriting(true)
      setStatusNotice(null)
      setBlocked(null)
      try {
        const result = await requestAiMacroDraft({
          userPrompt: cleaned,
          lang,
          settings: resolvedSettings,
          statuses,
          streamClient,
          signal: controller.signal,
        })
        if (!mountedRef.current) return
        if (result.ok) {
          // Security invariant: write ONLY into the script textarea; NEVER auto-save or auto-run.
          onDraftScript(result.script)
          setStatusNotice({ tone: 'info', text: t('aiDraftReady') })
          return
        }
        if (result.cancelled) {
          return
        }
        if (result.blocked) {
          setBlocked(result.blocked)
        }
        setStatusNotice({
          tone: 'error',
          text:
            result.error === 'AI returned an empty macro script.'
              ? t('aiNoOutput')
              : t('aiDraftFailed', { error: result.error }),
        })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (mountedRef.current) setWriting(false)
      }
    },
    [lang, onDraftScript, settingsOverride, statuses, streamClient, t],
  )

  const sendGate = useAiSendGate<{ prompt: string }>({
    settings: aiSettings,
    statuses,
    store,
    start: (held) => {
      void runDraft(held.prompt, sendGate.settings)
    },
    onNotConnected: () => subscription.refresh(),
    onSettingsSaved: setAiSettings,
  })

  const handleWriteClick = (): void => {
    if (writing) return
    const cleaned = prompt.trim()
    if (!cleaned) {
      setStatusNotice({ tone: 'error', text: t('aiEmptyPrompt') })
      return
    }
    setStatusNotice(null)
    setBlocked(null)
    if (!sendGate.admit({ prompt: cleaned })) {
      return
    }
    void runDraft(cleaned, sendGate.settings)
  }

  const handleCancelAi = (): void => {
    abortRef.current?.abort()
    setWriting(false)
  }

  return (
    <section className="macro-ai-box" data-testid="macro-ai-section">
      <div className="macro-ai-head">
        <span className="macro-ai-title">{t('aiSectionTitle')}</span>
      </div>
      <div className="macro-ai-row">
        <input
          type="text"
          className="macro-input"
          data-testid="macro-ai-prompt-input"
          value={prompt}
          disabled={writing}
          placeholder={t('aiPromptPlaceholder')}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleWriteClick()
            }
          }}
        />
        {writing ? (
          <button
            type="button"
            className="macro-btn"
            data-testid="macro-ai-cancel-btn"
            onClick={handleCancelAi}
          >
            {t('aiCancelBtn')}
          </button>
        ) : (
          <button
            type="button"
            className="macro-btn macro-btn-primary"
            data-testid="macro-ai-write-btn"
            onClick={handleWriteClick}
          >
            {t('aiWriteBtn')}
          </button>
        )}
      </div>
      <p className="macro-ai-hint">{t('aiReviewHint')}</p>

      {sendGate.connectChoice && (
        <AiConnectPrompt
          choice={sendGate.connectChoice}
          statuses={statuses ?? {}}
          lang={lang}
          disabled={subscription.busy}
          attention={sendGate.connectAttention}
          onOpenSettings={() => void window.hwpApi?.openAiModelSettings?.().catch(() => {})}
          onInstall={subscription.install}
          onUpdate={subscription.update}
          onCancelLogin={subscription.cancelLogin}
          onLogin={subscription.login}
          onRecheck={subscription.recheck}
          onAcceptMetered={subscription.acceptMetered}
          onOpenInstallHelp={subscription.openInstallHelp}
          onOpenConnectHelp={subscription.openConnectHelp}
        />
      )}

      {sendGate.noticeDue && (
        <AiFirstConnectionNotice
          lang={lang}
          codexKeepsHistory
          onAcknowledge={sendGate.acknowledgeNotice}
        />
      )}

      {blocked && statusNotice && (
        <AiBlockedNotice
          kind={blocked.kind}
          provider={blocked.provider}
          resetsAt={blocked.resetsAt}
          message={statusNotice.text}
          settings={aiSettings ?? {}}
          statuses={statuses ?? {}}
          lang={lang}
          onContinueWith={(provider) =>
            sendGate.continueWith(provider, () => {
              void runDraft(prompt, sendGate.settings)
            })
          }
        />
      )}

      {statusNotice && !blocked && (
        <div
          className={`macro-banner ${statusNotice.tone === 'error' ? 'macro-banner-error' : 'macro-banner-info'}`}
          role={statusNotice.tone === 'error' ? 'alert' : 'status'}
          data-testid="macro-ai-status"
        >
          {statusNotice.text}
        </div>
      )}
    </section>
  )
}

export function MacroEditorModal({
  mode,
  initialMacro,
  initialDraft,
  existingMacros,
  aiEnabled,
  disabled = false,
  onSave,
  onRun,
  onClose,
  aiStreamClient,
  aiSettingsOverride,
  aiStatusesOverride,
  aiStoreOverride,
}: MacroEditorModalProps): ReactElement {
  const { lang, t } = useMacroI18n()
  const titleId = useId()
  const nameInputId = useId()
  const descInputId = useId()
  const slotSelectId = useId()
  const scriptInputId = useId()
  const dir = htmlDir(lang)

  const editingId = initialMacro?.id ?? initialDraft?.id
  const [name, setName] = useState(initialMacro?.name ?? initialDraft?.name ?? '')
  const [description, setDescription] = useState(
    initialMacro?.description ?? initialDraft?.description ?? '',
  )
  const [slot, setSlot] = useState<number | null>(initialMacro?.slot ?? initialDraft?.slot ?? null)
  const [script, setScript] = useState(initialMacro?.script ?? initialDraft?.script ?? '')
  const [origin, setOrigin] = useState<MacroOrigin>(
    initialMacro?.origin ?? initialDraft?.origin ?? (mode === 'recorded' ? 'recorded' : 'manual'),
  )
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const skippedActions = initialDraft?.skipped ?? []

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || saving || running) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, running, saving])

  const syntaxResult = useMemo(() => {
    if (script.trim().length === 0) return null
    return validateMacroSyntax(script)
  }, [script])

  const slotOwners = useMemo(() => {
    const map = new Map<number, string>()
    for (const macro of existingMacros) {
      if (macro.slot !== null && macro.id !== editingId) {
        map.set(macro.slot, macro.name)
      }
    }
    return map
  }, [editingId, existingMacros])

  const handleAiDraftScript = useCallback(
    (draft: string) => {
      setScript(draft)
      setFormError(null)
      if (mode === 'new' && !editingId) {
        setOrigin('ai')
      }
    },
    [editingId, mode],
  )

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (saving || disabled) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError(t('validationNameRequired'))
      return
    }
    if (script.trim().length === 0) {
      setFormError(t('validationScriptRequired'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const result = await onSave({
        ...(editingId ? { id: editingId } : {}),
        name: trimmedName,
        description: description.trim(),
        script,
        slot,
        origin,
      })
      if (!result.ok) {
        setFormError(result.error || t('errorActionFailed', { error: 'save_failed' }))
      }
    } catch (error) {
      setFormError(
        t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRunClick = async (): Promise<void> => {
    if (!onRun || running || saving) return
    if (script.trim().length === 0) {
      setFormError(t('validationScriptRequired'))
      return
    }
    if (syntaxResult && !syntaxResult.ok) return
    setRunning(true)
    setFormError(null)
    try {
      await onRun(script, name.trim() || t('editorNewTitle'))
    } finally {
      setRunning(false)
    }
  }

  const title =
    mode === 'edit'
      ? t('editorEditTitle')
      : mode === 'recorded'
        ? t('editorRecordedTitle')
        : t('editorNewTitle')

  const modal = (
    <div
      className="macro-modal-backdrop macro-modal-backdrop-editor"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving && !running) onClose()
      }}
    >
      <form
        className="macro-modal macro-modal-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={dir}
        data-testid="macro-editor-modal"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="macro-modal-head">
          <h2 id={titleId} className="macro-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="macro-modal-close"
            aria-label={t('closeBtn')}
            disabled={saving || running}
            onClick={onClose}
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="macro-modal-body">
          {skippedActions.length > 0 && (
            <div className="macro-banner macro-banner-warn" data-testid="macro-skipped-banner">
              <div className="macro-banner-title">
                {t('skippedActionsTitle', { count: skippedActions.length })}
              </div>
              <ul className="macro-skipped-list">
                {skippedActions.map((item, index) => (
                  <li key={`${item.commandId}-${index}`}>
                    {localizeSkippedCommandLabel(lang, item.commandId, item.label)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="macro-form-grid">
            <div className="macro-field">
              <label htmlFor={nameInputId} className="macro-field-label">
                {t('fieldName')}
              </label>
              <input
                id={nameInputId}
                type="text"
                className="macro-input"
                data-testid="macro-name-input"
                value={name}
                disabled={saving}
                placeholder={t('fieldNamePlaceholder')}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
              />
            </div>

            <div className="macro-field">
              <label htmlFor={slotSelectId} className="macro-field-label">
                {t('fieldShortcut')}
              </label>
              <select
                id={slotSelectId}
                className="macro-select"
                data-testid="macro-editor-slot-select"
                value={slot === null ? '' : String(slot)}
                disabled={saving}
                onChange={(event) => {
                  const val = event.target.value
                  setSlot(val === '' ? null : Number(val))
                }}
              >
                <option value="">{t('slotNone')}</option>
                {MACRO_SLOT_KEYS.map((key, index) => {
                  const slotNum = index + 1
                  const owner = slotOwners.get(slotNum)
                  return (
                    <option key={slotNum} value={String(slotNum)}>
                      {owner ? `Alt+${key} (${owner})` : `Alt+${key}`}
                    </option>
                  )
                })}
              </select>
            </div>
          </div>

          <div className="macro-field">
            <label htmlFor={descInputId} className="macro-field-label">
              {t('fieldDescription')}
            </label>
            <input
              id={descInputId}
              type="text"
              className="macro-input"
              data-testid="macro-description-input"
              value={description}
              disabled={saving}
              placeholder={t('fieldDescriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {aiEnabled && (
            <MacroAiAssistant
              lang={lang}
              onDraftScript={handleAiDraftScript}
              streamClient={aiStreamClient}
              settingsOverride={aiSettingsOverride}
              statusesOverride={aiStatusesOverride}
              storeOverride={aiStoreOverride}
            />
          )}

          <div className="macro-field">
            <label htmlFor={scriptInputId} className="macro-field-label">
              {t('fieldScript')}
            </label>
            <textarea
              id={scriptInputId}
              className="macro-textarea macro-script-textarea"
              data-testid="macro-script-input"
              value={script}
              disabled={saving}
              spellCheck={false}
              placeholder={t('fieldScriptPlaceholder')}
              onChange={(event) => {
                setScript(event.target.value)
                setFormError(null)
              }}
            />
          </div>

          {syntaxResult && !syntaxResult.ok && (
            <div
              className="macro-syntax-status macro-syntax-error"
              role="alert"
              data-testid="macro-syntax-error"
            >
              {t('syntaxError', {
                line: syntaxResult.line,
                column: syntaxResult.column,
                error: syntaxResult.error,
              })}
            </div>
          )}

          {syntaxResult && syntaxResult.ok && (
            <div className="macro-syntax-status macro-syntax-ok" data-testid="macro-syntax-ok">
              {t('syntaxOk')}
            </div>
          )}

          {formError && (
            <div className="macro-banner macro-banner-error" role="alert">
              {formError}
            </div>
          )}
        </div>

        <div className="macro-modal-foot macro-modal-foot-split">
          <div className="macro-modal-foot-group">
            {onRun && (
              <button
                type="button"
                className="macro-btn"
                data-testid="macro-editor-run-btn"
                disabled={
                  running ||
                  saving ||
                  script.trim().length === 0 ||
                  Boolean(syntaxResult && !syntaxResult.ok)
                }
                onClick={() => void handleRunClick()}
              >
                {t('editorRunBtn')}
              </button>
            )}
          </div>
          <div className="macro-modal-foot-group">
            <button
              type="button"
              className="macro-btn"
              disabled={saving || running}
              onClick={onClose}
            >
              {t('cancelBtn')}
            </button>
            <button
              type="submit"
              className="macro-btn macro-btn-primary"
              data-testid="macro-save-btn"
              disabled={disabled || saving || running}
            >
              {t('editorSaveBtn')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )

  return createPortal(modal, document.body)
}
