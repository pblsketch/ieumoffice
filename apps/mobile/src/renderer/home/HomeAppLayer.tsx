// The T6 app layer, drawn once by App above every screen: it puts the home runtime in place, asks
// before a file opens in an editor that is off, takes files other apps send while the app runs,
// shows the receive screen, the read-only strip with [Edit a copy], the first-run guide, "what's
// new" once after an update, and the first-use tips (spec 3.8–3.10, 3.12–3.14).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IncomingBatch } from '@genoffice/mobile-bridge/home'
import { isMobileCommandError, type MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { EditorKind } from '../editors/editorKind'
import { findEditorKind } from '../editors/registry'
import { useMobileLocale } from '../i18n'
import { useAppInfo } from '../settings/sections/settingsHooks'
import { editorLabel } from '../settings/sections/homeSettingsModel'
import { HomeConfirmDialog } from './actions'
import { setEditorOffHandler } from './editorGate'
import {
  markWhatsNewSeen,
  WHATS_NEW_ENTRIES,
  whatsNewToShow,
  type WhatsNewEntry,
} from './help/whatsNew'
import { WhatsNewSheet } from './help/WhatsNewSheet'
import type { HomeHost } from './homeHost'
import { setActiveDocKey, setHomeRuntime, sessionOrigin } from './homeRuntime'
import { subscribeIncomingBatches, takeIncomingDocument, takeQueuedIncomingBatch } from './incoming'
import { FirstRunOverlay } from './layer/FirstRunOverlay'
import { ReadOnlyStrip } from './layer/ReadOnlyStrip'
import { ReceiveScreen } from './layer/ReceiveScreen'
import { TipLayer } from './layer/TipLayer'
import { ensureLoaded, setEditorOn, updateHomePrefs, useHomePrefs } from './prefsStore'

export type HomeAppScreen = 'home' | 'editor' | 'settings'

/** What the layer needs of the open document. */
export interface HomeAppDoc {
  readonly session: MobileDocSession
  readonly encrypted: boolean
  readonly distribution: boolean
  readonly isUntitled: boolean
}

export interface HomeAppLayerProps {
  readonly host: HomeHost
  readonly screen: HomeAppScreen
  readonly activeDoc: HomeAppDoc | null
  readonly mode: DocumentMode
}

interface EditorOffAsk {
  readonly kind: EditorKind
  readonly resolve: (open: boolean) => void
}

function isFormatNotOpenable(err: unknown): boolean {
  return isMobileCommandError(err) && err.messageKey === 'mobile.format.notOpenable'
}

export function HomeAppLayer({ host, screen, activeDoc, mode }: HomeAppLayerProps) {
  const { t } = useMobileLocale()
  const { prefs, loaded } = useHomePrefs()
  const client = host.client
  const info = useAppInfo(client)
  const hostRef = useRef(host)
  hostRef.current = host

  // --- runtime -------------------------------------------------------------------------------
  useEffect(() => {
    setHomeRuntime(host)
  }, [host])
  useEffect(() => () => setHomeRuntime(null), [])
  useEffect(() => {
    void ensureLoaded(client)
  }, [client])
  const docKey = activeDoc?.session.docKey ?? null
  useEffect(() => {
    setActiveDocKey(docKey)
  }, [docKey])

  // --- editor that is off: ask before opening (spec 3.10) ---------------------------------------
  const [ask, setAsk] = useState<EditorOffAsk | null>(null)
  const askRef = useRef<EditorOffAsk | null>(null)
  askRef.current = ask
  const [turningOn, setTurningOn] = useState(false)
  useEffect(
    () =>
      setEditorOffHandler(
        (kind) =>
          new Promise<boolean>((resolve) => {
            // a newer question replaces an unanswered one, which stays closed
            askRef.current?.resolve(false)
            const next = { kind, resolve }
            askRef.current = next
            setAsk(next)
          }),
      ),
    [],
  )
  const answerAsk = useCallback(
    async (open: boolean) => {
      const current = ask
      if (!current || turningOn) return
      if (!open) {
        setAsk(null)
        current.resolve(false)
        return
      }
      setTurningOn(true)
      try {
        await setEditorOn(current.kind.id, true, hostRef.current.client)
        setAsk(null)
        current.resolve(true)
      } catch {
        setAsk(null)
        current.resolve(false)
        hostRef.current.showToast({ message: t('homeActFailed'), tone: 'error' })
      } finally {
        setTurningOn(false)
      }
    },
    [ask, turningOn, t],
  )

  // --- files other apps send (spec 3.8) ----------------------------------------------------
  const [batch, setBatch] = useState<IncomingBatch | null>(null)
  const pullBatch = useCallback(() => {
    setBatch((current) => current ?? takeQueuedIncomingBatch())
  }, [])
  useEffect(() => {
    pullBatch()
    return subscribeIncomingBatches(pullBatch)
  }, [pullBatch])
  const closeBatch = useCallback(() => {
    setBatch(null)
    // the next waiting batch, if any
    setTimeout(pullBatch, 0)
  }, [pullBatch])

  // App takes what is waiting at start; files sent while the app runs are taken when it comes back.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const current = hostRef.current
      takeIncomingDocument(current.client).then(
        (session) => (session ? current.openSession(session) : undefined),
        (err: unknown) => {
          if (isFormatNotOpenable(err)) {
            current.showToast({ message: t('formatNotOpenable'), tone: 'error' })
          }
        },
      )
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [t])

  // Opening a document from the receive screen (or from a tool's result) closes it.
  const openSessionId = activeDoc?.session.sessionId ?? null
  const receiveBaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!batch) return
    receiveBaseRef.current = openSessionId
    // only when a batch arrives; later document changes are compared against it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch])
  useEffect(() => {
    if (batch && openSessionId !== null && openSessionId !== receiveBaseRef.current) closeBatch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionId])

  // --- read-only strip (spec 3.9) ---------------------------------------------------------
  const [stripClosedFor, setStripClosedFor] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const kind = activeDoc ? findEditorKind(activeDoc.session.format) : null
  const showStrip =
    screen === 'editor' &&
    mode === 'view' &&
    activeDoc !== null &&
    !activeDoc.session.writable &&
    !activeDoc.isUntitled &&
    !activeDoc.encrypted &&
    !activeDoc.distribution &&
    !!kind?.editable &&
    stripClosedFor !== activeDoc.session.sessionId
  const editCopy = useCallback(async () => {
    const doc = activeDoc
    const current = hostRef.current
    if (!doc || copying || !current.openUntitledCopy) return
    setCopying(true)
    try {
      const { bytesBase64 } = await current.client.readFileBytes(doc.session.sessionId)
      await current.openUntitledCopy({
        format: doc.session.format,
        name: doc.session.name,
        bytesBase64,
      })
    } catch {
      current.showToast({ message: t('homeActFailed'), tone: 'error' })
    } finally {
      setCopying(false)
    }
  }, [activeDoc, copying, t])

  // --- first run (spec 3.13) --------------------------------------------------------------
  // closed in this run even if saving fails; opens again when Help sets the field back to false
  const [firstRunClosed, setFirstRunClosed] = useState(false)
  useEffect(() => {
    if (prefs.firstRunDone) setFirstRunClosed(false)
  }, [prefs.firstRunDone])
  const showFirstRun = screen === 'home' && loaded && !prefs.firstRunDone && !firstRunClosed
  const finishFirstRun = useCallback(() => {
    setFirstRunClosed(true)
    void updateHomePrefs({ firstRunDone: true }, hostRef.current.client).catch(() => {})
  }, [])

  // --- what's new, once on the home after an update (spec 3.12) -------------------------------
  const [whatsNew, setWhatsNew] = useState<readonly WhatsNewEntry[] | null>(null)
  const whatsNewCheckedRef = useRef(false)
  useEffect(() => {
    if (whatsNewCheckedRef.current) return
    if (screen !== 'home' || !loaded || !prefs.firstRunDone) return
    const lastSeen = prefs.lastSeenVersion
    // a missing field reads as the current version: nothing to show or write
    if (lastSeen === null) {
      whatsNewCheckedRef.current = true
      return
    }
    if (!info) return
    whatsNewCheckedRef.current = true
    if (lastSeen === info.version) return
    const entries = whatsNewToShow(lastSeen, info.version, WHATS_NEW_ENTRIES)
    if (entries.length > 0) setWhatsNew(entries)
    void markWhatsNewSeen(info.version, hostRef.current.client).catch(() => {})
  }, [screen, loaded, prefs.firstRunDone, prefs.lastSeenVersion, info])

  // --- tips (spec 3.14) -------------------------------------------------------------------
  const tipsActive =
    screen === 'editor' && activeDoc !== null && batch === null && ask === null && !showFirstRun

  const askName = ask ? editorLabel(ask.kind, t) : ''
  return (
    <>
      {showStrip && activeDoc && (
        <ReadOnlyStrip
          origin={sessionOrigin(activeDoc.session.sessionId)}
          busy={copying}
          onEditCopy={() => void editCopy()}
          onClose={() => setStripClosedFor(activeDoc.session.sessionId)}
        />
      )}
      <TipLayer active={tipsActive} mode={mode} client={client} />
      {batch && <ReceiveScreen key={batch.id} batch={batch} host={host} onClose={closeBatch} />}
      {showFirstRun && (
        <FirstRunOverlay
          client={client}
          onFinish={finishFirstRun}
          showToast={(input) => hostRef.current.showToast(input)}
        />
      )}
      <WhatsNewSheet
        open={whatsNew !== null && screen === 'home'}
        entries={whatsNew ?? []}
        onClose={() => setWhatsNew(null)}
      />
      <HomeConfirmDialog
        open={ask !== null}
        title={t('homeRunEditorOffTitle', { name: askName })}
        message={t('homeRunEditorOffBody')}
        confirmLabel={t('homeRunEditorOffConfirm')}
        platform={info?.platform ?? 'other'}
        onConfirm={() => void answerAsk(true)}
        onCancel={() => void answerAsk(false)}
        testId="home-run-editor-off"
      />
    </>
  )
}
