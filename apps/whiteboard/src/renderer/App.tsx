/**
 * Top-level Whiteboard app component wiring:
 * - WASM initialization & pending file open (`.whiteboard` or `.excalidraw*` import)
 * - Save / Save As / AutoSave / Close-save / Recovery copies
 * - Export (PNG / SVG / PDF) & Print
 * - In-app MCP queries (`read`, `apply`, `bytes`)
 * - AI panel visibility (`useAppChoice` + `aiVisible`) and handoff
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  aiVisible,
  printLayoutText,
  tweaksText,
  useAppChoice,
  useAutoSavePref,
  useSplitPaneFocusPing,
  VersionTimelineDrawer,
  versionTimelineText,
  type DrawerVersionEntry,
} from '@genoffice/ui'
import '@genoffice/ui/tweaks-panel.css'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import {
  VERSION_TIMELINE_BRIDGE_KEY,
  type VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'
import {
  commitWhiteboardTweaks,
  DEFAULT_WHITEBOARD_TWEAKS,
  resetWhiteboardTweaks,
  type WhiteboardTweaksState,
} from './tweaks/whiteboard-tweaks'
import { WhiteboardTweaksPanel } from './tweaks/WhiteboardTweaksPanel'
import { WhiteboardTimelineAdapter } from './timeline/whiteboard-timeline-adapter'
import type {
  ExportFormat,
  ExportPageImage,
  PrintPage,
  SaveMode,
  WhiteboardHandoff,
} from '../shared/ipc'
import { WhiteboardAiDock, useWhiteboardAiOpen } from './ai/AiDock'
import { WhiteboardEditor, type WhiteboardEditorMenuAction } from './components/WhiteboardEditor'
import { WhiteboardPrintDialog } from './PrintDialog'
import { WhiteboardSession } from './document/session'
import { renderPageToSvg, renderSvgToPngBytes } from './export/render-svg'
import { t as tGlobal, useI18n } from './i18n/locale'

const AUTO_SAVE_INTERVAL_MS = 30_000
const RECOVERY_INTERVAL_MS = 20_000
const TOAST_MS = 4000

export default function App(): ReactElement {
  const { lang, t } = useI18n()
  const appChoice = useAppChoice(window.aiOfficeEditorChoice)
  const showAi = aiVisible(appChoice)
  const [aiOpen, setAiOpen] = useWhiteboardAiOpen()
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const [tweaksState, setTweaksState] = useState<WhiteboardTweaksState>(DEFAULT_WHITEBOARD_TWEAKS)
  const tweaksBaselineRef = useRef<BoardDocument | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineEntries, setTimelineEntries] = useState<DrawerVersionEntry[]>([])

  const [session, setSession] = useState<WhiteboardSession | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [toast, setToast] = useState<string | null>(null)
  const [exportModalFormat, setExportModalFormat] = useState<ExportFormat | null>(null)
  const [printDialogState, setPrintDialogState] = useState<{ initialDestination?: string } | null>(
    null,
  )
  const printDialogOpen = printDialogState !== null
  const [presenting, setPresenting] = useState(false)
  const [handoff, setHandoff] = useState<WhiteboardHandoff | null>(null)
  const [menuCommand, setMenuCommand] = useState<{
    seq: number
    cmd: WhiteboardEditorMenuAction
  } | null>(null)

  const [autoSave, setAutoSave] = useAutoSavePref(
    'whiteboardapp.autoSave',
    window.whiteboardApi.core,
  )

  const sessionRef = useRef<WhiteboardSession | null>(null)
  sessionRef.current = session
  const aiOpenRef = useRef(aiOpen)
  aiOpenRef.current = aiOpen
  const savingRef = useRef(false)

  const timelineAdapter = useMemo(() => {
    const bridge = (window as unknown as Record<string, VersionTimelineBridge | undefined>)[
      VERSION_TIMELINE_BRIDGE_KEY
    ]
    const rawId = (session?.getDocument().id ?? 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_')
    const docKey = session?.getFilePath() || `whiteboard_${rawId}`
    return new WhiteboardTimelineAdapter(bridge, docKey, () => sessionRef.current)
  }, [session])
  const timelineAdapterRef = useRef(timelineAdapter)
  timelineAdapterRef.current = timelineAdapter

  const refreshTimeline = useCallback(() => {
    void timelineAdapterRef.current.list().then((items) => setTimelineEntries(items))
  }, [])

  useEffect(() => {
    if (timelineOpen) refreshTimeline()
  }, [timelineOpen, refreshTimeline])

  const openTweaks = useCallback(() => {
    const s = sessionRef.current
    if (s) tweaksBaselineRef.current = structuredClone(s.getDocument())
    setTweaksOpen(true)
  }, [])

  useSplitPaneFocusPing()

  const showToast = useCallback((msg: string) => {
    setToast(msg)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  // Initial pending document load + optional handoff.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const pending = await window.whiteboardApi.core.consumePending()
        if (!alive) return
        if (!pending.ok) {
          setLoadError(pending.error || t('failOpen'))
          return
        }
        let nextSession: WhiteboardSession
        if (pending.kind === 'whiteboard') {
          nextSession = WhiteboardSession.fromBytes(pending.bytes, {
            filePath: pending.filePath,
            initiallyDirty: Boolean(pending.restoredFromRecovery),
          })
        } else if (pending.kind === 'excalidraw') {
          nextSession = WhiteboardSession.fromBytes(pending.bytes, {
            filePath: null,
            importSourcePath: pending.sourcePath,
            importSummary: pending.summary,
            initiallyDirty: false,
          })
        } else if (pending.bytes) {
          nextSession = WhiteboardSession.fromBytes(pending.bytes, {
            filePath: null,
            initiallyDirty: Boolean(pending.restoredFromRecovery),
          })
        } else {
          nextSession = WhiteboardSession.createBlank('')
        }
        setSession(nextSession)
        const pendingHandoff = await window.whiteboardApi.handoff.take().catch(() => null)
        if (alive && pendingHandoff) {
          setHandoff(pendingHandoff)
          setAiOpen(true)
        }
      } catch (err) {
        if (!alive) return
        setLoadError(err instanceof Error ? err.message : t('failOpen'))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Report dirty state to shell.
  useEffect(() => {
    if (!session) return
    const sync = () => window.whiteboardApi.core.setDirty(session.isDirty())
    sync()
    return session.subscribe(sync)
  }, [session])

  // Save handler (2-step saveTarget -> save for atomic write & save-conflict guard).
  const performSave = useCallback(
    async (mode: SaveMode): Promise<boolean> => {
      const s = sessionRef.current
      if (!s || savingRef.current) return false
      savingRef.current = true
      setSaveStatus('saving')
      try {
        const target = await window.whiteboardApi.core.saveTarget({
          mode,
          suggestedName: s.getDocument().title || undefined,
          sourcePath: s.getImportSourcePath(),
        })
        if (!target.ok) {
          setSaveStatus('idle')
          return false
        }
        const serialized = await s.serializeForSave({ updateThumbnail: true })
        const saved = await window.whiteboardApi.core.save({
          token: target.token,
          mode,
          bytes: serialized.bytes,
          unchanged: serialized.unchanged,
        })
        if (!saved.ok) {
          setSaveStatus(saved.canceled ? 'idle' : 'failed')
          return false
        }
        s.markSaved(saved.filePath)
        setSaveStatus('saved')
        void timelineAdapterRef.current.record('save').then(() => refreshTimeline())
        return true
      } catch {
        setSaveStatus('failed')
        return false
      } finally {
        savingRef.current = false
      }
    },
    [refreshTimeline],
  )

  // Auto-save timer (only when already saved to disk and dirty).
  useEffect(() => {
    if (!autoSave) return
    const timer = window.setInterval(() => {
      const s = sessionRef.current
      if (s && s.isDirty() && s.getFilePath()) {
        void performSave('autosave')
      }
    }, AUTO_SAVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [autoSave, performSave])

  // Periodic recovery copy when dirty.
  const writeRecoveryNow = useCallback(async () => {
    const s = sessionRef.current
    if (!s || !s.isDirty()) return
    const { bytes } = await s.serializeForSave({ updateThumbnail: false })
    await window.whiteboardApi.recovery.writeRecoveryCopy({
      bytes,
      title: s.getDocument().title || tGlobal('untitled'),
      originalPath: s.getFilePath(),
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void writeRecoveryNow()
    }, RECOVERY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [writeRecoveryNow])

  // Export & Print helpers.
  const buildPrintPages = useCallback(
    (s: WhiteboardSession, scope: 'all' | 'current'): PrintPage[] => {
      const doc = s.getDocument()
      const pages =
        scope === 'current' ? doc.pages.filter((p) => p.id === s.getActivePageId()) : doc.pages
      const urls = s.getAllResourceDataUrls()
      const out: PrintPage[] = []
      for (const page of pages) {
        const r = renderPageToSvg(doc, page.id, urls)
        if (!r) continue
        out.push({
          svg: r.svg,
          width: r.width,
          height: r.height,
          pageWidth: r.width,
          pageHeight: r.height,
        })
      }
      return out
    },
    [],
  )

  const handleExport = useCallback(
    async (format: ExportFormat, scope: 'all' | 'current') => {
      const s = sessionRef.current
      if (!s) return
      const doc = s.getDocument()
      const suggestedName = doc.title || tGlobal('untitled')
      try {
        if (format === 'pdf') {
          const pages = buildPrintPages(s, scope)
          const res = await window.whiteboardApi.exporting.exportPdf({ suggestedName, pages })
          if (!res.ok && !res.canceled) {
            showToast(tGlobal('exportFailed', { error: res.error ?? 'unknown error' }))
          }
          return
        }
        const targetPages =
          scope === 'current'
            ? doc.pages
                .map((p, i) => ({ page: p, number: i + 1 }))
                .filter((x) => x.page.id === s.getActivePageId())
            : doc.pages.map((p, i) => ({ page: p, number: i + 1 }))
        const urls = s.getAllResourceDataUrls()
        const encoder = new TextEncoder()
        const pages: ExportPageImage[] = []
        for (const item of targetPages) {
          const r = renderPageToSvg(doc, item.page.id, urls)
          if (!r) continue
          if (format === 'svg') {
            pages.push({ number: item.number, bytes: encoder.encode(r.svg) })
          } else {
            const png = await renderSvgToPngBytes(r.svg, r.width, r.height)
            if (png) pages.push({ number: item.number, bytes: png.bytes })
          }
        }
        const res = await window.whiteboardApi.exporting.exportImages({
          format,
          suggestedName,
          pages,
          singlePage: scope === 'current',
        })
        if (!res.ok && !res.canceled) {
          showToast(tGlobal('exportFailed', { error: res.error ?? 'unknown error' }))
        }
      } catch (err) {
        showToast(
          tGlobal('exportFailed', { error: err instanceof Error ? err.message : String(err) }),
        )
      }
    },
    [buildPrintPages, showToast],
  )

  const handlePrint = useCallback((initialDestination?: string) => {
    if (!sessionRef.current) return
    setPrintDialogState({ initialDestination })
  }, [])

  const handleQuickPrint = useCallback(
    async (printerLabel: string) => {
      const s = sessionRef.current
      if (!s) return
      showToast(printLayoutText(lang, 'quickPrintSending', { printer: printerLabel }))
      const pages = buildPrintPages(s, 'all')
      const title = s.getDocument().title || tGlobal('untitled')
      const result = await window.whiteboardApi.exporting.printLayout.print({
        options: createDefaultOptions(),
        editor: { pages, title },
        job: { deviceName: '', copies: 1, collate: true, duplex: 'simplex' },
      })
      if (result.ok) {
        showToast(printLayoutText(lang, 'quickPrintSent', { printer: printerLabel }))
      } else if (!('aborted' in result)) {
        showToast(tGlobal('printFailed', { error: result.error }))
      }
    },
    [buildPrintPages, lang, showToast],
  )

  // Subscribe to shell IPC events (save, close-save, export, print, menu, recovery, MCP queries).
  useEffect(() => {
    const unsubs = [
      window.whiteboardApi.core.onSaveRequest((mode) => {
        void performSave(mode).then((ok) => window.whiteboardApi.core.sendSaveRequestAck(ok))
      }),
      window.whiteboardApi.core.onCloseSaveRequest(() => {
        void performSave('save').then((ok) => window.whiteboardApi.core.sendCloseSaveResult(ok))
      }),
      window.whiteboardApi.core.onFileRenamed((newPath) => {
        sessionRef.current?.setFilePath(newPath)
      }),
      window.whiteboardApi.exporting.onExportRequest((format) => {
        setExportModalFormat(format)
      }),
      window.whiteboardApi.exporting.onPrintRequest(() => {
        void handlePrint()
      }),
      window.whiteboardApi.core.onMenuCommand((cmd) => {
        if (cmd === 'undo') sessionRef.current?.undo()
        else if (cmd === 'redo') sessionRef.current?.redo()
        else if (cmd === 'present') setPresenting((v) => !v)
        else if (cmd === 'toggle-ai') setAiOpen(!aiOpenRef.current)
        else if (
          cmd === 'import-pdf' ||
          cmd === 'zoom-in' ||
          cmd === 'zoom-out' ||
          cmd === 'zoom-fit'
        ) {
          setMenuCommand((prev) => ({ seq: (prev?.seq ?? 0) + 1, cmd }))
        }
      }),
      window.whiteboardApi.recovery.onRecoveryCopyNow(() => {
        void writeRecoveryNow().finally(() => {
          window.whiteboardApi.recovery.sendRecoveryCopyNowDone()
        })
      }),
      window.whiteboardApi.queries.onReadRequest((q) => {
        const s = sessionRef.current
        if (!s) {
          window.whiteboardApi.queries.sendReadResult({ id: q.id, error: 'whiteboard not ready' })
          return
        }
        void (q.current || q.page ? s.readPage(q.page) : s.readBoard()).then((table) => {
          if (!table) {
            window.whiteboardApi.queries.sendReadResult({ id: q.id, error: 'page not found' })
          } else {
            window.whiteboardApi.queries.sendReadResult({ id: q.id, text: table.text, table })
          }
        })
      }),
      window.whiteboardApi.queries.onApplyRequest((q) => {
        const s = sessionRef.current
        if (!s) {
          window.whiteboardApi.queries.sendApplyResult({ id: q.id, error: 'whiteboard not ready' })
          return
        }
        if (q.template) {
          void s.applyTemplate(q.template).then((res) => {
            if (!res.ok) {
              window.whiteboardApi.queries.sendApplyResult({ id: q.id, error: res.error.message })
            } else {
              window.whiteboardApi.queries.sendApplyResult({ id: q.id, result: res.result })
            }
          })
          return
        }
        void s.applyOps(q.ops ?? [], { defaultPageId: q.defaultPageId }).then((res) => {
          if (!res.ok) {
            const msg =
              res.failures?.map((f) => f.error?.message ?? 'edit failed').join('; ') ||
              'edit failed'
            window.whiteboardApi.queries.sendApplyResult({ id: q.id, error: msg })
          } else {
            window.whiteboardApi.queries.sendApplyResult({ id: q.id, result: res })
          }
        })
      }),
      window.whiteboardApi.queries.onBytesRequest(() => {
        const s = sessionRef.current
        if (!s) {
          window.whiteboardApi.queries.sendBytesResult({ ok: false, error: 'whiteboard not ready' })
          return
        }
        void s
          .serializeForSave({ updateThumbnail: false })
          .then(({ bytes }) => window.whiteboardApi.queries.sendBytesResult({ ok: true, bytes }))
          .catch((err) =>
            window.whiteboardApi.queries.sendBytesResult({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
      }),
    ]
    return () => {
      for (const u of unsubs) u()
    }
  }, [handlePrint, performSave, setAiOpen, writeRecoveryNow])

  if (loadError) {
    return (
      <div className="wb-error-view" role="alert">
        <h2>{t('failOpen')}</h2>
        <p>{loadError}</p>
      </div>
    )
  }

  if (!session) {
    return <div className="wb-error-view">{t('loading')}</div>
  }

  return (
    <div className="wb-app">
      <WhiteboardEditor
        session={session}
        saveStatus={saveStatus}
        autoSave={autoSave}
        onToggleAutoSave={() => setAutoSave(!autoSave)}
        onExport={(fmt, scope) => void handleExport(fmt, scope)}
        onPrint={(dest) => handlePrint(dest)}
        onQuickPrint={handleQuickPrint}
        listPrinters={window.whiteboardApi?.exporting?.printLayout?.listPrinters}
        quickPrintPrefStore={window.whiteboardApi?.exporting?.printLayout}
        exportModalFormat={exportModalFormat}
        onCloseExportModal={() => setExportModalFormat(null)}
        onOpenExportModal={(fmt) => setExportModalFormat(fmt)}
        presenting={presenting}
        onSetPresenting={setPresenting}
        onToast={showToast}
        menuCommand={menuCommand}
      />
      {showAi && (
        <WhiteboardAiDock
          host={session}
          filePath={session.getFilePath()}
          open={aiOpen}
          setOpen={setAiOpen}
          handoff={handoff}
          onHandoffConsumed={() => setHandoff(null)}
          onOpenTweaks={openTweaks}
          onAiDoneRecord={(summary) =>
            void timelineAdapterRef.current
              .record('ai', { promptSummary: summary })
              .then(() => refreshTimeline())
          }
        />
      )}
      <div className="wb-noai-tools" role="group">
        <button
          type="button"
          className="ieum-tweaks-btn"
          onClick={() => (tweaksOpen ? setTweaksOpen(false) : openTweaks())}
        >
          {tweaksText(lang, 'title')}
        </button>
        <button
          type="button"
          className="ieum-tweaks-btn"
          onClick={() => setTimelineOpen((v) => !v)}
        >
          {versionTimelineText(lang, 'title')}
        </button>
      </div>
      {tweaksOpen && (
        <WhiteboardTweaksPanel
          lang={lang}
          value={tweaksState}
          onChange={(next) => {
            setTweaksState(next)
            const base = tweaksBaselineRef.current ?? session.getDocument()
            commitWhiteboardTweaks(session, base, next)
          }}
          onReset={() => {
            setTweaksState(DEFAULT_WHITEBOARD_TWEAKS)
            if (tweaksBaselineRef.current) {
              resetWhiteboardTweaks(session, tweaksBaselineRef.current)
            }
          }}
          onClose={() => setTweaksOpen(false)}
        />
      )}
      <VersionTimelineDrawer
        open={timelineOpen}
        lang={lang}
        entries={timelineEntries}
        onSaveCheckpoint={async (label) => {
          await timelineAdapterRef.current.record('checkpoint', { label })
          refreshTimeline()
        }}
        onRestore={async (entry) => {
          await timelineAdapterRef.current.restore(entry.id)
          refreshTimeline()
        }}
        onDelete={async (entry) => {
          await timelineAdapterRef.current.deleteEntry(entry.id)
          refreshTimeline()
        }}
        onClose={() => setTimelineOpen(false)}
      />
      {printDialogOpen && (
        <WhiteboardPrintDialog
          api={window.whiteboardApi}
          title={session.getDocument().title || tGlobal('untitled')}
          initialDestination={printDialogState?.initialDestination}
          buildPages={(scope) => buildPrintPages(session, scope)}
          onClose={() => setPrintDialogState(null)}
          onMessage={showToast}
        />
      )}
      {toast && (
        <div className="wb-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
