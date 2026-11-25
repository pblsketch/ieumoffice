import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeLang, type Lang } from '@genoffice/i18n'
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
  type MobileAppPrefs,
  type MobileAppPrefsPatch,
  type MobileClient,
  type MobileDocFormat,
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
import { useMobileAi } from './ai/useMobileAi'
import { HomeScreen } from './components/HomeScreen'
import { ToastHost, useToast } from './components/Toast'
import { UnsavedModal } from './components/UnsavedModal'
import type { EditorDocument, EditorHost, EditorKind } from './editors/editorKind'
import { findEditorKind, openableExtensions } from './editors/registry'
import { confirmEditorOn } from './home/editorGate'
import { HomeAppLayer } from './home/HomeAppLayer'
import type { HomeHost } from './home/homeHost'
import { takeIncomingDocument } from './home/incoming'
import { MobileLocaleProvider, translateMobile } from './i18n'
import { DEFAULT_PREFS } from './settings/defaultPrefs'
import { SettingsScreen } from './settings/SettingsScreen'
import { BackStackProvider } from './shell/backStack'
import type { EditorSaveState } from './shell/EditorShell'
import { useViewportLayout } from './shell/useViewportLayout'

function editorSaveState(saving: boolean, dirty: boolean): EditorSaveState {
  if (saving) return 'saving'
  return dirty ? 'dirty' : 'saved'
}

const RECOVERY_IDLE_MS = 2000
const RECOVERY_PERIODIC_MS = 30000

type ScreenView = 'home' | 'editor' | 'settings'

/** The backend's open gate refused the file (its format has no registered editor). */
function isFormatNotOpenable(err: unknown): boolean {
  return isMobileCommandError(err) && err.messageKey === 'mobile.format.notOpenable'
}

/** The active document, the kind that opened it and which open it was (the Workspace key). */
interface OpenedDocument {
  readonly kind: EditorKind
  readonly doc: EditorDocument
  readonly seq: number
}

export interface MobileAppProps {
  readonly client?: MobileClient
}

