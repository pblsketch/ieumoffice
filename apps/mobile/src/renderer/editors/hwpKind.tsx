import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PRODUCT_NAME } from '@genoffice/i18n'
import {
  createMobileHwpApi,
  type MobileHwpApi,
  type MobileHwpEditorPort,
} from '@genoffice/mobile-bridge/hwp'
import {
  isMobileCommandError,
  type MobileDocFormat,
  type MobileDocSession,
} from '@genoffice/mobile-bridge/transport'
import { wrapSkillWithViewEditGate } from '@genoffice/mobile-bridge/view-edit-gate'
import type { DocumentProfile, Place } from '@genoffice/doc-rules'
import { DocCheckSheet } from '../components/DocCheckSheet'
import { MemoSheet } from '../components/MemoSheet'
import { IconFlowView, IconPageView } from '../components/MobileIcons'
import { PageNumberSheet } from '../components/PageNumberSheet'
import { translateMobile } from '../i18n'
import type { MobileStringKey } from '../i18n/strings'
import { rememberedLayout, rememberLayout } from '../shell/layoutMemory'
import {
  EditorShell,
  type EditorFormatGroup,
  type EditorQuickActionItem,
} from '../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorKind, EditorWorkspaceProps } from './editorKind'
import type { FlowFormatAction, FlowMemo } from './flowEditing'
import { createFlowSyncedPort } from './flowSyncedPort'
import { HwpFlowView, type HwpFlowViewHandle } from './HwpFlowView'
import { HwpMobileEditor, type HwpMobileEditorHandle, type HwpQuickAction } from './HwpMobileEditor'
import {
  applyPageNumber,
  readPageNumber,
  type PageNumberDocument,
  type PageNumberSetting,
} from './pageNumbers'
import { pickImageFile, readPicture } from './pickPicture'
import { openFlowDocument, releaseRhwpEngine } from './rhwpEngine'

/** The engine calls a whole-document change uses. */
type WholeDocument = PageNumberDocument & {
  exportHwp(): Uint8Array
  exportHwpx(): Uint8Array
  free(): void
}

/** Text scale of the HWP flow view (document sizes are in pt). */
const FLOW_ZOOM_DEFAULT = 1.2
const FLOW_ZOOM_MIN = 0.8
const FLOW_ZOOM_MAX = 2.4
const FLOW_ZOOM_STEP = 0.15

/** The flow view's text scale, as before one value for the whole app: the next document keeps it. */
let lastFlowZoom = FLOW_ZOOM_DEFAULT

/**
 * A failed save check, as before one flag for the whole app: it stays set until a
 * save succeeds, also when another document is opened in between.
 */
let hwpVerifyFailed = false
function setHwpVerifyFailed(next: boolean): void {
  hwpVerifyFailed = next
}

/** Values of one open document that outlive its Workspace (unmounted on the settings screen). */
interface HwpKeptState {
  readonly hwpBytes: Uint8Array | null
  readonly flowBytes: Uint8Array | null
  // HWP reading layout: reflowed "flow" view or the page editor (design system 5.3).
  readonly hwpLayout: 'page' | 'flow'
  // Mount rhwp-studio lazily so reading in flow view does not spin up a second 28 MB WASM engine.
  readonly studioMounted: boolean
  readonly flowZoom: number
}

