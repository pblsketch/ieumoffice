import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentLoop, composeSkills, type AgentMessage, type AgentSkill } from '@genoffice/agent-core'
import { useAiInlineQuestions } from '@genoffice/ui'
import { AI_SUBSCRIPTION_NOTICE_VERSION } from '@genoffice/ai-provider/browser'
import { normalizeLang, type Lang } from '@genoffice/i18n'
import {
  createMobileAgentTransport,
  createMobileAiMemoryStore,
} from '@genoffice/mobile-bridge/ai-bridge'
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
import type { EditorAiRun, EditorDocument, EditorHost, EditorKind } from './editors/editorKind'
import { findEditorKind, openableExtensions } from './editors/registry'
import { MobileLocaleProvider, translateMobile } from './i18n'
import { SettingsScreen } from './settings/SettingsScreen'
import { BackStackProvider } from './shell/backStack'
import type { EditorSaveState } from './shell/EditorShell'
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
  const [openedDoc, setOpenedDoc] = useState<OpenedDocument | null>(null)
  const openedDocRef = useRef<OpenedDocument | null>(null)
  const openSeqRef = useRef(0)
  // Bumped on every content change the document reports: restarts the recovery idle timer.
  const [contentVersion, setContentVersion] = useState(0)
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast()
  const [saving, setSaving] = useState(false)

  const [aiMessages, setAiMessages] = useState<readonly AgentMessage[]>([])
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiAutoSwitched, setAiAutoSwitched] = useState(false)
  const [aiRecoveryNotice, setAiRecoveryNotice] = useState<ChatGptRecoveryNoticeKind>(null)
  const [lastAiUndo, setLastAiUndo] = useState<{ summary: string; undo: () => void } | null>(null)
  // the shared A2UI question card (ask_questions, decision 0164)
  const inlineQuestions = useAiInlineQuestions()
  const inlineQuestionsRef = useRef(inlineQuestions)
  inlineQuestionsRef.current = inlineQuestions
  const [lastAiPrompt, setLastAiPrompt] = useState<string | null>(null)

  const [unsavedPromptDoc, setUnsavedPromptDoc] = useState<string | null>(null)
  const unsavedResolverRef = useRef<((choice: UnsavedSwitchChoice) => void) | null>(null)

  const activeRunCancelRef = useRef<(() => void) | null>(null)

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
        activeRunCancelRef.current?.()
        aiMemoryRef.current.resetForDoc(nextDocKey)
        inlineQuestionsRef.current.resetConversation()
        setAiMessages([])
        setLastAiUndo(null)
        setAiAutoSwitched(false)
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

      const pending = await client.consumePendingOpenIntent().catch((err) => {
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

  const handleSendAi = useCallback(
    async (prompt: string) => {
      const doc = activeDocRef.current
      const editorDoc = openedDocRef.current?.doc
      if (!doc || !prefs.aiEnabled || !editorDoc?.createAiRun) return
      setLastAiPrompt(prompt)
      setAiRecoveryNotice(null)
      setAiStreaming(true)
      let classifiedError = false
      // the message shows at once; reading the document for the tools comes after
      const history = [...aiMemoryRef.current.getMessages()]
      aiMemoryRef.current.append({ role: 'user', text: prompt })
      setAiMessages(aiMemoryRef.current.getMessages())

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

      // the document's tools (read before the run; failing to prepare them is a connection error)
      let run: EditorAiRun
      try {
        run = await editorDoc.createAiRun({
          getMode: () => modeRef.current,
          getCapabilities: () => caps,
          switchToEdit,
          setUndo: (entry) => setLastAiUndo(entry),
          getLang: () => langRef.current,
        })
      } catch {
        setAiRecoveryNotice('connection-error')
        setAiStreaming(false)
        return
      }
      const base: AgentSkill = run.skill
      // every document can ask through the shared question card
      inlineQuestionsRef.current.supersedeOpen()
      const skill = composeSkills(base.id, '', [base, inlineQuestionsRef.current.askQuestionsSkill])

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
      run.finish?.()
    },
    [client, prefs.aiEnabled],
  )

  const handleUpdatePrefs = useCallback(
    async (patch: MobileAppPrefsPatch) => {
      const updated = await client.setAppPrefs(patch)
      setPrefs(updated)
    },
    [client],
  )

  const canEditActive =
    activeDoc && openedDoc
      ? canMutateDocument({
          writable: activeDoc.session.writable,
          encrypted: activeDoc.encrypted,
          distribution: activeDoc.distribution,
          isUntitled: activeDoc.isUntitled,
        }) && openedDoc.kind.editable
      : false

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
              aiPanelContent: (
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
                  // a card shows while its run lasts; the reply that follows carries the answer
                  questionCard={
                    inlineQuestions.activeToolCard &&
                    (aiStreaming || inlineQuestions.activeToolCard.status === 'open')
                      ? inlineQuestions.activeToolCard
                      : null
                  }
                  onQuestionSubmit={inlineQuestions.submitToolCard}
                  onQuestionSkip={inlineQuestions.skipToolCard}
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
              ),
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
        <ToastHost toast={toast} onDismiss={dismissToast} />
      </BackStackProvider>
    </MobileLocaleProvider>
  )
}
