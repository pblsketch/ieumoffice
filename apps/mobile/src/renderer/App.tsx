import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentLoop, type AgentMessage } from '@genoffice/agent-core'
import { AI_SUBSCRIPTION_NOTICE_VERSION } from '@genoffice/ai-provider/browser'
import { normalizeLang, type Lang } from '@genoffice/i18n'
import {
  createMobileAgentTransport,
  createMobileAiMemoryStore,
} from '@genoffice/mobile-bridge/ai-bridge'
import { createMobileHwpApi, createMobileHwpSkill } from '@genoffice/mobile-bridge/hwp'
import {
  base64ToUtf8,
  createMobileMarkdownApi,
  createMobileMarkdownSkill,
} from '@genoffice/mobile-bridge/markdown'
import {
  createMobileSessionController,
  type ActiveDocState,
  type UnsavedSwitchChoice,
} from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  createTauriMobileTransport,
  isMobileCommandError,
  type HwpBackupEntry,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileAppPrefsPatch,
  type MobileChatGptStatus,
  type MobileClient,
  type MobileDocSession,
  type MobileRestoreTarget,
  type RecentDocEntry,
  type RecoveryEntry,
} from '@genoffice/mobile-bridge/transport'
import {
  canMutateDocument,
  initialDocumentMode,
  type DocumentMode,
} from '@genoffice/mobile-bridge/view-edit-gate'
import { AiSheetPanel, type ChatGptRecoveryNoticeKind } from './components/AiSheetPanel'
import { HomeScreen } from './components/HomeScreen'
import { ToastHost, useToast } from './components/Toast'
import { UnsavedModal } from './components/UnsavedModal'
import { rememberedLayout, rememberLayout } from './shell/layoutMemory'
import { createFlowSyncedPort } from './editors/flowSyncedPort'
import { HwpFlowView, type HwpFlowViewHandle } from './editors/HwpFlowView'
import type { FlowFormatAction } from './editors/flowEditing'
import { openFlowDocument } from './editors/rhwpEngine'
import {
  HwpMobileEditor,
  type HwpMobileEditorHandle,
  type HwpQuickAction,
} from './editors/HwpMobileEditor'
import {
  MarkdownMobileEditor,
  type MarkdownMobileEditorHandle,
  type MarkdownQuickAction,
} from './editors/MarkdownMobileEditor'
import { MobileLocaleProvider, translateMobile } from './i18n'
import type { MobileStringKey } from './i18n/strings'
import { SettingsScreen } from './settings/SettingsScreen'
import { BackStackProvider } from './shell/backStack'
import {
  EditorShell,
  type EditorFormatGroup,
  type EditorQuickActionItem,
  type EditorSaveState,
} from './shell/EditorShell'
import { useViewportLayout } from './shell/useViewportLayout'

const DEFAULT_PREFS: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwp',
  // AI starts hidden on mobile; the user turns it on in Settings.
  aiEnabled: false,
}

const DEFAULT_AI_SETTINGS: MobileAiSettingsSnapshot = {
  selectedProvider: 'auto',
  modelByProvider: {},
  configuredProviders: {},
  chatgptVisible: false,
  subscriptionNoticeVersion: 0,
}

const DEFAULT_CHATGPT_STATUS: MobileChatGptStatus = { state: 'hidden' }

function editorSaveState(saving: boolean, dirty: boolean): EditorSaveState {
  if (saving) return 'saving'
  return dirty ? 'dirty' : 'saved'
}

const RECOVERY_IDLE_MS = 2000

/** Text scale of the HWP flow view (document sizes are in pt). */
const FLOW_ZOOM_DEFAULT = 1.2
const FLOW_ZOOM_MIN = 0.8
const FLOW_ZOOM_MAX = 2.4
const FLOW_ZOOM_STEP = 0.15
const RECOVERY_PERIODIC_MS = 30000

type ScreenView = 'home' | 'editor' | 'settings'

export interface MobileAppProps {
  readonly client?: MobileClient
}