function createKeptState<T extends object>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: (): T => value,
    set(patch: Partial<T>): void {
      value = { ...value, ...patch }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const hwpEditorKind: EditorKind = {
  id: 'hwp',
  formats: ['hwp', 'hwpx'],
  openExtensions: ['hwp', 'hwpx'],
  createFormats: ['hwp', 'hwpx'],
  editable: true,
  hasAi: true,
  recoveryFormat: (format: MobileDocFormat) => format,
  async open({ session, client, isUntitled, recoveryBytesBase64 }) {
    const hwpApi = createMobileHwpApi(client)
    const opened = recoveryBytesBase64
      ? {
          bytes: Uint8Array.from(atob(recoveryBytesBase64), (c) => c.charCodeAt(0)),
          trackingDropped: false,
          encrypted: false,
          distribution: false,
        }
      : isUntitled
        ? {
            bytes: new Uint8Array(),
            trackingDropped: false,
            encrypted: false,
            distribution: false,
          }
        : await hwpApi.readDocument(session)
    return {
      encrypted: opened.encrypted,
      distribution: opened.distribution,
      trackingDropped: opened.trackingDropped,
      noticeKey: opened.trackingDropped ? 'hwpTrackingDroppedNotice' : null,
      start: (host) => startHwpDocument(host, hwpApi, session, opened.bytes),
    }
  },
}

function startHwpDocument(
  host: EditorHost,
  hwpApi: MobileHwpApi,
  openedSession: MobileDocSession,
  openedBytes: Uint8Array,
): EditorDocument {
  const tNow = host.translate
  const showToast = host.showToast
  const setNoticeBanner = host.setNotice
  const refreshHomeData = host.refreshHome

  // The session of this document as App's active document has it; this object
  // lives only while the document is the active one.
  let currentSession = openedSession
  const activeDocRef = {
    get current(): { readonly session: MobileDocSession } | null {
      return { session: currentSession }
    },
  }
  const updateSessionMetadata = (meta: {
    session: MobileDocSession
    dirty: boolean
    isUntitled: boolean
  }) => {
    currentSession = meta.session
    host.updateSession(meta)
  }

  const initialLayout: 'page' | 'flow' =
    rememberedLayout(window.localStorage, openedSession.docKey) ??
    (host.windowClass() === 'compact' || host.windowClass() === 'medium' ? 'flow' : 'page')

  const kept = createKeptState<HwpKeptState>({
    hwpBytes: openedBytes,
    flowBytes: openedBytes,
    // The layout last chosen for this document; otherwise phones and small tablets
    // read in the flow view and larger windows keep the page.
    hwpLayout: initialLayout,
    // Mount studio immediately for page view or blank untitled documents; defer in flow view.
    studioMounted: initialLayout === 'page' || openedBytes.byteLength === 0,
    flowZoom: lastFlowZoom,
  })
  const setHwpLayout = (hwpLayout: 'page' | 'flow') => kept.set({ hwpLayout })
  const setFlowZoom = (next: (zoom: number) => number) => {
    lastFlowZoom = next(kept.get().flowZoom)
    kept.set({ flowZoom: lastFlowZoom })
  }

  const hwpEditorRef: { current: HwpMobileEditorHandle | null } = { current: null }
  const flowRef: { current: HwpFlowViewHandle | null } = { current: null }
  const studioEditedRef = { current: false }
  let studioReady = false
  let studioWaiters: Array<{
    resolve: (ed: HwpMobileEditorHandle) => void
    reject: (err: Error) => void
  }> = []
  const resolveStudioWaiters = (ed: HwpMobileEditorHandle) => {
    const list = studioWaiters
    studioWaiters = []
    for (const waiter of list) waiter.resolve(ed)
  }
  const rejectStudioWaiters = (err: Error) => {
    const list = studioWaiters
    studioWaiters = []
    for (const waiter of list) waiter.reject(err)
  }
  const hwpLayoutRef = {
    get current(): 'page' | 'flow' {
      return kept.get().hwpLayout
    },
  }
  const suppressStudioDirtyRef = { current: false }
  const flowRefreshTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }

  /** Snapshots flow edits into kept bytes so later studio mounts or flow-only saves see them. */
  const snapshotCurrentBytes = (format: 'hwp' | 'hwpx'): Uint8Array => {
    const flow = flowRef.current
    if (flow?.hasPendingEdits()) {
      const exported = flow.takeBytes(format)
      if (exported) {
        kept.set({ hwpBytes: exported, flowBytes: exported })
        return exported
      }
    }
    return kept.get().hwpBytes ?? new Uint8Array()
  }

  /** Lightweight port backed by flow/kept bytes when rhwp-studio has not been mounted yet. */
  const flowOnlyPort = (flags: {
    readonly encrypted: boolean
    readonly distribution: boolean
  }): MobileHwpEditorPort => ({
    async isPasswordProtected() {
      return flags.encrypted || flags.distribution
    },
    async exportHwp() {
      return snapshotCurrentBytes('hwp')
    },
    async exportHwpx() {
      return snapshotCurrentBytes('hwpx')
    },
    async exportHwpVerify() {
      throw new Error('HWP verification requires the page editor.')
    },
    async measureTabs() {
      return []
    },
    async getPlainText() {
      return ''
    },
    async replaceText() {
      return false
    },
    async notifySaved() {},
  })

  /** Mounts rhwp-studio on demand (e.g. for .hwp verify save, DocCheck, or AI from flow view). */
  const ensureStudioMounted = (): Promise<HwpMobileEditorHandle> => {
    if (studioReady && hwpEditorRef.current) {
      return Promise.resolve(hwpEditorRef.current)
    }
    const doc = activeDocRef.current
    if (doc && flowRef.current?.hasPendingEdits()) {
      snapshotCurrentBytes(doc.session.format === 'hwpx' ? 'hwpx' : 'hwp')
    }
    if (!kept.get().studioMounted) {
      kept.set({ studioMounted: true })
    }
    return new Promise<HwpMobileEditorHandle>((resolve, reject) => {
      studioWaiters.push({ resolve, reject })
    })
  }

  /** Hands edits made in the flow view to the page editor (the one save/share/AI read). */
  const flushFlowToStudio = async () => {
    const flow = flowRef.current
    const studio = hwpEditorRef.current
    const doc = activeDocRef.current
    if (!flow || !studio || !doc || !flow.hasPendingEdits()) return
    const bytes = flow.takeBytes(doc.session.format === 'hwpx' ? 'hwpx' : 'hwp')
    if (!bytes) return
    kept.set({ hwpBytes: bytes, flowBytes: bytes })
    suppressStudioDirtyRef.current = true
    try {
      await studio.loadBytes(bytes)
    } finally {
      suppressStudioDirtyRef.current = false
    }
  }

  /** The page editor's port, after any pending flow edits have been handed over. */
  const hwpPort = createFlowSyncedPort(() => hwpEditorRef.current?.getSavePort(), flushFlowToStudio)

  /** Rebuilds the flow view from the page editor after it changed the document. */
  const refreshFlowFromStudio = () => {
    const doc = activeDocRef.current
    const port = hwpEditorRef.current?.getSavePort()
    if (!doc || !port || (doc.session.format !== 'hwp' && doc.session.format !== 'hwpx')) return
    studioEditedRef.current = false
    try {
      const exportBytes = doc.session.format === 'hwpx' ? port.exportHwpx() : port.exportHwp()
      void exportBytes
        .then((bytes) => {
          kept.set({ hwpBytes: bytes, flowBytes: bytes })
        })
        .catch(() => {
          // Keep the last flow; the page view still shows the edits.
        })
    } catch {
      // Keep the last flow when the studio is reloading or unmounted.
    }
  }

  const switchHwpLayout = async (next: 'page' | 'flow') => {
    const doc = activeDocRef.current
    if (next === 'page') {
      if (studioReady && hwpEditorRef.current) {
        await flushFlowToStudio()
      } else if (doc && flowRef.current?.hasPendingEdits()) {
        snapshotCurrentBytes(doc.session.format === 'hwpx' ? 'hwpx' : 'hwp')
      }
      kept.set({ hwpLayout: 'page', studioMounted: true })
    } else {
      if (studioEditedRef.current) {
        refreshFlowFromStudio()
        setHwpLayout('flow')
      } else {
        // Release the page studio iframe when returning to reading view with no studio edits.
        studioReady = false
        kept.set({ hwpLayout: 'flow', studioMounted: false })
      }
    }
    if (doc) rememberLayout(window.localStorage, doc.session.docKey, next)
  }

  // HWP / HWPX save pipeline
  const saveDocumentInternal: NonNullable<EditorDocument['save']> = async (
    doc,
    forceSaveAs = false,
  ) => {
    const { session } = doc
    const flags = { encrypted: doc.encrypted, distribution: doc.distribution }
    const targetFormat: 'hwp' | 'hwpx' =
      forceSaveAs && hwpVerifyFailed ? 'hwpx' : session.format === 'hwpx' ? 'hwpx' : 'hwp'
    let port: MobileHwpEditorPort
    if (studioReady && hwpEditorRef.current) {
      port = hwpPort
    } else if (targetFormat === 'hwpx') {
      port = flowOnlyPort(flags)
    } else {
      try {
        await ensureStudioMounted()
      } catch {
        return false
      }
      port = hwpPort
    }
    const suggestedName =
      targetFormat === 'hwpx' && session.name.toLowerCase().endsWith('.hwp')
        ? `${session.name.slice(0, -4)}.hwpx`
        : session.name
    const outcome =
      forceSaveAs || !session.writable || session.ephemeral
        ? await hwpApi.saveAsDocument(session, suggestedName, targetFormat, port, flags)
        : await hwpApi.saveDocument(session, port, flags)

    if (outcome.kind === 'saved') {
      setHwpVerifyFailed(false)
      if (outcome.session) {
        updateSessionMetadata({
          session: outcome.session,
          dirty: false,
          isUntitled: false,
        })
      } else {
        host.markDirty(false)
      }
      showToast(tNow('savedNotice'))
      await refreshHomeData()
      return true
    }

    if (outcome.reason === 'protected') {
      setNoticeBanner(tNow('hwpProtectedSaveError'))
    } else if (outcome.reason === 'verify') {
      setHwpVerifyFailed(true)
      setNoticeBanner(tNow('hwpVerifyFailedPrompt'))
    } else if (outcome.reason === 'backup-failed') {
      setNoticeBanner(tNow('hwpBackupFailedError'))
    } else if (outcome.reason === 'read-only') {
      setNoticeBanner(tNow('readonlyShareNotice'))
      if (!forceSaveAs) return saveDocumentInternal(doc, true)
    }
    return false
  }

  const handleHwpDirty = () => {
    if (suppressStudioDirtyRef.current) return
    studioEditedRef.current = true
    host.markDirty(true)
    // the page editor changed while the flow is on screen (e.g. AI): follow it
    if (hwpLayoutRef.current === 'flow') {
      if (flowRefreshTimerRef.current) clearTimeout(flowRefreshTimerRef.current)
      flowRefreshTimerRef.current = setTimeout(refreshFlowFromStudio, 500)
    }
  }

  const handleFlowEdit = () => {
    host.markDirty(true)
  }

  const handleStudioReady = () => {
    studioReady = true
    if (hwpEditorRef.current) resolveStudioWaiters(hwpEditorRef.current)
  }

  const handleHwpError = (msg: string) => {
    rejectStudioWaiters(new Error(msg))
    setNoticeBanner(msg)
  }

  /**
   * A change to the whole document (page setup and the like): the current bytes,
   * with flow edits handed over first, changed in an engine copy, then loaded back
   * into the flow view (and page editor if mounted). Undo history restarts.
   */
  const changeWholeDocument = async (change: (doc: WholeDocument) => void) => {
    const active = activeDocRef.current
    if (!active) throw new Error('no HWP document is open')
    const hwpx = active.session.format === 'hwpx'
    const studio = studioReady ? hwpEditorRef.current : null
    const bytes = studio
      ? hwpx
        ? await hwpPort.exportHwpx()
        : await hwpPort.exportHwp()
      : snapshotCurrentBytes(hwpx ? 'hwpx' : 'hwp')
    const engine = (await openFlowDocument(bytes)) as unknown as WholeDocument
    let changed: Uint8Array
    try {
      change(engine)
      changed = hwpx ? engine.exportHwpx() : engine.exportHwp()
    } finally {
      engine.free()
    }
    if (studio) await studio.loadBytes(changed)
    kept.set({ hwpBytes: changed, flowBytes: changed })
    studioEditedRef.current = false
    host.markDirty(true)
  }

  /** What the document is made of, read by the page editor plugin after flow edits are handed over. */
  const readDocumentProfile = async (): Promise<DocumentProfile> => {
    const studio = await ensureStudioMounted()
    await flushFlowToStudio()
    return (await studio.callPlugin('documentProfile')) as DocumentProfile
  }

  /** Shows a checked place: in the flow view by its block, on the page through the plugin. */
  const revealCheckedPlace = (place: Place) => {
    const path = place.anchor.path?.map((step) => ({
      controlIndex: step.controlIndex,
      cellIndex: step.cellIndex,
      cellParaIndex: step.cellParaIndex ?? 0,
    }))
    const sec = place.anchor.section ?? 0
    if (hwpLayoutRef.current === 'flow') {
      flowRef.current?.reveal({
        sec,
        para: place.anchor.para,
        path: path && path.length > 0 ? path : null,
      })
      return
    }
    void hwpEditorRef.current
      ?.callPlugin('reveal', {
        sec,
        para: place.anchor.para,
        ...(path && path.length > 0 ? { path } : {}),
        offset: 0,
        length: 0,
      })
      .catch(() => {})
  }

  /** The check's one fix: a Korean-word-processor-only font replaced everywhere. */
  const replaceCheckedFont = async (from: string, to: string) => {
    const studio = await ensureStudioMounted()
    await flushFlowToStudio()
    await studio.callPlugin('replaceFont', from, to)
    host.markDirty(true)
    refreshFlowFromStudio()
  }

  /** Flow view: pick a picture and put it in line at the caret. */
  const insertFlowPicture = async () => {
    const file = await pickImageFile()
    if (!file) return
    try {
      const picture = await readPicture(file)
      if (!flowRef.current?.insertPicture(picture)) {
        showToast({ message: tNow('insertImageNeedsCaret'), tone: 'error' })
      }
    } catch {
      showToast({ message: tNow('insertImageFailed'), tone: 'error' })
    }
  }

  function HwpWorkspace({ frame, mode, canEdit, lang, theme }: EditorWorkspaceProps) {
    const { hwpBytes, flowBytes, hwpLayout, studioMounted, flowZoom } = useSyncExternalStore(
      kept.subscribe,
      kept.get,
    )
    const canEditActive = canEdit
    const tNow = useCallback(
      (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key),
      [lang],
    )

    // After switching to page view and unmounting HwpFlowView, tear down the disposable
    // flow WASM iframe so flow and page WASM instances do not occupy memory simultaneously.
    useEffect(() => {
      if (hwpLayout === 'page') {
        releaseRhwpEngine()
      }
    }, [hwpLayout])

    const [memoOpen, setMemoOpen] = useState(false)
    const [memos, setMemos] = useState<readonly FlowMemo[]>([])
    /** Opens the memo sheet with the memos as the flow editor has them now. */
    const openMemos = useCallback(() => {
      setMemos(flowRef.current?.memos() ?? [])
      setMemoOpen(true)
    }, [])
    /** Runs a memo change and lists the memos again. */
    const memoAction = useCallback((run: (view: HwpFlowViewHandle) => boolean): boolean => {
      const view = flowRef.current
      if (!view) return false
      const ok = run(view)
      setMemos(view.memos())
      return ok
    }, [])

    // After editing in the page editor, rebuild the flow view from the edited document.
    // Only on a mode change, as before: not when the workspace mounts again.
    const seenModeRef = useRef(mode)
    useEffect(() => {
      if (seenModeRef.current === mode) return
      seenModeRef.current = mode
      if (mode === 'view' && studioEditedRef.current) refreshFlowFromStudio()
    }, [mode])

    const [docCheckOpen, setDocCheckOpen] = useState(false)

    const [pageNumberOpen, setPageNumberOpen] = useState(false)
    const [pageNumberNow, setPageNumberNow] = useState<PageNumberSetting | null>(null)

    /** Opens the page number sheet with the document's current setting. */
    const openPageNumbers = useCallback(async () => {
      const active = activeDocRef.current
      if (!active) return
      try {
        const hwpx = active.session.format === 'hwpx'
        const bytes =
          studioReady && hwpEditorRef.current
            ? hwpx
              ? await hwpPort.exportHwpx()
              : await hwpPort.exportHwp()
            : snapshotCurrentBytes(hwpx ? 'hwpx' : 'hwp')
        const engine = (await openFlowDocument(bytes)) as unknown as WholeDocument
        try {
          setPageNumberNow(readPageNumber(engine))
        } finally {
          engine.free()
        }
      } catch {
        setPageNumberNow(null)
      }
      setPageNumberOpen(true)
    }, [])

    const applyPageNumbers = useCallback(
      async (setting: PageNumberSetting) => {
        setPageNumberOpen(false)
        try {
          await changeWholeDocument((doc) => applyPageNumber(doc, setting))
          showToast(tNow('pageNumberDone'))
        } catch {
          showToast({ message: tNow('pageNumberFailed'), tone: 'error' })
        }
      },
      [tNow],
    )

    const { quickActions, formatGroups } = useMemo((): {
      quickActions: EditorQuickActionItem[]
      formatGroups: EditorFormatGroup[]
    } => {
      if (hwpLayout === 'flow') {
        // editing in the flow view: character and paragraph formats; tables and pictures need the page view
        const flow = (
          id: 'undo' | 'redo' | FlowFormatAction,
          label: MobileStringKey,
        ): EditorQuickActionItem => ({
          id,
          label: tNow(label),
          onPress: () => {
            const view = flowRef.current
            if (!view) return
            if (id === 'undo') view.undo()
            else if (id === 'redo') view.redo()
            else view.runFormat(id)
          },
        })
        return {
          quickActions: [
            flow('undo', 'undo'),
            flow('redo', 'redo'),
            flow('bold', 'bold'),
            flow('italic', 'italic'),
            flow('underline', 'underline'),
            flow('bulletList', 'bulletList'),
            flow('numberedList', 'numberedList'),
            flow('fontBigger', 'fontBigger'),
            flow('fontSmaller', 'fontSmaller'),
          ],
          formatGroups: [
            {
              id: 'text',
              title: tNow('fmtGroupText'),
              items: [
                flow('bold', 'bold'),
                flow('italic', 'italic'),
                flow('underline', 'underline'),
                flow('strikethrough', 'strikethrough'),
                flow('fontBigger', 'fontBigger'),
                flow('fontSmaller', 'fontSmaller'),
              ],
            },
            {
              id: 'paragraph',
              title: tNow('fmtGroupParagraph'),
              items: [
                flow('alignLeft', 'alignLeft'),
                flow('alignCenter', 'alignCenter'),
                flow('alignRight', 'alignRight'),
                flow('alignJustify', 'alignJustify'),
                flow('lineSpacingWider', 'lineSpacingWider'),
                flow('lineSpacingNarrower', 'lineSpacingNarrower'),
                flow('bulletList', 'bulletList'),
                flow('numberedList', 'numberedList'),
              ],
            },
            {
              id: 'insert',
              title: tNow('fmtGroupInsert'),
              items: [
                {
                  id: 'image',
                  label: tNow('insertImage'),
                  onPress: () => void insertFlowPicture(),
                },
                { id: 'memos', label: tNow('memoAdd'), onPress: openMemos },
                {
                  id: 'pageNumber',
                  label: tNow('pageNumber'),
                  onPress: () => void openPageNumbers(),
                },
                // tables are placed on the page
                {
                  id: 'pageView',
                  label: tNow('pageView'),
                  onPress: () => void switchHwpLayout('page'),
                },
              ],
            },
          ],
        }
      }
      const hwp = (id: HwpQuickAction, label: MobileStringKey): EditorQuickActionItem => ({
        id,
        label: tNow(label),
        onPress: () => hwpEditorRef.current?.runAction(id),
      })
      return {
        quickActions: [
          hwp('undo', 'undo'),
          hwp('redo', 'redo'),
          hwp('bold', 'bold'),
          hwp('italic', 'italic'),
          hwp('underline', 'underline'),
          hwp('bulletList', 'bulletList'),
          hwp('numberedList', 'numberedList'),
          hwp('fontBigger', 'fontBigger'),
          hwp('fontSmaller', 'fontSmaller'),
          hwp('insertTable', 'insertTable'),
        ],
        formatGroups: [
          {
            id: 'text',
            title: tNow('fmtGroupText'),
            items: [
              hwp('bold', 'bold'),
              hwp('italic', 'italic'),
              hwp('underline', 'underline'),
              hwp('strikethrough', 'strikethrough'),
              hwp('fontBigger', 'fontBigger'),
              hwp('fontSmaller', 'fontSmaller'),
            ],
          },
          {
            id: 'paragraph',
            title: tNow('fmtGroupParagraph'),
            items: [
              hwp('alignLeft', 'alignLeft'),
              hwp('alignCenter', 'alignCenter'),
              hwp('alignRight', 'alignRight'),
              hwp('alignJustify', 'alignJustify'),
              hwp('lineSpacingWider', 'lineSpacingWider'),
              hwp('lineSpacingNarrower', 'lineSpacingNarrower'),
              hwp('bulletList', 'bulletList'),
              hwp('numberedList', 'numberedList'),
            ],
          },
          {
            id: 'insert',
            title: tNow('fmtGroupInsert'),
            items: [
              hwp('insertTable', 'insertTable'),
              { ...hwp('insertImage', 'insertImage'), id: 'image' },
              {
                id: 'pageNumber',
                label: tNow('pageNumber'),
                onPress: () => void openPageNumbers(),
              },
            ],
          },
        ],
      }
    }, [hwpLayout, openMemos, openPageNumbers, tNow])

    const viewTools = useMemo((): EditorQuickActionItem[] => {
      if (hwpLayout === 'flow') {
        return [
          {
            id: 'fontSmaller',
            label: tNow('fontSmaller'),
            onPress: () =>
              setFlowZoom((z) => Math.max(FLOW_ZOOM_MIN, +(z - FLOW_ZOOM_STEP).toFixed(2))),
          },
          {
            id: 'fontBigger',
            label: tNow('fontBigger'),
            onPress: () =>
              setFlowZoom((z) => Math.min(FLOW_ZOOM_MAX, +(z + FLOW_ZOOM_STEP).toFixed(2))),
          },
          { id: 'memos', label: tNow('memoTitle'), onPress: openMemos },
          { id: 'pageView', label: tNow('pageView'), onPress: () => void switchHwpLayout('page') },
        ]
      }
      return [
        {
          id: 'fitWidth',
          label: tNow('fitToWidth'),
          onPress: () => {
            hwpEditorRef.current?.fitToWidth()
          },
        },
        { id: 'flowView', label: tNow('flowView'), onPress: () => void switchHwpLayout('flow') },
      ]
    }, [hwpLayout, openMemos, tNow])

    return (
      <>
        <EditorShell
          {...frame}
          quickActions={quickActions}
          formatGroups={formatGroups}
          moreItems={[
            {
              id: 'docCheck',
              label: tNow('checkTitle'),
              onPress: () => setDocCheckOpen(true),
            },
          ]}
          morePairs={[
            {
              id: 'hwpView',
              label: tNow('viewModeLabel'),
              section: 'document',
              actions: [
                {
                  id: 'flowView',
                  label: tNow('flowView'),
                  active: hwpLayout === 'flow',
                  icon: <IconFlowView size={16} />,
                  onPress: () => void switchHwpLayout('flow'),
                },
                {
                  id: 'pageView',
                  label: tNow('pageView'),
                  active: hwpLayout === 'page',
                  icon: <IconPageView size={16} />,
                  onPress: () => void switchHwpLayout('page'),
                },
              ],
            },
          ]}
          viewTools={viewTools}
          onFitToWidth={() => {
            hwpEditorRef.current?.fitToWidth()
          }}
        >
          {hwpLayout === 'flow' && (
            <HwpFlowView
              ref={flowRef}
              bytes={flowBytes}
              title={frame.docTitle}
              lang={lang}
              zoom={flowZoom}
              minZoom={FLOW_ZOOM_MIN}
              maxZoom={FLOW_ZOOM_MAX}
              onZoomChange={(next) =>
                setFlowZoom(() => Math.min(FLOW_ZOOM_MAX, Math.max(FLOW_ZOOM_MIN, next)))
              }
              editable={mode === 'edit' && canEditActive}
              openDocument={openFlowDocument}
              onUnavailable={() => kept.set({ hwpLayout: 'page', studioMounted: true })}
              onEdit={handleFlowEdit}
              onEditRefused={() => showToast({ message: tNow('flowEditRefused'), tone: 'error' })}
            />
          )}
          {/* The page editor mounts on demand (page view, AI, DocCheck, or .hwp save) so reading
              in flow view does not spin up a second 28 MB WASM instance. */}
          {studioMounted && (
            <div
              className="mobile-hwp-layer"
              data-hidden={hwpLayout === 'flow' ? 'true' : undefined}
              inert={hwpLayout === 'flow' || undefined}
            >
              <HwpMobileEditor
                ref={hwpEditorRef}
                fileName={frame.docTitle}
                documentBytes={hwpBytes}
                mode={mode}
                canEdit={canEditActive}
                hidden={hwpLayout === 'flow'}
                lang={lang}
                theme={theme}
                onDirty={handleHwpDirty}
                onReady={handleStudioReady}
                onError={handleHwpError}
              />
            </div>
          )}
        </EditorShell>
        <MemoSheet
          open={memoOpen && hwpLayout === 'flow'}
          onClose={() => setMemoOpen(false)}
          memos={memos}
          canEdit={mode === 'edit' && canEditActive}
          defaultAuthor={PRODUCT_NAME}
          onAdd={(text, author) => memoAction((view) => view.addMemo(text, author))}
          onReply={(id, text, author) => memoAction((view) => view.replyMemo(id, text, author))}
          onEdit={(id, text) => memoAction((view) => view.editMemo(id, text))}
          onRemove={(id) => memoAction((view) => view.removeMemo(id))}
          onReveal={(id) => flowRef.current?.revealMemo(id)}
        />
        <DocCheckSheet
          open={docCheckOpen}
          onClose={() => setDocCheckOpen(false)}
          format={frame.docFormat === 'hwpx' ? 'hwpx' : 'hwp'}
          readProfile={readDocumentProfile}
          onReveal={revealCheckedPlace}
          onReplaceFont={mode === 'edit' && canEditActive ? replaceCheckedFont : undefined}
        />
        <PageNumberSheet
          open={pageNumberOpen}
          onClose={() => setPageNumberOpen(false)}
          current={pageNumberNow}
          onApply={(setting) => void applyPageNumbers(setting)}
        />
      </>
    )
  }

  return {
    save: saveDocumentInternal,

    async share(doc) {
      const flags = { encrypted: doc.encrypted, distribution: doc.distribution }
      const port = studioReady && hwpEditorRef.current ? hwpPort : flowOnlyPort(flags)
      try {
        await hwpApi.shareDocument(doc.session, port, flags)
      } catch (err) {
        if (isMobileCommandError(err) && err.code === 'PASSWORD_PROTECTED') {
          setNoticeBanner(tNow('hwpProtectedShareError'))
        }
      }
    },

    async writeRecovery(doc) {
      const flags = { encrypted: doc.encrypted, distribution: doc.distribution }
      const port = studioReady && hwpEditorRef.current ? hwpPort : flowOnlyPort(flags)
      await hwpApi.writeRecovery(doc.session, port, flags).catch(() => {})
    },

    async createAiRun(ctx) {
      // the PC editor's tools over the page editor's plugin (ai/hwpAgent.ts), after the
      // flow view's edits have been handed to the page editor
      await ensureStudioMounted()
      await flushFlowToStudio()
      const { createMobileHwpAgent } = await import('../ai/hwpAgent')
      const agent = createMobileHwpAgent(
        (method, ...args) => {
          const studio = hwpEditorRef.current
          if (!studio) return Promise.reject(new Error('the page editor is not ready'))
          return studio.callPlugin(method, ...args)
        },
        () => ctx.getLang(),
      )
      await agent.begin()
      const hwpAgent = agent
      const skill = wrapSkillWithViewEditGate(agent.skill, {
        isMutatingTool: (name) => agent.editTools.has(name),
        getMode: () => ctx.getMode(),
        getCapabilities: () => ctx.getCapabilities(),
        switchToEdit: () => ctx.switchToEdit(),
      })
      return {
        skill,
        finish() {
          const changed = hwpAgent.finish()
          if (changed) {
            // the page editor changed: the flow view follows, and the change can be taken back
            studioEditedRef.current = true
            host.markDirty(true)
            if (hwpLayoutRef.current === 'flow') refreshFlowFromStudio()
            ctx.setUndo({
              summary: translateMobile(ctx.getLang(), 'aiChangedPlaces', { count: changed.places }),
              undo: () => {
                ctx.setUndo(null)
                void changed.undo().then((outcome) => {
                  if (hwpLayoutRef.current === 'flow') refreshFlowFromStudio()
                  if (outcome !== 'reverted') {
                    showToast({
                      message: translateMobile(ctx.getLang(), 'aiUndoRefused'),
                      tone: 'error',
                    })
                  }
                })
              },
            })
          }
        },
      }
    },

    Workspace: HwpWorkspace,

    dispose() {
      if (flowRefreshTimerRef.current) {
        clearTimeout(flowRefreshTimerRef.current)
        flowRefreshTimerRef.current = null
      }
      rejectStudioWaiters(new Error('HWP document closed'))
      studioReady = false
      hwpEditorRef.current = null
      flowRef.current = null
      kept.set({ hwpBytes: null, flowBytes: null, studioMounted: false })
      releaseRhwpEngine()
    },
  }
}
