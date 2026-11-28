// The receive screen (track T6, spec 3.8): files another app sent at once (several, or a picture).
// All PDFs → [Merge], all pictures → [Make PDF] (T3's tools, only with PDF tools on and linked);
// documents that open get [Open] on their row.
import { useEffect, useMemo, useRef, useState } from 'react'
import { openIncomingEntry, type IncomingBatch } from '@genoffice/mobile-bridge/home'
import { IconBack } from '../../components/MobileIcons'
import { findEditorKind } from '../../editors/registry'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import {
  buildPdfToolStart,
  HomeFileRow,
  homeActErrorKeyOf,
  HomeSelectionBar,
  HomeSelectionHeader,
  incomingFileItem,
  isPdfItem,
  isPictureItem,
  useHomeFileActions,
  useHomeSelection,
  type HomeFileItem,
} from '../actions'
import { HomeToolFlowLayer } from '../frame/HomeToolFlowLayer'
import type { HomeHost } from '../homeHost'
import { markSessionOrigin } from '../homeRuntime'
import { usePdfToolsLink, type PdfToolStart } from '../pdfToolsLink'
import { PDF_TOOLS_ID, setEditorOn, useHomePrefs } from '../prefsStore'
import './layer.css'

function opens(item: HomeFileItem): boolean {
  return !!item.format && findEditorKind(item.format) !== null
}

export interface ReceiveScreenProps {
  readonly batch: IncomingBatch
  readonly host: HomeHost
  readonly onClose: () => void
}

export function ReceiveScreen({ batch, host, onClose }: ReceiveScreenProps) {
  const { t } = useMobileLocale()
  const { isEditorOn } = useHomePrefs()
  const link = usePdfToolsLink()
  const [flowStart, setFlowStart] = useState<PdfToolStart | null>(null)
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const items = useMemo(
    () => batch.entries.map((entry) => incomingFileItem(batch.id, entry)),
    [batch],
  )
  const selection = useHomeSelection(items)
  const actions = useHomeFileActions({
    listKind: 'incoming',
    host,
    onChanged: () => {},
    onOpenPdfTool: setFlowStart,
    onStartSelect: (item) => selection.start(item.key),
    onSelectionDone: selection.clear,
  })

  useBackLayer(true, onClose)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const toolKind: 'merge' | 'imagesToPdf' | null =
    items.length > 0 && items.every(isPdfItem)
      ? 'merge'
      : items.length > 0 && items.every(isPictureItem)
        ? 'imagesToPdf'
        : null
  const pdfOn = isEditorOn(PDF_TOOLS_ID)
  const toolOffered = toolKind !== null && link !== null
  const anyOpens = items.some(opens)

  const openItem = async (item: HomeFileItem) => {
    if (busy || item.fileRef.kind !== 'incoming') return
    setBusy(true)
    try {
      const session = await openIncomingEntry(host.client, batch.id, item.fileRef.entryId)
      markSessionOrigin(session.sessionId, 'received')
      await host.openSession(session)
    } catch (err) {
      const key = homeActErrorKeyOf(err)
      if (key) host.showToast({ message: t(key), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const turnPdfToolsOn = async () => {
    try {
      await setEditorOn(PDF_TOOLS_ID, true, host.client)
    } catch {
      host.showToast({ message: t('homeActFailed'), tone: 'error' })
    }
  }

  return (
    <div
      className="home-run-receive"
      role="dialog"
      aria-modal="true"
      aria-label={t('homeRunReceiveTitle')}
      data-testid="home-run-receive"
    >
      {selection.selecting ? (
        <HomeSelectionHeader count={selection.selectedKeys.length} onClose={selection.clear} />
      ) : (
        <header className="home-run-receive-header">
          <button
            type="button"
            className="mobile-icon-btn"
            data-testid="home-run-receive-close"
            aria-label={t('homeRunReceiveClose')}
            title={t('homeRunReceiveClose')}
            onClick={onClose}
          >
            <IconBack size={22} />
          </button>
          <h2 ref={headingRef} tabIndex={-1} className="home-run-receive-title">
            {t('homeRunReceiveTitle')}
          </h2>
          <span className="home-run-receive-count">
            {t('homeRunReceiveCount', { count: items.length })}
          </span>
        </header>
      )}

      <div className="home-run-receive-body">
        {toolOffered && pdfOn && toolKind && (
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary home-run-receive-tool"
            data-testid={`home-run-receive-${toolKind}`}
            onClick={() => setFlowStart(buildPdfToolStart(toolKind, items, host.client))}
          >
            {toolKind === 'merge' ? t('homeActMerge') : t('homeActImagesToPdf')}
          </button>
        )}
        {toolOffered && !pdfOn && (
          <div className="home-run-receive-off" role="status" data-testid="home-run-receive-off">
            <span>{t('homeRunReceivePdfOff')}</span>
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-ghost"
              data-testid="home-run-receive-pdf-on"
              onClick={() => void turnPdfToolsOn()}
            >
              {t('homeRunReceivePdfOn')}
            </button>
          </div>
        )}
        {!anyOpens && !toolOffered && (
          <p className="mobile-muted" role="status" data-testid="home-run-receive-not-openable">
            {t('formatNotOpenable')}
          </p>
        )}

        <ul className="mobile-doc-list" data-testid="home-run-receive-list">
          {items.map((item) => (
            <HomeFileRow
              key={item.key}
              item={item}
              selecting={selection.selecting}
              selected={selection.isSelected(item.key)}
              onOpen={() => {
                if (opens(item)) void openItem(item)
                else selection.start(item.key)
              }}
              onToggleSelect={() => selection.toggle(item.key)}
              onStartSelect={() => selection.start(item.key)}
              onOpenMenu={() => actions.openRowMenu(item)}
              footer={
                opens(item) && !selection.selecting ? (
                  <div className="home-run-receive-row-actions">
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-ghost"
                      data-testid={`home-run-receive-open-${item.key}`}
                      disabled={busy}
                      onClick={() => void openItem(item)}
                    >
                      {t('homeRunReceiveOpen')}
                    </button>
                  </div>
                ) : undefined
              }
            />
          ))}
        </ul>
      </div>

      {selection.selecting && (
        <HomeSelectionBar
          listKind="incoming"
          items={selection.selectedItems}
          onAction={(action) => actions.runBulk(action, selection.selectedItems)}
        />
      )}
      {actions.element}
      {flowStart && link && (
        <HomeToolFlowLayer
          link={link}
          host={host}
          start={flowStart}
          onClose={() => setFlowStart(null)}
        />
      )}
    </div>
  )
}
