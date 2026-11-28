/**
 * Macro Manager modal for listing, running, recording, editing, assigning
 * shortcut slots (Alt+1..Alt+-), importing (.ieummacro), exporting, and deleting
 * app-wide Hangul macros.
 *
 * Security invariants:
 * - Corrupt, oversized, or unreadable store files display an error banner with
 *   the `.corrupt-<timestamp>` backup path and a Retry button, disabling all
 *   mutating store operations until resolved.
 * - Untrusted `.ieummacro` files picked for import are shown in a read-only
 *   preview displaying the ENTIRE raw script and any syntax check error
 *   `(line, column)`. Imported macros CANNOT be executed from the preview modal —
 *   only Save (`macrosCommitImport`) or Cancel.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { htmlDir, type Lang } from '@genoffice/i18n'
import { IconClose } from '@genoffice/ui/icons'
import { validateMacroSyntax } from '../../../studio-plugin/macro-interpreter.mjs'
import type { MacroHostResult } from '../../../studio-plugin/macro-host.mjs'
import { MACRO_SLOT_KEYS } from '../../../studio-plugin/macro-recorder.mjs'
import type {
  HwpApi,
  MacroImportPreview,
  MacroOrigin,
  MacroRecord,
  MacroStoreFailureReason,
} from '../../shared/ipc'
import { translateMacro, useMacroI18n, type MacroStringKey } from '../i18n/macro'
import { shortcutLabelForSlot, type MacroEditorDraft } from './MacroEditorModal'
import './macro-modal.css'

export type MacroStoreApi = Pick<
  HwpApi,
  | 'macrosReadState'
  | 'macrosAdd'
  | 'macrosUpdate'
  | 'macrosDelete'
  | 'macrosAssignSlot'
  | 'macrosPickImportFile'
  | 'macrosCommitImport'
  | 'macrosExportFile'
>

export interface MacroStoreErrorInfo {
  reason: MacroStoreFailureReason
  error: string
  corruptBackupPath?: string
  sizeBytes?: number
  maxBytes?: number
}

export interface MacroNearLimitInfo {
  sizeBytes: number
  maxBytes: number
}

export interface MacroEditorRequest {
  mode: 'new' | 'edit' | 'recorded'
  macro?: MacroRecord
  draft?: MacroEditorDraft
}

export interface MacroManagerModalProps {
  macros: readonly MacroRecord[]
  recording: boolean
  /** Optional IPC API override for tests; defaults to window.hwpApi. */
  api?: MacroStoreApi
  storeError?: MacroStoreErrorInfo | null
  nearLimit?: MacroNearLimitInfo | null
  onReloadStore?: () => void | Promise<void>
  onMacrosUpdated?: (macros: MacroRecord[]) => void
  onRunMacro: (macro: { name: string; script: string }) => Promise<MacroRunResult>
  onToggleRecording: () => void | Promise<void>
  onOpenEditor: (request: MacroEditorRequest) => void
  onClose: () => void
}

interface ManagerNotice {
  tone: 'info' | 'error' | 'warn'
  text: string
}

interface PendingImportState {
  fileName: string
  preview: MacroImportPreview
}

const ORIGIN_KEYS: Record<MacroOrigin, MacroStringKey> = {
  recorded: 'originRecorded',
  manual: 'originManual',
  ai: 'originAi',
  imported: 'originImported',
}

