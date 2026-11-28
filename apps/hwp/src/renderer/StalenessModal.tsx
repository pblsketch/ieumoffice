/**
 * Accessible theme-token modal prompting the user when stale blocks (such as TOC or
 * Index) are detected before manual save, print, PDF export, or submission-copy save.
 *
 * Also handles the follow-up confirmation step when refreshing encounters manual edits
 * inside a generated block, allowing the user to overwrite or skip.
 */
import { useEffect, useId, useRef } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { htmlDir, type Lang } from '@genoffice/i18n'
import { IconClose } from '@genoffice/ui/icons'
import type { StalenessManualEdit } from '../../studio-plugin/staleness.mjs'
import { translateSubmission, type SubmissionStringKey } from './i18n/submission'
import type { StaleCheckItem, StalenessAction, StalenessPromptChoice } from './save-flow'

export type StalenessModalState =
  | {
      phase: 'stale'
      action: StalenessAction
      items: StaleCheckItem[]
      initialManualEdits?: StalenessManualEdit[]
      busy: boolean
      onChoice: (choice: StalenessPromptChoice) => void
    }
  | {
      phase: 'manual'
      action: StalenessAction
      manualItems: StalenessManualEdit[]
      busy: boolean
      onDecide: (overwrite: boolean) => void
    }

const KIND_KEYS: Record<string, SubmissionStringKey> = {
  body: 'staleKindTocBody',
  table: 'staleKindTocTable',
  figure: 'staleKindTocFigure',
  equation: 'staleKindTocEquation',
  index: 'staleKindIndex',
  bibliography: 'staleKindBibliography',
}

const REASON_KEYS: Record<string, SubmissionStringKey> = {
  pages_changed: 'staleReasonPagesChanged',
  entries_changed: 'staleReasonEntriesChanged',
}

const ACTION_KEYS: Record<StalenessAction, SubmissionStringKey> = {
  save: 'staleActionSave',
  saveAs: 'staleActionSave',
  print: 'staleActionPrint',
  pdf: 'staleActionPdf',
  submission: 'staleActionSubmission',
}

/** Resolve a localized display name for a stale item or manual-edit item. */
export function staleItemLabel(lang: Lang, item: Pick<StaleCheckItem, 'kind' | 'label'>): string {
  const key = KIND_KEYS[item.kind]
  if (key) return translateSubmission(lang, key)
  if (item.label && item.label.trim().length > 0) return item.label
  return item.kind
}

/** Resolve a localized reason string for a stale item. */
export function staleReasonLabel(lang: Lang, reason: string): string {
  const key = REASON_KEYS[reason]
  return key ? translateSubmission(lang, key) : reason
}

export interface StalenessModalProps {
  lang: Lang
  state: StalenessModalState
  dismissLabel: string
}

export function StalenessModal({ lang, state, dismissLabel }: StalenessModalProps): ReactElement {
  const titleId = useId()
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null)
  const dir = htmlDir(lang)

  useEffect(() => {
    primaryBtnRef.current?.focus()
  }, [state.phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || state.busy) return
      event.preventDefault()
      event.stopPropagation()
      if (state.phase === 'stale') state.onChoice('cancel')
      else state.onDecide(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [state])

  const closeAction = (): void => {
    if (state.busy) return
    if (state.phase === 'stale') state.onChoice('cancel')
    else state.onDecide(false)
  }

  const actionLabel = translateSubmission(lang, ACTION_KEYS[state.action])

  const modal = (
    <div
      className="stale-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAction()
      }}
    >
      <div
        className="stale-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={dir}
      >
        <div className="stale-modal-head">
          <div className="stale-modal-title-wrap">
            <span id={titleId} className="stale-modal-title">
              {state.phase === 'stale'
                ? translateSubmission(lang, 'staleDialogTitle')
                : translateSubmission(lang, 'staleManualConfirmTitle')}
            </span>
            <span className="stale-modal-badge">{actionLabel}</span>
          </div>
          <button
            type="button"
            className="stale-modal-close"
            aria-label={dismissLabel}
            disabled={state.busy}
            onClick={closeAction}
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="stale-modal-body">
          {state.phase === 'stale' ? (
            <>
              <p className="stale-modal-message">{translateSubmission(lang, 'staleDialogBody')}</p>
              <ul className="stale-modal-list">
                {state.items.map((item) => (
                  <li key={item.id} className="stale-modal-item">
                    <span className="stale-modal-item-name">{staleItemLabel(lang, item)}</span>
                    <span className="stale-modal-item-reason">
                      {staleReasonLabel(lang, item.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="stale-modal-message">
              {translateSubmission(lang, 'staleManualConfirmBody', {
                items: state.manualItems.map((entry) => staleItemLabel(lang, entry)).join(', '),
              })}
            </p>
          )}
        </div>

        <div className="stale-modal-foot">
          {state.phase === 'stale' ? (
            <>
              <button
                type="button"
                className="stale-modal-btn"
                disabled={state.busy}
                onClick={() => state.onChoice('cancel')}
              >
                {translateSubmission(lang, 'staleBtnCancel')}
              </button>
              <button
                type="button"
                className="stale-modal-btn"
                disabled={state.busy}
                onClick={() => state.onChoice('continue')}
              >
                {translateSubmission(lang, 'staleBtnContinue')}
              </button>
              <button
                ref={primaryBtnRef}
                type="button"
                className="stale-modal-btn stale-modal-btn-primary"
                disabled={state.busy}
                onClick={() => state.onChoice('refresh')}
              >
                {translateSubmission(lang, 'staleBtnRefreshAll')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="stale-modal-btn"
                disabled={state.busy}
                onClick={() => state.onDecide(false)}
              >
                {translateSubmission(lang, 'staleManualSkip')}
              </button>
              <button
                ref={primaryBtnRef}
                type="button"
                className="stale-modal-btn stale-modal-btn-primary"
                disabled={state.busy}
                onClick={() => state.onDecide(true)}
              >
                {translateSubmission(lang, 'staleManualOverwrite')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