export function MobileApp({ client: injectedClient }: MobileAppProps) {
  const client = useMemo(
    () => injectedClient ?? createMobileClient(createTauriMobileTransport()),
    [injectedClient],
  )
  const markdownApi = useMemo(() => createMobileMarkdownApi(client), [client])
  const hwpApi = useMemo(() => createMobileHwpApi(client), [client])
  const aiMemoryRef = useRef(createMobileAiMemoryStore())
  // Publishes data-window and --m-kb on <html> for every screen, not only the editor.
  const viewport = useViewportLayout()
  const windowClassRef = useRef(viewport.windowClass)
  windowClassRef.current = viewport.windowClass

  const [screen, setScreen] = useState<ScreenView>('home')
  const [prefs, setPrefs] = useState<MobileAppPrefs>(DEFAULT_PREFS)
  const [aiSettings, setAiSettings] = useState<MobileAiSettingsSnapshot>(DEFAULT_AI_SETTINGS)
  const [chatgptStatus, setChatgptStatus] = useState<MobileChatGptStatus>(DEFAULT_CHATGPT_STATUS)
  const [recentDocs, setRecentDocs] = useState<RecentDocEntry[]>([])
  const [recoveryEntries, setRecoveryEntries] = useState<RecoveryEntry[]>([])
  const [backups, setBackups] = useState<HwpBackupEntry[]>([])
  const [permissionDeniedRecentId, setPermissionDeniedRecentId] = useState<string | null>(null)

  const [activeDoc, setActiveDoc] = useState<ActiveDocState | null>(null)
  const [mode, setMode] = useState<DocumentMode>('view')
  const [markdownText, setMarkdownText] = useState('')
  const [hwpBytes, setHwpBytes] = useState<Uint8Array | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast()
  const [saving, setSaving] = useState(false)

  const [aiMessages, setAiMessages] = useState<readonly AgentMessage[]>([])
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiAutoSwitched, setAiAutoSwitched] = useState(false)
  const [aiRecoveryNotice, setAiRecoveryNotice] = useState<ChatGptRecoveryNoticeKind>(null)
  const [lastAiUndo, setLastAiUndo] = useState<{ summary: string; undo: () => void } | null>(null)
  const [lastAiPrompt, setLastAiPrompt] = useState<string | null>(null)
  const [hwpVerifyFailed, setHwpVerifyFailed] = useState(false)

  const [unsavedPromptDoc, setUnsavedPromptDoc] = useState<string | null>(null)
  const unsavedResolverRef = useRef<((choice: UnsavedSwitchChoice) => void) | null>(null)

  const markdownEditorRef = useRef<MarkdownMobileEditorHandle | null>(null)
  const hwpEditorRef = useRef<HwpMobileEditorHandle | null>(null)
  // HWP reading layout: reflowed "flow" view or the page editor (design system 5.3).
  const [hwpLayout, setHwpLayout] = useState<'page' | 'flow'>('flow')
  const [flowZoom, setFlowZoom] = useState(FLOW_ZOOM_DEFAULT)
  const [flowBytes, setFlowBytes] = useState<Uint8Array | null>(null)
  const studioEditedRef = useRef(false)
  const flowRef = useRef<HwpFlowViewHandle | null>(null)
  const hwpLayoutRef = useRef(hwpLayout)
  hwpLayoutRef.current = hwpLayout
  const suppressStudioDirtyRef = useRef(false)
  const flowRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Hands edits made in the flow view to the page editor (the one save/share/AI read). */
  const flushFlowToStudio = useCallback(async () => {
    const flow = flowRef.current
    const studio = hwpEditorRef.current
    const doc = activeDocRef.current
    if (!flow || !studio || !doc || !flow.hasPendingEdits()) return
    const bytes = flow.takeBytes(doc.session.format === 'hwpx' ? 'hwpx' : 'hwp')
    if (!bytes) return
    suppressStudioDirtyRef.current = true
    try {
      await studio.loadBytes(bytes)
    } finally {
      suppressStudioDirtyRef.current = false
    }
  }, [])

  /** The page editor's port, after any pending flow edits have been handed over. */
  const hwpPort = useMemo(
    () => createFlowSyncedPort(() => hwpEditorRef.current?.getSavePort(), flushFlowToStudio),
    [flushFlowToStudio],
  )

  /** Rebuilds the flow view from the page editor after it changed the document. */
  const refreshFlowFromStudio = useCallback(() => {
    const doc = activeDocRef.current
    const port = hwpEditorRef.current?.getSavePort()
    if (!doc || !port || (doc.session.format !== 'hwp' && doc.session.format !== 'hwpx')) return
    studioEditedRef.current = false
    const exportBytes = doc.session.format === 'hwpx' ? port.exportHwpx() : port.exportHwp()
    exportBytes.then(setFlowBytes).catch(() => {
      // Keep the last flow; the page view still shows the edits.
    })
  }, [])

  const switchHwpLayout = useCallback(
    async (next: 'page' | 'flow') => {
      if (next === 'page') await flushFlowToStudio()
      else if (studioEditedRef.current) refreshFlowFromStudio()
      setHwpLayout(next)
      const doc = activeDocRef.current
      if (doc) rememberLayout(window.localStorage, doc.session.docKey, next)
    },
    [flushFlowToStudio, refreshFlowFromStudio],
  )
  const activeRunCancelRef = useRef<(() => void) | null>(null)

  const lang: Lang = normalizeLang(prefs.lang)
  const tNow = useCallback(
    (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key),
    [lang],
  )

  const modeRef = useRef(mode)
  modeRef.current = mode
  const activeDocRef = useRef(activeDoc)
  activeDocRef.current = activeDoc
  const markdownTextRef = useRef(markdownText)
  markdownTextRef.current = markdownText

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (prefs.theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', prefs.theme)
    }
  }, [prefs.theme])

  const refreshHomeData = useCallback(async () => {
    const [recent, recovery, bk] = await Promise.all([
      client.listRecentDocs().catch(() => []),
      client.recoveryList().catch(() => []),
      client.hwpBackupList().catch(() => []),
    ])
    setRecentDocs(recent)
    setRecoveryEntries(recovery)
    setBackups(bk)
  }, [client])

  const refreshAiState = useCallback(async () => {
    const [settings, cgStatus] = await Promise.all([
      client.getAiSettings().catch(() => DEFAULT_AI_SETTINGS),
      client.chatgptStatus().catch(() => DEFAULT_CHATGPT_STATUS),
    ])
    setAiSettings(settings)
    setChatgptStatus(cgStatus)
  }, [client])

  const requestUnsavedChoice = useCallback(
    async (doc: ActiveDocState): Promise<UnsavedSwitchChoice> => {
      return new Promise((resolve) => {
        unsavedResolverRef.current = resolve
        setUnsavedPromptDoc(doc.session.name)
      })
    },
    [],
  )

  const resolveUnsavedChoice = useCallback((choice: UnsavedSwitchChoice) => {
    setUnsavedPromptDoc(null)
    const resolver = unsavedResolverRef.current
    unsavedResolverRef.current = null
    resolver?.(choice)
  }, [])

  const saveDocumentInternal = useCallback(
    async (doc: ActiveDocState, forceSaveAs = false): Promise<boolean> => {
      const { session } = doc
      if (session.format === 'md' || session.format === 'txt') {
        const currentText = markdownEditorRef.current?.getMarkdown() ?? markdownTextRef.current
        if (forceSaveAs || !session.writable || session.ephemeral) {
          try {
            const nextSession = await markdownApi.saveAsDocument(session, session.name, currentText)
            sessionControllerRef.current?.updateSessionMetadata({
              session: nextSession,
              dirty: false,
              isUntitled: false,
            })
            showToast(tNow('savedNotice'))
            await refreshHomeData()
            return true
          } catch (err) {
            if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return false
            setNoticeBanner(tNow('readonlyShareNotice'))
            return false
          }
        }
        try {
          await markdownApi.saveDocument(session, currentText)
          sessionControllerRef.current?.markDirty(false)
          showToast(tNow('savedNotice'))
          await refreshHomeData()
          return true
        } catch (err) {
          if (isMobileCommandError(err) && err.code === 'READ_ONLY_URI') {
            setNoticeBanner(tNow('readonlyShareNotice'))
            return saveDocumentInternal(doc, true)
          }
          return false
        }
      }

      // HWP / HWPX save pipeline
      const port = hwpEditorRef.current ? hwpPort : null
      if (!port) return false
      const flags = { encrypted: doc.encrypted, distribution: doc.distribution }
      const targetFormat: 'hwp' | 'hwpx' =
        forceSaveAs && hwpVerifyFailed ? 'hwpx' : session.format === 'hwpx' ? 'hwpx' : 'hwp'
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
          sessionControllerRef.current?.updateSessionMetadata({
            session: outcome.session,
            dirty: false,
            isUntitled: false,
          })
        } else {
          sessionControllerRef.current?.markDirty(false)
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
    },
    [hwpApi, hwpPort, hwpVerifyFailed, markdownApi, refreshHomeData, showToast, tNow],
  )

  /** Saves the active document and keeps the app bar's save state in step. */
  const runSave = useCallback(
    async (doc: ActiveDocState, forceSaveAs: boolean): Promise<boolean> => {
      setSaving(true)
      try {
        return await saveDocumentInternal(doc, forceSaveAs)
      } finally {
        setSaving(false)
      }
    },
    [saveDocumentInternal],
  )

  /** [완료]: write the original only when there are changes, then go back to view mode. */
  const handleDone = useCallback(async () => {
    const doc = activeDocRef.current
    if (doc?.dirty) {
      const ok = await runSave(doc, false)
      if (!ok) return
    }
    setMode('view')
  }, [runSave])

  const saveDocumentRef = useRef(saveDocumentInternal)
  saveDocumentRef.current = saveDocumentInternal

  const sessionControllerRef = useRef<ReturnType<typeof createMobileSessionController> | null>(null)
  if (!sessionControllerRef.current) {
    sessionControllerRef.current = createMobileSessionController({
      confirmUnsavedSwitch: (current) => requestUnsavedChoice(current),
      saveCurrentDocument: (current) => saveDocumentRef.current(current, false),
      discardRecovery: async (docKey) => {
        await client.recoveryDiscard(docKey).catch(() => {})
      },
      onResetAiMemory: (_prev, nextDocKey) => {
        activeRunCancelRef.current?.()
        aiMemoryRef.current.resetForDoc(nextDocKey)
        setAiMessages([])
        setLastAiUndo(null)
        setAiAutoSwitched(false)
      },
      onSessionChanged: (next) => {
        setActiveDoc(next)
      },
    })
  }

  const openLoadedSession = useCallback(
    async (
      session: MobileDocSession,
      options?: { isUntitled?: boolean; recoveryBytesBase64?: string },
    ) => {
      const controller = sessionControllerRef.current!
      const isUntitled =
        options?.isUntitled ?? (!session.writable && !session.ephemeral && !session.uriHint)

      if (session.format === 'md' || session.format === 'txt') {
        const text = options?.recoveryBytesBase64
          ? base64ToUtf8(options.recoveryBytesBase64)
          : isUntitled
            ? ''
            : (await markdownApi.readDocument(session)).text
        const outcome = await controller.switchTo(async () => ({
          session,
          isUntitled,
        }))
        if (!outcome.switched) return
        setMarkdownText(text)
        setHwpBytes(null)
        setMode(initialDocumentMode({ isUntitled }))
        setNoticeBanner(null)
        setScreen('editor')
        await refreshHomeData()
        return
      }

      const opened = options?.recoveryBytesBase64
        ? {
            bytes: Uint8Array.from(atob(options.recoveryBytesBase64), (c) => c.charCodeAt(0)),
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

      const outcome = await controller.switchTo(async () => ({
        session,
        encrypted: opened.encrypted,
        distribution: opened.distribution,
        trackingDropped: opened.trackingDropped,
        isUntitled,
      }))
      if (!outcome.switched) return
      setHwpBytes(opened.bytes)
      setFlowBytes(opened.bytes)
      studioEditedRef.current = false
      // The layout last chosen for this document; otherwise phones and small tablets
      // read in the flow view and larger windows keep the page.
      setHwpLayout(
        rememberedLayout(window.localStorage, session.docKey) ??
          (windowClassRef.current === 'compact' || windowClassRef.current === 'medium'
            ? 'flow'
            : 'page'),
      )
      setMarkdownText('')
      setMode(initialDocumentMode({ isUntitled }))
      setNoticeBanner(opened.trackingDropped ? tNow('hwpTrackingDroppedNotice') : null)
      setScreen('editor')
      await refreshHomeData()
    },
    [hwpApi, markdownApi, refreshHomeData, tNow],
  )

  // Initial load + external Share-In / Open-With intent check.
  useEffect(() => {
    let mounted = true
    void (async () => {
      const [loadedPrefs] = await Promise.all([
        client.getAppPrefs().catch(() => DEFAULT_PREFS),
        refreshHomeData(),
        refreshAiState(),
      ])
      if (!mounted) return
      setPrefs(loadedPrefs)

      const pending = await client.consumePendingOpenIntent().catch(() => null)
      if (pending && mounted) {
        await openLoadedSession(pending, { isUntitled: false })
      }
    })()
    return () => {
      mounted = false
    }
  }, [client, openLoadedSession, refreshAiState, refreshHomeData])

  // Write recovery copy on idle, periodic tick, and backgrounding; cancel active AI stream on hide.
  const writeRecoveryNow = useCallback(async () => {
    const doc = activeDocRef.current
    if (!doc || !doc.dirty || doc.encrypted || doc.distribution) return
    if (doc.session.format === 'md' || doc.session.format === 'txt') {
      const text = markdownEditorRef.current?.getMarkdown() ?? markdownTextRef.current
      await markdownApi.writeRecovery(doc.session, text).catch(() => {})
      return
    }
    const port = hwpEditorRef.current ? hwpPort : null
    if (!port) return
    await hwpApi
      .writeRecovery(doc.session, port, {
        encrypted: doc.encrypted,
        distribution: doc.distribution,
      })
      .catch(() => {})
  }, [hwpApi, hwpPort, markdownApi])

  useEffect(() => {
    if (!activeDoc?.dirty) return
    const idleTimer = setTimeout(() => {
      void writeRecoveryNow()
    }, RECOVERY_IDLE_MS)
    const periodic = setInterval(() => {
      void writeRecoveryNow()
    }, RECOVERY_PERIODIC_MS)
    return () => {
      clearTimeout(idleTimer)
      clearInterval(periodic)
    }
  }, [activeDoc?.dirty, markdownText, writeRecoveryNow])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        activeRunCancelRef.current?.()
        void writeRecoveryNow()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [writeRecoveryNow])

  const handleCreateNew = useCallback(
    async (format: 'hwp' | 'hwpx' | 'md') => {
      const session = await client.createUntitledSession(format)
      await openLoadedSession(session, { isUntitled: true })
    },
    [client, openLoadedSession],
  )

  const handlePickOpenFile = useCallback(async () => {
    try {
      const session = await client.pickOpenFile(['hwp', 'hwpx', 'md', 'markdown', 'txt'])
      setPermissionDeniedRecentId(null)
      await openLoadedSession(session, { isUntitled: false })
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      setNoticeBanner(err instanceof Error ? err.message : String(err))
    }
  }, [client, openLoadedSession])

  const handleOpenRecent = useCallback(
    async (entry: RecentDocEntry) => {
      try {
        const session = await client.openRecentDoc(entry.id)
        setPermissionDeniedRecentId(null)
        await openLoadedSession(session, { isUntitled: false })
      } catch (err) {
        if (isMobileCommandError(err) && err.code === 'PERMISSION_DENIED') {
          setPermissionDeniedRecentId(entry.id)
          return
        }
        setNoticeBanner(err instanceof Error ? err.message : String(err))
      }
    },
    [client, openLoadedSession],
  )

  const handleRemoveRecent = useCallback(
    async (id: string) => {
      await client.removeRecentDoc(id).catch(() => {})
      setPermissionDeniedRecentId((prev) => (prev === id ? null : prev))
      await refreshHomeData()
    },
    [client, refreshHomeData],
  )

  const handleRestoreRecovery = useCallback(
    async (entry: RecoveryEntry) => {
      const bytesBase64 = await client.recoveryRead(entry.docKey)
      const fmt: 'hwp' | 'hwpx' | 'md' =
        entry.format === 'hwpx' ? 'hwpx' : entry.format === 'hwp' ? 'hwp' : 'md'
      const session = await client.createUntitledSession(fmt)
      await openLoadedSession(
        { ...session, name: entry.title },
        { isUntitled: true, recoveryBytesBase64: bytesBase64 },
      )
      sessionControllerRef.current?.markDirty(true)
    },
    [client, openLoadedSession],
  )

  const handleDiscardRecovery = useCallback(
    async (docKey: string) => {
      await client.recoveryDiscard(docKey).catch(() => {})
      await refreshHomeData()
    },
    [client, refreshHomeData],
  )

  const handleBackFromEditor = useCallback(async () => {
    const outcome = await sessionControllerRef.current!.closeActive()
    if (outcome.switched) {
      setScreen('home')
      setNoticeBanner(null)
      await refreshHomeData()
    }
  }, [refreshHomeData])

  const handleShare = useCallback(async () => {
    const doc = activeDocRef.current
    if (!doc) return
    if (doc.session.format === 'md' || doc.session.format === 'txt') {
      const text = markdownEditorRef.current?.getMarkdown() ?? markdownTextRef.current
      await markdownApi.shareDocument(doc.session, text).catch(() => {})
      return
    }
    const port = hwpEditorRef.current ? hwpPort : null
    if (!port) return
    try {
      await hwpApi.shareDocument(doc.session, port, {
        encrypted: doc.encrypted,
        distribution: doc.distribution,
      })
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'PASSWORD_PROTECTED') {
        setNoticeBanner(tNow('hwpProtectedShareError'))
      }
    }
  }, [hwpApi, hwpPort, markdownApi, tNow])

  const handleSendAi = useCallback(
    async (prompt: string) => {
      const doc = activeDocRef.current
      if (!doc || !prefs.aiEnabled) return
      setLastAiPrompt(prompt)
      setAiRecoveryNotice(null)
      setAiStreaming(true)
      let classifiedError = false

      const caps = {
        writable: doc.session.writable,
        encrypted: doc.encrypted,
        distribution: doc.distribution,
        isUntitled: doc.isUntitled,
      }

      const switchToEdit = () => {
        setMode('edit')
        modeRef.current = 'edit'
        setAiAutoSwitched(true)
      }

      const skill =
        doc.session.format === 'md' || doc.session.format === 'txt'
          ? createMobileMarkdownSkill(
              {
                getMarkdown: () =>
                  markdownEditorRef.current?.getMarkdown() ?? markdownTextRef.current,
                setMarkdown: (next) => {
                  markdownEditorRef.current?.setMarkdown(next)
                  setMarkdownText(next)
                  sessionControllerRef.current?.markDirty(true)
                },
              },
              {
                getMode: () => modeRef.current,
                getCapabilities: () => caps,
                switchToEdit,
                onDocumentMutated: (summary, prev) => {
                  setLastAiUndo({
                    summary,
                    undo: () => {
                      markdownEditorRef.current?.setMarkdown(prev)
                      setMarkdownText(prev)
                      setLastAiUndo(null)
                    },
                  })
                },
              },
            )
          : createMobileHwpSkill(hwpPort, {
              getMode: () => modeRef.current,
              getCapabilities: () => caps,
              switchToEdit,
              onDocumentMutated: (summary) => {
                sessionControllerRef.current?.markDirty(true)
                setLastAiUndo({
                  summary,
                  undo: () => {
                    hwpEditorRef.current?.runAction('undo')
                    setLastAiUndo(null)
                  },
                })
              },
            })

      const transport = createMobileAgentTransport(client, {
        onStreamError: (detail) => {
          classifiedError = true
          if (detail.errorCode === 'rate-limit') {
            setAiRecoveryNotice('usage-limit')
          } else if (detail.errorCode === 'signed-out') {
            setAiRecoveryNotice('reauth')
          } else {
            setAiRecoveryNotice('connection-error')
          }
        },
      })

      const history = [...aiMemoryRef.current.getMessages()]
      aiMemoryRef.current.append({ role: 'user', text: prompt })
      setAiMessages(aiMemoryRef.current.getMessages())

      await new Promise<void>((resolve) => {
        const loop = new AgentLoop({
          transport,
          skill,
          events: {
            onDone: (result) => {
              if (result.text) {
                aiMemoryRef.current.append({ role: 'assistant', text: result.text })
                setAiMessages(aiMemoryRef.current.getMessages())
              }
              resolve()
            },
            onError: () => {
              if (!classifiedError) {
                setAiRecoveryNotice((prev) => prev ?? 'connection-error')
              }
              resolve()
            },
          },
        })
        if (history.length > 0) {
          loop.appendHistory(history)
        }
        activeRunCancelRef.current = () => {
          loop.cancel()
          resolve()
        }
        loop.run(prompt)
      })
      activeRunCancelRef.current = null
      setAiStreaming(false)
    },
    [client, hwpPort, prefs.aiEnabled],
  )

  const handleUpdatePrefs = useCallback(
    async (patch: MobileAppPrefsPatch) => {
      const updated = await client.setAppPrefs(patch)
      setPrefs(updated)
    },
    [client],
  )

  const handleHwpDirty = useCallback(() => {
    if (suppressStudioDirtyRef.current) return
    studioEditedRef.current = true
    sessionControllerRef.current?.markDirty(true)
    // the page editor changed while the flow is on screen (e.g. AI): follow it
    if (hwpLayoutRef.current === 'flow') {
      if (flowRefreshTimerRef.current) clearTimeout(flowRefreshTimerRef.current)
      flowRefreshTimerRef.current = setTimeout(refreshFlowFromStudio, 500)
    }
  }, [refreshFlowFromStudio])

  const handleFlowEdit = useCallback(() => {
    sessionControllerRef.current?.markDirty(true)
  }, [])

  // After editing in the page editor, rebuild the flow view from the edited document.
  useEffect(() => {
    if (mode === 'view' && studioEditedRef.current) refreshFlowFromStudio()
  }, [mode, refreshFlowFromStudio])

  const handleHwpError = useCallback((msg: string) => {
    setNoticeBanner(msg)
  }, [])

  const canEditActive = activeDoc
    ? canMutateDocument({
        writable: activeDoc.session.writable,
        encrypted: activeDoc.encrypted,
        distribution: activeDoc.distribution,
        isUntitled: activeDoc.isUntitled,
      })
    : false

  const activeFormat = activeDoc?.session.format ?? null
  const isMarkdownDoc = activeFormat === 'md' || activeFormat === 'txt'

  // Toolbar actions and the format panel ([Aa]) of the active editor.
  const { quickActions, formatGroups } = useMemo((): {
    quickActions: EditorQuickActionItem[]
    formatGroups: EditorFormatGroup[]
  } => {
    if (!activeFormat) return { quickActions: [], formatGroups: [] }
    if (isMarkdownDoc) {
      const md = (id: MarkdownQuickAction, label: MobileStringKey): EditorQuickActionItem => ({
        id,
        label: tNow(label),
        onPress: () => markdownEditorRef.current?.runAction(id),
      })
      const quick = [
        md('undo', 'undo'),
        md('redo', 'redo'),
        md('bold', 'bold'),
        md('italic', 'italic'),
        md('heading', 'heading'),
        md('list', 'bulletList'),
        { ...md('insertImage', 'insertImage'), id: 'image' },
      ]
      if (activeFormat === 'txt') return { quickActions: quick.slice(0, 2), formatGroups: [] }
      return {
        quickActions: quick,
        formatGroups: [
          {
            id: 'text',
            title: tNow('fmtGroupText'),
            items: [
              md('bold', 'bold'),
              md('italic', 'italic'),
              md('strikethrough', 'strikethrough'),
              md('link', 'link'),
            ],
          },
          {
            id: 'paragraph',
            title: tNow('fmtGroupParagraph'),
            items: [
              md('heading', 'heading'),
              md('heading2', 'heading2'),
              md('heading3', 'heading3'),
              md('list', 'bulletList'),
              md('numberedList', 'numberedList'),
              md('taskList', 'taskList'),
              md('quote', 'quote'),
              md('codeBlock', 'codeBlock'),
            ],
          },
          {
            id: 'insert',
            title: tNow('fmtGroupInsert'),
            items: [{ ...md('insertImage', 'insertImage'), id: 'image' }],
          },
        ],
      }
    }
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
              // tables and pictures are placed on the page
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
          items: [hwp('insertTable', 'insertTable')],
        },
      ],
    }
  }, [activeFormat, hwpLayout, isMarkdownDoc, switchHwpLayout, tNow])

  const isHwpDoc = activeFormat === 'hwp' || activeFormat === 'hwpx'
  const viewTools = useMemo((): EditorQuickActionItem[] => {
    if (!isHwpDoc) return []
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
        { id: 'pageView', label: tNow('pageView'), onPress: () => void switchHwpLayout('page') },
      ]
    }
    return [
      {
        id: 'fitWidth',
        label: tNow('fitToWidth'),
        onPress: () => {
          setZoomScale(1)
          hwpEditorRef.current?.fitToWidth()
        },
      },
      { id: 'flowView', label: tNow('flowView'), onPress: () => void switchHwpLayout('flow') },
    ]
  }, [hwpLayout, isHwpDoc, switchHwpLayout, tNow])

  return (
    <MobileLocaleProvider lang={lang}>
      <BackStackProvider>
        {screen === 'home' && (
          <HomeScreen
            recentDocs={recentDocs}
            recoveryEntries={recoveryEntries}
            permissionDeniedRecentId={permissionDeniedRecentId}
            defaultHwpFormat={prefs.hwpDefaultFormat}
            onCreateNew={(fmt) => void handleCreateNew(fmt)}
            onOpenFile={() => void handlePickOpenFile()}
            onOpenRecent={(entry) => void handleOpenRecent(entry)}
            onRemoveRecent={(id) => void handleRemoveRecent(id)}
            onRestoreRecovery={(entry) => void handleRestoreRecovery(entry)}
            onDiscardRecovery={(docKey) => void handleDiscardRecovery(docKey)}
            onOpenSettings={() => {
              void refreshAiState()
              void refreshHomeData()
              setScreen('settings')
            }}
          />
        )}

        {screen === 'settings' && (
          <SettingsScreen
            prefs={prefs}
            aiSettings={aiSettings}
            chatgptStatus={chatgptStatus}
            backups={backups}
            onBack={() => setScreen(activeDoc ? 'editor' : 'home')}
            onUpdatePrefs={(patch) => void handleUpdatePrefs(patch)}
            onSelectProvider={(provider) => {
              void client.setAiSettings({ selectedProvider: provider }).then(setAiSettings)
            }}
            onValidateAndSaveKey={async ({ provider, apiKey, freeOnly }) => {
              const validated = await client.validateAiKey({ provider, apiKey, freeOnly })
              if (!validated.ok) {
                throw new Error('API key validation failed.')
              }
              const updated = await client.setAiSettings({
                selectedProvider: provider,
                providerKeyPatch: { provider, apiKey, freeOnly },
                ...(validated.models[0]
                  ? { modelPatch: { provider, model: validated.models[0] } }
                  : {}),
              })
              setAiSettings(updated)
            }}
            onRemoveKey={async (provider) => {
              const updated = await client.setAiSettings({
                providerKeyPatch: { provider, apiKey: null },
              })
              setAiSettings(updated)
            }}
            onChatgptSignIn={async (reconsent) => {
              await client.chatgptSignIn(reconsent)
              await refreshAiState()
            }}
            onChatgptSignOut={async () => {
              await client.chatgptSignOut()
              await refreshAiState()
            }}
            onRestoreBackup={async (backupId, target: MobileRestoreTarget) => {
              const res = await client.hwpBackupRestore(backupId, target)
              await refreshHomeData()
              if (res.session) {
                await openLoadedSession(res.session, { isUntitled: false })
              }
            }}
            onDeleteBackup={async (backupId) => {
              await client.hwpBackupDelete(backupId)
              await refreshHomeData()
            }}
          />
        )}

        {screen === 'editor' && activeDoc && (
          <EditorShell
            docTitle={activeDoc.session.name}
            docFormat={activeDoc.session.format}
            saveState={editorSaveState(saving, activeDoc.dirty)}
            mode={mode}
            canEdit={canEditActive}
            aiEnabled={prefs.aiEnabled}
            noticeBanner={noticeBanner}
            onDismissNotice={() => setNoticeBanner(null)}
            quickActions={quickActions}
            formatGroups={formatGroups}
            viewTools={viewTools}
            onBack={() => void handleBackFromEditor()}
            onEnterEdit={() => setMode('edit')}
            onDone={() => void handleDone()}
            onExitEdit={() => setMode('view')}
            onSave={() => void runSave(activeDoc, false)}
            onSaveAs={() => void runSave(activeDoc, true)}
            onShare={() => void handleShare()}
            onFitToWidth={() => {
              setZoomScale(1)
              hwpEditorRef.current?.fitToWidth()
            }}
            onOpenBackups={() => {
              void refreshHomeData()
              setScreen('settings')
            }}
            aiPanelContent={
              <AiSheetPanel
                aiEnabled={prefs.aiEnabled}
                aiSettings={aiSettings}
                chatgptStatus={chatgptStatus}
                messages={aiMessages}
                streaming={aiStreaming}
                canMutate={canEditActive}
                autoSwitchedNotice={aiAutoSwitched}
                recoveryNotice={aiRecoveryNotice}
                lastChangeSummary={lastAiUndo?.summary ?? null}
                onUndoLastChange={lastAiUndo?.undo}
                onSend={(p) => void handleSendAi(p)}
                onStop={() => activeRunCancelRef.current?.()}
                onOpenSettings={() => {
                  void refreshAiState()
                  setScreen('settings')
                }}
                onAcknowledgeSubscriptionNotice={() => {
                  void client
                    .setAiSettings({ subscriptionNoticeVersion: AI_SUBSCRIPTION_NOTICE_VERSION })
                    .then(setAiSettings)
                }}
                onChatgptReconsent={() => void client.chatgptSignIn(true).then(refreshAiState)}
                onChatgptReconnect={() => void client.chatgptSignIn(false).then(refreshAiState)}
                onRetryLast={lastAiPrompt ? () => void handleSendAi(lastAiPrompt) : undefined}
              />
            }
          >
            {activeDoc.session.format === 'md' || activeDoc.session.format === 'txt' ? (
              <MarkdownMobileEditor
                ref={markdownEditorRef}
                value={markdownText}
                mode={mode}
                isPlainText={activeDoc.session.format === 'txt'}
                zoomScale={zoomScale}
                onChange={(next) => {
                  setMarkdownText(next)
                  sessionControllerRef.current?.markDirty(true)
                }}
                onErrorNotice={(key) => setNoticeBanner(tNow(key))}
              />
            ) : (
              <>
                {hwpLayout === 'flow' && (
                  <HwpFlowView
                    ref={flowRef}
                    bytes={flowBytes}
                    title={activeDoc.session.name}
                    lang={lang}
                    zoom={flowZoom}
                    editable={mode === 'edit' && canEditActive}
                    openDocument={openFlowDocument}
                    onUnavailable={() => setHwpLayout('page')}
                    onEdit={handleFlowEdit}
                  />
                )}
                {/* The page editor stays mounted under the flow view: saving, sharing and
                    AI read the document through it. */}
                <div
                  className="mobile-hwp-layer"
                  data-hidden={hwpLayout === 'flow' ? 'true' : undefined}
                >
                  <HwpMobileEditor
                    ref={hwpEditorRef}
                    fileName={activeDoc.session.name}
                    documentBytes={hwpBytes}
                    mode={mode}
                    lang={lang}
                    theme={prefs.theme}
                    onDirty={handleHwpDirty}
                    onError={handleHwpError}
                  />
                </div>
              </>
            )}
          </EditorShell>
        )}

        <UnsavedModal
          open={unsavedPromptDoc !== null}
          docTitle={unsavedPromptDoc ?? ''}
          onChoice={resolveUnsavedChoice}
        />
        <ToastHost toast={toast} onDismiss={dismissToast} />
      </BackStackProvider>
    </MobileLocaleProvider>
  )
}