function isStoreFailureReason(reason: string): reason is MacroStoreFailureReason {
  return (
    reason === 'library_corrupt' ||
    reason === 'library_too_large' ||
    reason === 'library_read_error'
  )
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

const PREVIEW_HIDDEN_CONTROLS_RE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/g

/**
 * Replace hidden directional or zero-width control characters in an import
 * preview script with visible `[U+XXXX]` markers so spoofing characters cannot
 * hide in the read-only preview.
 */
export function formatPreviewScriptWithVisibleControls(script: string): {
  text: string
  hasHiddenControls: boolean
} {
  let hasHiddenControls = false
  const text = script.replace(PREVIEW_HIDDEN_CONTROLS_RE, (ch) => {
    hasHiddenControls = true
    const hex = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    return `[U+${hex}]`
  })
  return { text, hasHiddenControls }
}

export type MacroRunResult =
  | MacroHostResult
  | {
      ok: false
      code: string
      detail?: 'regex' | string
      error: string
      line?: number | null
      column?: number | null
      phase?: 'post_run'
      unsupportedAction?: string
      messages: string[]
      steps: number
      elapsedMs: number
    }

type MacroHostFailureView = Extract<MacroRunResult, { ok: false }> & {
  code: string
  detail?: 'regex' | string
  line?: number | null
  column?: number | null
  phase?: 'post_run' | string
}

/** Format a rejected macro execution exception into a localized error notice payload. */
export function formatMacroRunException(
  lang: Lang,
  error: unknown,
  options?: { whileRecording?: boolean },
): { tone: 'error'; text: string } {
  const message = error instanceof Error ? error.message : String(error)
  const text = translateMacro(lang, 'noticeMacroRunErrorNoLoc', { error: message })
  if (options?.whileRecording === true) {
    return {
      tone: 'error',
      text: `${text} · ${translateMacro(lang, 'noticeMacroRunNotRecorded')}`,
    }
  }
  return { tone: 'error', text }
}

/** Format a `MacroHostResult` (or plugin `unsupported_place` result) into a localized user-visible notice payload. */
export function formatMacroRunOutcome(
  lang: Lang,
  macroName: string,
  result: MacroRunResult,
  options?: { whileRecording?: boolean },
): { tone: 'info' | 'error'; text: string } {
  const withRecordingNote = (outcome: {
    tone: 'info' | 'error'
    text: string
  }): { tone: 'info' | 'error'; text: string } => {
    if (options?.whileRecording === true) {
      return {
        tone: outcome.tone,
        text: `${outcome.text} · ${translateMacro(lang, 'noticeMacroRunNotRecorded')}`,
      }
    }
    return outcome
  }

  if (result.ok) {
    if (result.messages.length > 0) {
      return withRecordingNote({
        tone: 'info',
        text: translateMacro(lang, 'noticeMacroMessages', {
          name: macroName,
          messages: result.messages.join(' · '),
        }),
      })
    }
    return withRecordingNote({
      tone: 'info',
      text: translateMacro(lang, 'noticeMacroRunSuccess', { name: macroName }),
    })
  }
  const failure = result as MacroHostFailureView
  if (failure.code === 'unsupported_place') {
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroOutsideBody'),
    })
  }
  if (failure.code === 'object_loss' || failure.code === 'memo_loss') {
    if (failure.line == null || failure.phase === 'post_run') {
      return withRecordingNote({
        tone: 'error',
        text: translateMacro(lang, 'noticeMacroRollbackObjectLossPostRun'),
      })
    }
    if (typeof failure.line === 'number' && failure.line > 0) {
      return withRecordingNote({
        tone: 'error',
        text: translateMacro(lang, 'noticeMacroRollbackObjectLossAt', {
          line: failure.line,
          column: failure.column ?? 1,
        }),
      })
    }
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroRollbackObjectLoss'),
    })
  }
  if (failure.code === 'unsupported_action' && failure.unsupportedAction) {
    if (typeof failure.line === 'number' && failure.line > 0) {
      return withRecordingNote({
        tone: 'error',
        text: translateMacro(lang, 'noticeMacroUnsupportedAction', {
          action: failure.unsupportedAction,
          line: failure.line,
          column: failure.column ?? 1,
        }),
      })
    }
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroRunErrorNoLoc', { error: failure.error }),
    })
  }
  if (
    (failure.code === 'time_limit' || failure.code === 'step_limit') &&
    failure.detail === 'regex'
  ) {
    if (typeof failure.line === 'number' && failure.line > 0) {
      return withRecordingNote({
        tone: 'error',
        text: translateMacro(lang, 'noticeMacroRegexTimeoutAt', {
          line: failure.line,
          column: failure.column ?? 1,
        }),
      })
    }
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroRegexTimeout'),
    })
  }
  if (failure.line == null && failure.phase === 'post_run') {
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroRunErrorPostRun', { error: failure.error }),
    })
  }
  if (typeof failure.line === 'number' && failure.line > 0) {
    return withRecordingNote({
      tone: 'error',
      text: translateMacro(lang, 'noticeMacroRunError', {
        line: failure.line,
        column: failure.column ?? 1,
        error: failure.error,
      }),
    })
  }
  return withRecordingNote({
    tone: 'error',
    text: translateMacro(lang, 'noticeMacroRunErrorNoLoc', { error: failure.error }),
  })
}