export function MobileApp({ client: injectedClient }: MobileAppProps) {
  const client = useMemo(
    () => injectedClient ?? createMobileClient(createTauriMobileTransport()),
    [injectedClient],
  )
  // Publishes data-window and --m-kb on <html> for every screen, not only the editor.
  const viewport = useViewportLayout()
  const windowClassRef = useRef(viewport.windowClass)
  windowClassRef.current = viewport.windowClass

  const [screen, setScreen] = useState<ScreenView>('home')
  const [prefs, setPrefs] = useState<MobileAppPrefs>(DEFAULT_PREFS)
  const [recentDocs, setRecentDocs] = useState<RecentDocEntry[]>([])
  const [recoveryEntries, setRecoveryEntries] = useState<RecoveryEntry[]>([])
  const [backups, setBackups] = useState<HwpBackupEntry[]>([])
  const [permissionDeniedRecentId, setPermissionDeniedRecentId] = useState<string | null>(null)

  const [activeDoc, setActiveDoc] = useState<ActiveDocState | null>(null)
  const [mode, setMode] = useState<DocumentMode>('view')
  const [openedDoc, setOpenedDoc] = useState<OpenedDocument | null>(null)
  const openedDocRef = useRef<OpenedDocument | null>(null)
  const openSeqRef = useRef(0)
  // Bumped on every content change the document reports: restarts the recovery idle timer.
  const [contentVersion, setContentVersion] = useState(0)
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast()
  const [saving, setSaving] = useState(false)

  const [unsavedPromptDoc, setUnsavedPromptDoc] = useState<string | null>(null)
  const unsavedResolverRef = useRef<((choice: UnsavedSwitchChoice) => void) | null>(null)

  const lang: Lang = normalizeLang(prefs.lang)
  const langRef = useRef(lang)
  langRef.current = lang
  const tNow = useCallback(
    (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key),
    [lang],
  )

  const modeRef = useRef(mode)
  modeRef.current = mode
  const activeDocRef = useRef(activeDoc)
  activeDocRef.current = activeDoc

  const canEditActive =
    activeDoc && openedDoc
      ? canMutateDocument({
          writable: activeDoc.session.writable,
          encrypted: activeDoc.encrypted,
          distribution: activeDoc.distribution,
          isUntitled: activeDoc.isUntitled,
        }) && openedDoc.kind.editable
      : false

  const ai = useMobileAi({
    client,
    aiEnabled: prefs.aiEnabled,
    canMutate: canEditActive,
    getActiveDoc: () => activeDocRef.current,
    getOpenedDocument: () => openedDocRef.current?.doc ?? null,
    getMode: () => modeRef.current,
    setModeEdit: () => {
      setMode('edit')
      modeRef.current = 'edit'
    },
    getLang: () => langRef.current,
    openSettings: () => setScreen('settings'),
  })
  const { refreshAiState, resetForDocument: resetAiForDocument, cancel: cancelAiRun } = ai

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
      // a kind without saving does not save
      return (await openedDocRef.current?.doc.save?.(doc, forceSaveAs)) ?? false
    },
    [],
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
        resetAiForDocument(nextDocKey)
      },
      onSessionChanged: (next) => {
        setActiveDoc(next)
      },
    })
  }

  /** Refusal of a file whose format no registered editor opens (spec: open gate). */
  const notifyNotOpenable = useCallback(() => {
    showToast({ message: tNow('formatNotOpenable'), tone: 'error' })
  }, [showToast, tNow])

  const openLoadedSessionRef = useRef<(session: MobileDocSession) => Promise<void>>(async () => {})

  /** What App lends the open document (stable; reads the latest state through refs). */
  const editorHost = useMemo<EditorHost>(
    () => ({
      client,
      markDirty: (dirty) => sessionControllerRef.current?.markDirty(dirty),
      updateSession: (meta) => sessionControllerRef.current?.updateSessionMetadata(meta),
      setNotice: (text) => setNoticeBanner(text),
      showToast: (input) => showToast(input),
      contentChanged: () => setContentVersion((version) => version + 1),
      refreshHome: () => refreshHomeData(),
      openSession: (session) => openLoadedSessionRef.current(session),
      translate: (key, params) => translateMobile(langRef.current, key, params),
      windowClass: () => windowClassRef.current,
    }),
    [client, refreshHomeData, showToast],
  )

  const openLoadedSession = useCallback(
    async (
      session: MobileDocSession,
      options?: { isUntitled?: boolean; recoveryBytesBase64?: string },
    ) => {
      const controller = sessionControllerRef.current!
      const kind = findEditorKind(session.format)
      if (!kind) {
        notifyNotOpenable()
        return
      }
      if (!(await confirmEditorOn(kind, client))) return
      const isUntitled =
        options?.isUntitled ?? (!session.writable && !session.ephemeral && !session.uriHint)

      const opened = await kind.open({
        session,
        client,
        isUntitled,
        recoveryBytesBase64: options?.recoveryBytesBase64,
      })

      const outcome = await controller.switchTo(async () => ({
        session,
        encrypted: opened.encrypted,
        distribution: opened.distribution,
        trackingDropped: opened.trackingDropped,
        isUntitled,
      }))
      if (!outcome.switched) return
      openSeqRef.current += 1
      const next: OpenedDocument = {
        kind,
        doc: opened.start(editorHost),
        seq: openSeqRef.current,
      }
      openedDocRef.current = next
      setOpenedDoc(next)
      setMode(initialDocumentMode({ isUntitled }))
      setNoticeBanner(opened.noticeKey ? tNow(opened.noticeKey) : null)
      setScreen('editor')
      await refreshHomeData()
    },
    [client, editorHost, notifyNotOpenable, refreshHomeData, tNow],
  )
  openLoadedSessionRef.current = openLoadedSession

  // Initial load + external Share-In / Open-With intent check.
  useEffect(() => {
    let mounted = true
    void (async () => {
      const [loadedPrefs] = await Promise.all([
        client.getAppPrefs().catch(() => DEFAULT_PREFS),
        refreshHomeData(),
        refreshAiState(),
        // the open gate: only the registered editors' formats open
        client.setOpenableExtensions(openableExtensions()).catch(() => {}),
      ])
      if (!mounted) return
      setPrefs(loadedPrefs)

      const pending = await takeIncomingDocument(client).catch((err) => {
        if (isFormatNotOpenable(err)) notifyNotOpenable()
        return null
      })
      if (pending && mounted) {
        await openLoadedSession(pending, { isUntitled: false })
      }
    })()
    return () => {
      mounted = false
    }
  }, [client, notifyNotOpenable, openLoadedSession, refreshAiState, refreshHomeData])

  // Write recovery copy on idle, periodic tick, and backgrounding; cancel active AI stream on hide.
  const writeRecoveryNow = useCallback(async () => {
    const doc = activeDocRef.current
    if (!doc || !doc.dirty || doc.encrypted || doc.distribution) return
    // a kind without a recovery copy writes none
    await openedDocRef.current?.doc.writeRecovery?.(doc)
  }, [])

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
  }, [activeDoc?.dirty, contentVersion, writeRecoveryNow])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        cancelAiRun()
        void writeRecoveryNow()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [cancelAiRun, writeRecoveryNow])

  const handleCreateNew = useCallback(
    async (format: MobileDocFormat) => {
      const session = await client.createUntitledSession(format)
      await openLoadedSession(session, { isUntitled: true })
    },
    [client, openLoadedSession],
  )

  const openSettingsFromHome = useCallback(() => {
    void refreshAiState()
    void refreshHomeData()
    setScreen('settings')
  }, [refreshAiState, refreshHomeData])

  /** What the home's tabs and sheets (T6, T3) may ask of the app. */
  const homeHost = useMemo<HomeHost>(
    () => ({
      client,
      openSession: (session) => openLoadedSession(session),
      createNew: (format) => handleCreateNew(format),
      showToast: (input) => showToast(input),
      refreshHome: refreshHomeData,
      openSettings: openSettingsFromHome,
      openUntitledCopy: async ({ format, name, bytesBase64 }) => {
        const kind = findEditorKind(format)
        if (!kind) {
          notifyNotOpenable()
          return
        }
        const session = await client.createUntitledSession(kind.recoveryFormat(format))
        await openLoadedSession(
          { ...session, name },
          { isUntitled: true, recoveryBytesBase64: bytesBase64 },
        )
        sessionControllerRef.current?.markDirty(true)
      },
    }),
    [
      client,
      handleCreateNew,
      notifyNotOpenable,
      openLoadedSession,
      openSettingsFromHome,
      refreshHomeData,
      showToast,
    ],
  )

  const handlePickOpenFile = useCallback(async () => {
    try {
      const session = await client.pickOpenFile(openableExtensions())
      setPermissionDeniedRecentId(null)
      await openLoadedSession(session, { isUntitled: false })
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      if (isFormatNotOpenable(err)) {
        notifyNotOpenable()
        return
      }
      setNoticeBanner(err instanceof Error ? err.message : String(err))
    }
  }, [client, notifyNotOpenable, openLoadedSession])

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
        if (isFormatNotOpenable(err)) {
          notifyNotOpenable()
          return
        }
        setNoticeBanner(err instanceof Error ? err.message : String(err))
      }
    },
    [client, notifyNotOpenable, openLoadedSession],
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
      try {
        const bytesBase64 = await client.recoveryRead(entry.docKey)
        const kind = findEditorKind(entry.format)
        if (!kind) {
          notifyNotOpenable()
          return
        }
        const session = await client.createUntitledSession(kind.recoveryFormat(entry.format))
        await openLoadedSession(
          { ...session, name: entry.title },
          { isUntitled: true, recoveryBytesBase64: bytesBase64 },
        )
        sessionControllerRef.current?.markDirty(true)
      } catch (err) {
        if (!isFormatNotOpenable(err)) throw err
        notifyNotOpenable()
      }
    },
    [client, notifyNotOpenable, openLoadedSession],
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
      openedDocRef.current = null
      setOpenedDoc(null)
      setScreen('home')
      setNoticeBanner(null)
      await refreshHomeData()
    }
  }, [refreshHomeData])

  const handleShare = useCallback(async () => {
    const doc = activeDocRef.current
    if (!doc) return
    await openedDocRef.current?.doc.share(doc)
  }, [])

  const handleUpdatePrefs = useCallback(
    async (patch: MobileAppPrefsPatch) => {
      const updated = await client.setAppPrefs(patch)
      setPrefs(updated)
    },
    [client],
  )

  const ActiveWorkspace = openedDoc?.doc.Workspace ?? null

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
            onOpenSettings={openSettingsFromHome}
            host={homeHost}
          />
        )}

        {screen === 'settings' && (
          <SettingsScreen
            prefs={prefs}
            {...ai.settingsProps}
            backups={backups}
            onBack={() => setScreen(activeDoc ? 'editor' : 'home')}
            onUpdatePrefs={(patch) => void handleUpdatePrefs(patch)}
            onRestoreBackup={async (backupId, target: MobileRestoreTarget) => {
              try {
                const res = await client.hwpBackupRestore(backupId, target)
                await refreshHomeData()
                if (res.session) {
                  await openLoadedSession(res.session, { isUntitled: false })
                }
              } catch (err) {
                if (!isFormatNotOpenable(err)) throw err
                notifyNotOpenable()
              }
            }}
            onDeleteBackup={async (backupId) => {
              await client.hwpBackupDelete(backupId)
              await refreshHomeData()
            }}
            aiSlot={ai.settingsSlot}
          />
        )}

        {screen === 'editor' && activeDoc && openedDoc && ActiveWorkspace && (
          <ActiveWorkspace
            key={openedDoc.seq}
            frame={{
              docTitle: activeDoc.session.name,
              docFormat: activeDoc.session.format,
              saveState: editorSaveState(saving, activeDoc.dirty),
              mode,
              canEdit: canEditActive,
              aiEnabled: prefs.aiEnabled && openedDoc.kind.hasAi,
              noticeBanner,
              onDismissNotice: () => setNoticeBanner(null),
              onBack: () => void handleBackFromEditor(),
              onEnterEdit: () => setMode('edit'),
              onDone: () => void handleDone(),
              onExitEdit: () => setMode('view'),
              onSave: () => void runSave(activeDoc, false),
              onSaveAs: () => void runSave(activeDoc, true),
              onShare: () => void handleShare(),
              onOpenBackups: () => {
                void refreshHomeData()
                setScreen('settings')
              },
              aiPanelContent: ai.panel,
            }}
            mode={mode}
            canEdit={canEditActive}
            lang={lang}
            theme={prefs.theme}
          />
        )}

        <UnsavedModal
          open={unsavedPromptDoc !== null}
          docTitle={unsavedPromptDoc ?? ''}
          onChoice={resolveUnsavedChoice}
        />
        <HomeAppLayer
          host={homeHost}
          screen={screen}
          activeDoc={
            activeDoc
              ? {
                  session: activeDoc.session,
                  encrypted: activeDoc.encrypted,
                  distribution: activeDoc.distribution,
                  isUntitled: activeDoc.isUntitled,
                }
              : null
          }
          mode={mode}
        />
        <ToastHost toast={toast} onDismiss={dismissToast} />
      </BackStackProvider>
    </MobileLocaleProvider>
  )
}
