import React, { useEffect, useId, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { placeholderSource } from '@genoffice/agent-core/redact-core'
import { sensitiveKindName } from '@genoffice/agent-core/sensitive-kinds'
import { sensitiveFeatureName, sensitiveInfoText } from './strings-sensitive-info'
import type { SensitiveInfoStringKey } from './strings-sensitive-info'
import {
  hideableCandidateIds,
  sensitiveCandidateSummary,
  type SensitiveCandidateRow,
  type SensitiveUnhideableReason,
} from './sensitive-candidates'
import { sensitiveSendCountsOf, type SensitiveSendCounts } from './sensitive-send-check'
import { useRedactLabelField } from './use-redact-label'
import { useModalKeys } from './modal-keys'
import './sensitive-info.css'

/**
 * The shared screen parts of "hide sensitive info". Every editor mounts the
 * same ones: the button that opens the candidate list, the list itself, the
 * alert before a tab's first send and the label dialog. None of them hides
 * anything; they report what was pressed and the editor does the work.
 */

const REASON_KEYS: Readonly<Record<SensitiveUnhideableReason, SensitiveInfoStringKey>> = {
  'memo-overlap': 'reasonMemoOverlap',
  'header-footer': 'reasonHeaderFooter',
  note: 'reasonNote',
  'memo-text': 'reasonMemoText',
  distribution: 'reasonDistribution',
  'sheet-name': 'reasonSheetName',
  'chart-title': 'reasonChartTitle',
  'cell-note': 'reasonCellNote',
  unsupported: 'reasonUnsupported',
}

/** "This spot can't be hidden", with the reason when there is one */
export function sensitiveUnhideableText(
  lang: Lang,
  row: Pick<SensitiveCandidateRow, 'reason' | 'reasonText'>,
): string {
  const reason = row.reason
    ? sensitiveInfoText(lang, REASON_KEYS[row.reason])
    : row.reasonText?.trim()
  return reason
    ? sensitiveInfoText(lang, 'unhideableBecause', { reason })
    : sensitiveInfoText(lang, 'unhideable')
}

/** The "N memos are added, and whoever gets the document sees them" line of a word processor */
export function sensitiveMemoNote(lang: Lang, count: number): string {
  return sensitiveInfoText(lang, 'memoNote', { n: count })
}

/** "Find sensitive info": opens the candidate list. Busy while the editor is still finding. */
export function SensitiveFindButton({
  lang,
  onClick,
  busy = false,
  disabled = false,
  className = 'gs-sens-find',
}: {
  readonly lang: Lang
  readonly onClick: () => void
  readonly busy?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {sensitiveInfoText(lang, busy ? 'findBusy' : 'findButton')}
    </button>
  )
}

export interface SensitiveCandidateListProps {
  readonly lang: Lang
  readonly candidates: readonly SensitiveCandidateRow[]
  /** still finding: the rows are not shown yet */
  readonly busy?: boolean | undefined
  /** candidates found in this request's attachments; adds "open that file to hide them" */
  readonly attachmentCount?: number | undefined
  /** a word processor: "hide all" says how many memos it adds and that recipients see them */
  readonly memoNote?: boolean | undefined
  /** hide these spots (one row, or every row that can be hidden) */
  readonly onConfirm: (ids: string[]) => void
  /** never suggest this spot again; the editor remembers it */
  readonly onExclude: (id: string) => void
  /** show the spot in the document; the context becomes a button when given */
  readonly onLocate?: ((id: string) => void) | undefined
  readonly onClose?: (() => void) | undefined
  readonly className?: string | undefined
}

function CandidateRow({
  lang,
  row,
  onConfirm,
  onExclude,
  onLocate,
}: {
  lang: Lang
  row: SensitiveCandidateRow
  onConfirm: (ids: string[]) => void
  onExclude: (id: string) => void
  onLocate?: ((id: string) => void) | undefined
}): React.JSX.Element {
  const context = (
    <>
      {row.before}
      <mark className="gs-sens-value">{row.value}</mark>
      {row.after}
    </>
  )
  return (
    <li className="gs-sens-row" data-id={row.id} data-hideable={row.hideable ? 'true' : 'false'}>
      <div className="gs-sens-row-head">
        <span className="gs-sens-kind">{sensitiveKindName(row.kind, lang)}</span>
        <span className="gs-sens-loc">{row.location}</span>
      </div>
      {onLocate ? (
        <button
          type="button"
          className="gs-sens-context"
          title={sensitiveInfoText(lang, 'locate')}
          onClick={() => onLocate(row.id)}
        >
          {context}
        </button>
      ) : (
        <div className="gs-sens-context">{context}</div>
      )}
      {row.hideable ? (
        <div className="gs-sens-label" title={sensitiveInfoText(lang, 'labelTitle')}>
          {placeholderSource(row.label)}
        </div>
      ) : (
        <div className="gs-sens-unhideable">
          <span>{sensitiveUnhideableText(lang, row)}</span>{' '}
          <span className="gs-sens-dim">{sensitiveInfoText(lang, 'unhideableHint')}</span>
        </div>
      )}
      <div className="gs-sens-actions">
        <button
          type="button"
          className="gs-sens-btn primary"
          disabled={!row.hideable}
          onClick={() => {
            if (row.hideable) onConfirm([row.id])
          }}
        >
          {sensitiveInfoText(lang, 'confirm')}
        </button>
        <button type="button" className="gs-sens-btn" onClick={() => onExclude(row.id)}>
          {sensitiveInfoText(lang, 'exclude')}
        </button>
      </div>
    </li>
  )
}

/**
 * The candidate list. Rows that cannot be hidden are shown and counted, with
 * their confirm button off. Nothing changes in the document until a confirm
 * button is pressed; "hide all" asks once before it confirms several rows.
 */
export function SensitiveCandidateList({
  lang,
  candidates,
  busy = false,
  attachmentCount = 0,
  memoNote = false,
  onConfirm,
  onExclude,
  onLocate,
  onClose,
  className,
}: SensitiveCandidateListProps): React.JSX.Element {
  const titleId = useId()
  const [askingAll, setAskingAll] = useState(false)
  const summary = sensitiveCandidateSummary(candidates)
  const ids = hideableCandidateIds(candidates)
  const attachments = sensitiveSendCountsOf({ documentCount: 0, attachmentCount }).attachmentCount

  useEffect(() => {
    if (ids.length < 2) setAskingAll(false)
  }, [ids.length])

  const hideAll = () => {
    if (ids.length === 0) return
    if (ids.length === 1) onConfirm(ids)
    else setAskingAll(true)
  }

  return (
    <section
      className={className ? `gs-sens-list ${className}` : 'gs-sens-list'}
      aria-labelledby={titleId}
    >
      <div className="gs-sens-head">
        <h3 id={titleId} className="gs-sens-title">
          {sensitiveInfoText(lang, 'listTitle')}
        </h3>
        {onClose && (
          <button type="button" className="gs-sens-btn" onClick={onClose}>
            {sensitiveInfoText(lang, 'close')}
          </button>
        )}
      </div>
      {!busy && summary.total > 0 && (
        <p className="gs-sens-count">
          <span>{sensitiveInfoText(lang, 'listCount', { n: summary.total })}</span>
          {summary.unhideable > 0 && (
            <span>
              {' · '}
              {sensitiveInfoText(lang, 'listUnhideableCount', { n: summary.unhideable })}
            </span>
          )}
        </p>
      )}
      <p className="gs-sens-note">{sensitiveInfoText(lang, 'listRulesNote')}</p>
      {attachments > 0 && (
        <p className="gs-sens-note gs-sens-attachments">
          {sensitiveInfoText(lang, 'attachmentsHint', { n: attachments })}
        </p>
      )}
      {busy ? (
        <p className="gs-sens-empty" aria-busy="true">
          {sensitiveInfoText(lang, 'findBusy')}
        </p>
      ) : candidates.length === 0 ? (
        <p className="gs-sens-empty">{sensitiveInfoText(lang, 'listEmpty')}</p>
      ) : (
        <>
          <ul className="gs-sens-rows">
            {candidates.map((row) => (
              <CandidateRow
                key={row.id}
                lang={lang}
                row={row}
                onConfirm={onConfirm}
                onExclude={onExclude}
                onLocate={onLocate}
              />
            ))}
          </ul>
          {askingAll ? (
            <div className="gs-sens-ask" role="group">
              <p className="gs-sens-ask-text">
                {sensitiveInfoText(lang, 'confirmAllAsk', { n: ids.length })}
              </p>
              {memoNote && <p className="gs-sens-note">{sensitiveMemoNote(lang, ids.length)}</p>}
              <div className="gs-sens-actions">
                <button
                  type="button"
                  className="gs-sens-btn primary"
                  onClick={() => {
                    setAskingAll(false)
                    onConfirm(ids)
                  }}
                >
                  {sensitiveInfoText(lang, 'confirmAll')}
                </button>
                <button type="button" className="gs-sens-btn" onClick={() => setAskingAll(false)}>
                  {sensitiveInfoText(lang, 'cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="gs-sens-actions gs-sens-foot">
              <button
                type="button"
                className="gs-sens-btn"
                disabled={ids.length === 0}
                onClick={hideAll}
              >
                {sensitiveInfoText(lang, 'confirmAll')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** "Looks like sensitive info: N in this document, M in attachments" */
export function sensitiveSendCountText(lang: Lang, counts: SensitiveSendCounts): string {
  const { documentCount, attachmentCount } = sensitiveSendCountsOf(counts)
  return attachmentCount > 0
    ? sensitiveInfoText(lang, 'alertCountsAttachments', {
        doc: documentCount,
        att: attachmentCount,
      })
    : sensitiveInfoText(lang, 'alertCounts', { doc: documentCount })
}

export interface SensitiveSendAlertProps {
  readonly lang: Lang
  readonly counts: SensitiveSendCounts
  /** the chosen provider runs on this PC: the sentence says "the AI on this PC" */
  readonly localAi?: boolean | undefined
  /** send nothing, keep the composer text, open the candidate list */
  readonly onReview: () => void
  readonly onSend: () => void
}

/**
 * The alert before a tab's first send. "Review" is the first button and takes
 * focus, so a stray Enter never sends.
 */
export function SensitiveSendAlert({
  lang,
  counts,
  localAi = false,
  onReview,
  onSend,
}: SensitiveSendAlertProps): React.JSX.Element {
  const titleId = useId()
  const textId = useId()
  const reviewRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    reviewRef.current?.focus()
  }, [])
  return (
    <section
      className="gs-sens-alert"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
    >
      <h3 id={titleId} className="gs-sens-title">
        {sensitiveInfoText(lang, 'alertTitle')}
      </h3>
      <div id={textId}>
        <p className="gs-sens-alert-counts">{sensitiveSendCountText(lang, counts)}</p>
        <p className="gs-sens-alert-body">
          {sensitiveInfoText(lang, localAi ? 'alertBodyLocal' : 'alertBody')}
        </p>
      </div>
      <p className="gs-sens-dim">{sensitiveInfoText(lang, 'alertOnce')}</p>
      <div className="gs-sens-actions">
        <button ref={reviewRef} type="button" className="gs-sens-btn primary" onClick={onReview}>
          {sensitiveInfoText(lang, 'alertReview')}
        </button>
        <button type="button" className="gs-sens-btn" onClick={onSend}>
          {sensitiveInfoText(lang, 'alertSend')}
        </button>
      </div>
    </section>
  )
}

export interface SensitiveLabelDialogProps {
  readonly lang: Lang
  /** the selected text, offered as a starting label */
  readonly seed: string
  readonly onSubmit: (label: string) => void
  readonly onCancel: () => void
  /** a word processor: how many memos this adds; the note shows when more than one */
  readonly memoCount?: number | undefined
}

/**
 * The label dialog of "hide sensitive info" for an editor without its own
 * modal chrome. The behaviour is `useRedactLabelField`; editors that keep their
 * own dialog use the same hook and the same words (`sensitiveFeatureName`,
 * `sensitiveInfoText(lang, 'featureDesc')`).
 */
export function SensitiveLabelDialog({
  lang,
  seed,
  onSubmit,
  onCancel,
  memoCount = 0,
}: SensitiveLabelDialogProps): React.JSX.Element {
  const field = useRedactLabelField(seed, onSubmit, onCancel)
  const keys = useModalKeys(onCancel)
  const titleId = useId()
  const name = sensitiveFeatureName(lang)
  return (
    <div
      ref={keys.ref}
      className="gs-sens-mask"
      onKeyDown={keys.onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="gs-sens-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="gs-sens-dialog-title">
          {name}
        </h2>
        <p className="gs-sens-dialog-desc">{sensitiveInfoText(lang, 'featureDesc')}</p>
        <p className="gs-sens-dim">{sensitiveInfoText(lang, 'dialogLabelHint')}</p>
        <div className="gs-sens-label" title={sensitiveInfoText(lang, 'labelTitle')}>
          {field.marker}
        </div>
        <input
          ref={field.inputRef}
          className="gs-sens-input"
          value={field.value}
          maxLength={field.maxLength}
          placeholder={sensitiveInfoText(lang, 'dialogPlaceholder')}
          aria-label={sensitiveInfoText(lang, 'dialogPlaceholder')}
          onChange={(e) => field.setValue(e.target.value)}
          onKeyDown={(e) => {
            field.onKeyDown(e)
            // the field already cancelled; the backdrop must not cancel a second time
            if (e.key === 'Escape') e.stopPropagation()
          }}
        />
        {memoCount > 1 && <p className="gs-sens-note">{sensitiveMemoNote(lang, memoCount)}</p>}
        <div className="gs-sens-actions">
          <button type="button" className="gs-sens-btn" onClick={onCancel}>
            {sensitiveInfoText(lang, 'cancel')}
          </button>
          <button
            type="button"
            className="gs-sens-btn primary"
            disabled={field.empty}
            onClick={() => onSubmit(field.label)}
          >
            {sensitiveInfoText(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