export function MacroManagerModal({
  macros,
  recording,
  api: apiOverride,
  storeError: storeErrorProp = null,
  nearLimit: nearLimitProp = null,
  onReloadStore,
  onMacrosUpdated,
  onRunMacro,
  onToggleRecording,
  onOpenEditor,
  onClose,
}: MacroManagerModalProps): ReactElement {
  const { lang, t } = useMacroI18n()
  const titleId = useId()
  const dir = htmlDir(lang)
  const api = apiOverride ?? (typeof window !== 'undefined' ? window.hwpApi : undefined)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ManagerNotice | null>(null)
  const [localStoreError, setLocalStoreError] = useState<MacroStoreErrorInfo | null>(null)
  const [localNearLimit, setLocalNearLimit] = useState<MacroNearLimitInfo | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null)

  const activeStoreError = storeErrorProp ?? localStoreError
  const activeNearLimit = activeStoreError ? null : (nearLimitProp ?? localNearLimit)
  const storeBlocked = activeStoreError !== null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      if (pendingImport) {
        setPendingImport(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, onClose, pendingImport])

  const applyStoreMeta = useCallback(
    (res: { sizeBytes?: number; maxBytes?: number; nearLimit?: boolean }) => {
      setLocalStoreError(null)
      if (res.nearLimit && typeof res.sizeBytes === 'number' && typeof res.maxBytes === 'number') {
        setLocalNearLimit({ sizeBytes: res.sizeBytes, maxBytes: res.maxBytes })
      } else if (res.nearLimit === false) {
        setLocalNearLimit(null)
      }
    },
    [],
  )

  const handleStoreFailure = useCallback(
    (res: {
      reason: string
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }): boolean => {
      if (isStoreFailureReason(res.reason)) {
        setLocalStoreError({
          reason: res.reason,
          error: res.error,
          corruptBackupPath: res.corruptBackupPath,
          sizeBytes: res.sizeBytes,
          maxBytes: res.maxBytes,
        })
        setLocalNearLimit(null)
        setPendingImport(null)
        return true
      }
      if (res.reason === 'too_large') {
        const actual = res.actualBytes ?? res.sizeBytes
        const text =
          actual !== undefined && res.maxBytes !== undefined
            ? t('errorStoreWriteTooLarge', {
                actual: formatByteSize(actual),
                max: formatByteSize(res.maxBytes),
              })
            : t('errorStoreWriteTooLargeGeneric')
        setNotice({ tone: 'error', text })
        return true
      }
      return false
    },
    [t],
  )

  const handleRetryStore = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      setLocalStoreError(null)
      if (onReloadStore) {
        await onReloadStore()
      } else if (api?.macrosReadState) {
        const res = await api.macrosReadState()
        if (res.ok) {
          onMacrosUpdated?.(res.macros)
          applyStoreMeta(res)
        } else if (res.reason !== 'unauthorized') {
          setLocalStoreError({
            reason: res.reason,
            error: res.error,
            corruptBackupPath: res.corruptBackupPath,
            sizeBytes: res.sizeBytes,
            maxBytes: res.maxBytes,
          })
        }
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRun = async (macro: MacroRecord): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await onRunMacro({ name: macro.name, script: macro.script })
      const outcome = formatMacroRunOutcome(lang, macro.name, result, {
        whileRecording: recording,
      })
      setNotice(outcome)
    } catch (error) {
      setNotice(formatMacroRunException(lang, error, { whileRecording: recording }))
    } finally {
      setBusy(false)
    }
  }

  const handleSlotChange = async (macro: MacroRecord, rawValue: string): Promise<void> => {
    if (busy || storeBlocked || !api?.macrosAssignSlot) return
    const nextSlot = rawValue === '' ? null : Number(rawValue)
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.macrosAssignSlot(macro.id, nextSlot)
      if (res.ok) {
        onMacrosUpdated?.(res.macros)
        applyStoreMeta(res)
        setNotice({
          tone: 'info',
          text:
            nextSlot === null
              ? t('noticeSlotCleared', { name: macro.name })
              : t('noticeSlotAssigned', {
                  name: macro.name,
                  shortcut: shortcutLabelForSlot(nextSlot),
                }),
        })
      } else if (!handleStoreFailure(res)) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (macro: MacroRecord): Promise<void> => {
    if (busy || storeBlocked || !api?.macrosDelete) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.macrosDelete(macro.id)
      if (res.ok) {
        onMacrosUpdated?.(res.macros)
        applyStoreMeta(res)
        setNotice({ tone: 'info', text: t('noticeMacroDeleted', { name: macro.name }) })
      } else if (!handleStoreFailure(res)) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (macro: MacroRecord): Promise<void> => {
    if (busy || !api?.macrosExportFile) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.macrosExportFile(macro.id)
      if (res.ok) {
        if (!res.canceled) {
          setNotice({ tone: 'info', text: t('noticeMacroExported', { name: macro.name }) })
        }
      } else if (!handleStoreFailure(res)) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handlePickImport = async (): Promise<void> => {
    if (busy || storeBlocked || !api?.macrosPickImportFile) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.macrosPickImportFile()
      if (res.ok) {
        if (!res.canceled) {
          setPendingImport({ fileName: res.fileName, preview: res.preview })
        }
      } else if (!handleStoreFailure(res)) {
        const text =
          res.reason === 'invalid_format'
            ? t('importErrorInvalidFormat')
            : res.reason === 'too_large'
              ? t('importErrorTooLarge')
              : t('errorActionFailed', { error: res.error })
        setNotice({ tone: 'error', text })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmImport = async (): Promise<void> => {
    if (!pendingImport || busy || storeBlocked || !api?.macrosCommitImport) return
    setBusy(true)
    setNotice(null)
    try {
      const { preview } = pendingImport
      const res = await api.macrosCommitImport({
        name: preview.name,
        ...(preview.description ? { description: preview.description } : {}),
        script: preview.script,
        slot: null,
      })
      if (res.ok) {
        onMacrosUpdated?.(res.macros)
        applyStoreMeta(res)
        setPendingImport(null)
        setNotice({ tone: 'info', text: t('noticeMacroImported', { name: res.macro.name }) })
      } else if (!handleStoreFailure(res)) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const importSyntax = useMemo(() => {
    if (!pendingImport) return null
    if (pendingImport.preview.syntax) return pendingImport.preview.syntax
    return validateMacroSyntax(pendingImport.preview.script)
  }, [pendingImport])

  const previewScriptView = useMemo(() => {
    if (!pendingImport) return null
    return formatPreviewScriptWithVisibleControls(pendingImport.preview.script)
  }, [pendingImport])

  const storeErrorBody = activeStoreError
    ? activeStoreError.reason === 'library_corrupt'
      ? t('storeErrorCorruptBody')
      : activeStoreError.reason === 'library_too_large'
        ? t('storeErrorTooLargeBody')
        : t('storeErrorReadBody')
    : null

  const modal = (
    <div
      className="macro-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="macro-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={dir}
        data-testid="macro-manager-modal"
      >
        <div className="macro-modal-head">
          <h2 id={titleId} className="macro-modal-title">
            {t('managerTitle')}
          </h2>
          <div className="macro-modal-head-actions">
            <button
              type="button"
              className="macro-btn macro-btn-primary macro-btn-compact"
              data-testid="macro-new-btn"
              disabled={busy || storeBlocked}
              onClick={() => onOpenEditor({ mode: 'new' })}
            >
              {t('newMacroBtn')}
            </button>
            <button
              type="button"
              className="macro-btn macro-btn-compact"
              data-testid="macro-import-btn"
              disabled={busy || storeBlocked}
              onClick={() => void handlePickImport()}
            >
              {t('importBtn')}
            </button>
            <button
              type="button"
              className={`macro-btn macro-btn-compact${recording ? ' macro-btn-danger' : ''}`}
              data-testid="macro-record-btn"
              disabled={busy}
              onClick={() => void onToggleRecording()}
            >
              {recording ? t('recordStopBtn') : t('recordStartBtn')}
            </button>
            <button
              type="button"
              className="macro-modal-close"
              aria-label={t('closeBtn')}
              disabled={busy}
              onClick={onClose}
            >
              <IconClose size={14} />
            </button>
          </div>
        </div>

        <div className="macro-modal-body">
          {activeStoreError && (
            <div
              className="macro-banner macro-banner-error"
              role="alert"
              data-testid="macro-store-error"
            >
              <div className="macro-banner-head">
                <span className="macro-banner-title">{t('storeErrorTitle')}</span>
                <button
                  type="button"
                  className="macro-btn macro-btn-compact"
                  data-testid="macro-store-retry-btn"
                  disabled={busy}
                  onClick={() => void handleRetryStore()}
                >
                  {t('storeRetryBtn')}
                </button>
              </div>
              <div>{storeErrorBody}</div>
              {activeStoreError.corruptBackupPath && (
                <>
                  <div className="macro-banner-hint">{t('storeErrorBackupNote')}</div>
                  <div className="macro-banner-path" data-testid="macro-store-backup-path">
                    {activeStoreError.corruptBackupPath}
                  </div>
                </>
              )}
              <p className="macro-banner-hint">{t('storeErrorDisabledHint')}</p>
            </div>
          )}

          {activeNearLimit && (
            <div className="macro-banner macro-banner-warn" data-testid="macro-near-limit">
              <div className="macro-banner-title">{t('storeNearLimitTitle')}</div>
              <div>
                {t('storeNearLimitBody', {
                  size: formatByteSize(activeNearLimit.sizeBytes),
                  max: formatByteSize(activeNearLimit.maxBytes),
                })}
              </div>
            </div>
          )}

          {notice && (
            <div
              className={`macro-banner ${
                notice.tone === 'error'
                  ? 'macro-banner-error'
                  : notice.tone === 'info'
                    ? 'macro-banner-info'
                    : 'macro-banner-warn'
              }`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
              data-testid="macro-notice"
            >
              {notice.text}
            </div>
          )}

          {/* Untrusted import preview: full raw read-only script, syntax check, NO Run button! */}
          {pendingImport && (
            <section className="macro-import-preview" data-testid="macro-import-preview">
              <div className="macro-banner-title">{t('importPreviewTitle')}</div>
              <p className="macro-banner-hint">{t('importPreviewWarning')}</p>
              <p className="macro-banner-hint" data-testid="macro-import-slot-hint">
                {t('importPreviewSlotHint')}
              </p>
              {previewScriptView?.hasHiddenControls && (
                <div
                  className="macro-banner macro-banner-warn"
                  role="alert"
                  data-testid="macro-import-bidi-warning"
                >
                  {t('importPreviewBidiWarning')}
                </div>
              )}
              <div className="macro-import-meta">
                <span className="macro-import-meta-label">{t('importPreviewName')}</span>
                <span>{pendingImport.preview.name}</span>
                {pendingImport.preview.description && (
                  <>
                    <span className="macro-import-meta-label">{t('importPreviewDesc')}</span>
                    <span>{pendingImport.preview.description}</span>
                  </>
                )}
              </div>
              <div className="macro-banner-hint">
                {t('importPreviewFile', { fileName: pendingImport.fileName })}
              </div>
              <div className="macro-field">
                <span className="macro-field-label">{t('importPreviewScript')}</span>
                <pre className="macro-import-script" data-testid="macro-import-script">
                  {previewScriptView?.text ?? pendingImport.preview.script}
                </pre>
              </div>
              {importSyntax && !importSyntax.ok && (
                <div
                  className="macro-syntax-status macro-syntax-error"
                  role="alert"
                  data-testid="macro-import-syntax-error"
                >
                  {t('importPreviewSyntaxError', {
                    line: importSyntax.line,
                    column: importSyntax.column,
                    error: importSyntax.error,
                  })}
                </div>
              )}
              {importSyntax && importSyntax.ok && (
                <div className="macro-syntax-status macro-syntax-ok">
                  {t('importPreviewSyntaxOk')}
                </div>
              )}
              <div className="macro-import-actions">
                <button
                  type="button"
                  className="macro-btn"
                  disabled={busy}
                  onClick={() => setPendingImport(null)}
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="button"
                  className="macro-btn macro-btn-primary"
                  data-testid="macro-import-confirm-btn"
                  disabled={busy || storeBlocked}
                  onClick={() => void handleConfirmImport()}
                >
                  {t('importConfirmBtn')}
                </button>
              </div>
            </section>
          )}

          {macros.length === 0 ? (
            <p className="macro-empty" data-testid="macro-empty">
              {t('emptyMacros')}
            </p>
          ) : (
            <div className="macro-list">
              {macros.map((macro) => (
                <div
                  key={macro.id}
                  className="macro-row"
                  data-testid="macro-row"
                  data-macro-name={macro.name}
                >
                  <div className="macro-row-info">
                    <div className="macro-row-title-line">
                      <span className="macro-row-name">{macro.name}</span>
                      <span
                        className={`macro-origin-badge${macro.origin === 'ai' ? ' macro-origin-badge-ai' : ''}`}
                      >
                        {t(ORIGIN_KEYS[macro.origin])}
                      </span>
                    </div>
                    {macro.description && (
                      <span className="macro-row-desc">{macro.description}</span>
                    )}
                  </div>
                  <div className="macro-row-controls">
                    <select
                      className="macro-select macro-select-compact"
                      aria-label={t('colShortcut')}
                      data-testid="macro-slot-select"
                      value={macro.slot === null ? '' : String(macro.slot)}
                      disabled={busy || storeBlocked}
                      onChange={(event) => void handleSlotChange(macro, event.target.value)}
                    >
                      <option value="">{t('slotNone')}</option>
                      {MACRO_SLOT_KEYS.map((key, index) => {
                        const slotNum = index + 1
                        return (
                          <option key={slotNum} value={String(slotNum)}>
                            Alt+{key}
                          </option>
                        )
                      })}
                    </select>
                    <button
                      type="button"
                      className="macro-btn macro-btn-primary macro-btn-compact"
                      data-testid="macro-run-btn"
                      disabled={busy}
                      onClick={() => void handleRun(macro)}
                    >
                      {t('runBtn')}
                    </button>
                    <button
                      type="button"
                      className="macro-btn macro-btn-compact"
                      data-testid="macro-edit-btn"
                      disabled={busy || storeBlocked}
                      onClick={() => onOpenEditor({ mode: 'edit', macro })}
                    >
                      {t('editBtn')}
                    </button>
                    <button
                      type="button"
                      className="macro-btn macro-btn-compact"
                      data-testid="macro-export-btn"
                      disabled={busy}
                      onClick={() => void handleExport(macro)}
                    >
                      {t('exportBtn')}
                    </button>
                    <button
                      type="button"
                      className="macro-btn macro-btn-danger macro-btn-compact"
                      data-testid="macro-delete-btn"
                      disabled={busy || storeBlocked}
                      onClick={() => void handleDelete(macro)}
                    >
                      {t('deleteBtn')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="macro-modal-foot">
          <button type="button" className="macro-btn" disabled={busy} onClick={onClose}>
            {t('closeBtn')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
