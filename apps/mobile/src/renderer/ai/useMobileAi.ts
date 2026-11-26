// Owned by track T7: App.tsx is frozen after S0, so the AI run, AI settings and AI panel live here and T7's model picker, queue, change cards and "stop and turn off?" grow in this file.
import {
  Fragment,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  AgentLoop,
  composeSkills,
  type AgentImage,
  type AgentMessage,
  type AgentSkill,
  type ToolExecution,
} from '@genoffice/agent-core'
import { useAiInlineQuestions, useChatRunQueue } from '@genoffice/ui'
import { AI_SUBSCRIPTION_NOTICE_VERSION } from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import {
  createMobileAgentTransport,
  createMobileAiMemoryStore,
} from '@genoffice/mobile-bridge/ai-bridge'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type {
  MobileAiSettingsSnapshot,
  MobileChatGptStatus,
  MobileClient,
} from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { AiSheetPanel, type AiPanelChangeCard } from '../components/AiSheetPanel'
import type { EditorAiRun, EditorDocument } from '../editors/editorKind'
import type { SettingsScreenProps } from '../settings/SettingsScreen'
import type { MobileAiSettingsSlot } from './settingsSlot'
import { isMobileAiBlocked } from './blocked'
import {
  mobileCurrentModel,
  mobileModelAllowed,
  mobileModelGroups,
  mobileModelSeesPictures,
} from './modelChoice'
import { noticeForStreamError, type AiNotice } from './notices'
import { OutboundConfirmHost } from './OutboundConfirmSheet'
import {
  createMobileOutboundBridge,
  guardMobileOutbound,
  type MobileOutboundBridge,
} from './outbound'
import { pickPhotoFile, preparePhoto, type PendingPhoto } from './photos'
import { publishMobileAiRunState, registerMobileAiStopAll } from './runState'
import {
  abortMobileAiToolCalls,
  addMobileAiAttachment,
  bindMobileAiTools,
  clearMobileAiAttachments,
  onMobileAiToolSettingsChanged,
  refreshMobileAiToolSettings,
  removeMobileAiAttachment,
  resetMobileAiTools,
} from './tools/state'

const DEFAULT_AI_SETTINGS: MobileAiSettingsSnapshot = {
  selectedProvider: 'auto',
  modelByProvider: {},
  configuredProviders: {},
  chatgptVisible: false,
  subscriptionNoticeVersion: 0,
}

const DEFAULT_CHATGPT_STATUS: MobileChatGptStatus = { state: 'hidden' }

/** What the tool answer tells the model when the editor refused to send its document. */
const BLOCKED_TOOL_OUTPUT =
  'The document was not sent: the editor could not verify its hidden parts. The run was stopped.'

/** What App supplies; the getters read App's latest state through its refs. */
export interface UseMobileAiOptions {
  readonly client: MobileClient
  /** prefs.aiEnabled: off means nothing is sent and the panel shows the AI-off notice. */
  readonly aiEnabled: boolean
  /** Whether the active document may be changed (the panel's read-only hint). */
  readonly canMutate: boolean
  getActiveDoc(): ActiveDocState | null
  /** The active opened document; a document without createAiRun sends nothing. */
  getOpenedDocument(): EditorDocument | null
  getMode(): DocumentMode
  /** Puts the document in edit mode (state and App's mode ref) when the AI edits a viewed document. */
  setModeEdit(): void
  getLang(): Lang
  /** Shows the settings screen (the AI state is refreshed first). */
  openSettings(): void
}

/** The AI props App passes to SettingsScreen. */
export type MobileAiSettingsProps = Pick<
  SettingsScreenProps,
  | 'aiSettings'
  | 'chatgptStatus'
  | 'onSelectProvider'
  | 'onValidateAndSaveKey'
  | 'onRemoveKey'
  | 'onChatgptSignIn'
  | 'onChatgptSignOut'
>

export interface MobileAi {
  /** The AI panel element (EditorShell's aiPanelContent). */
  readonly panel: ReactElement
  readonly settingsProps: MobileAiSettingsProps
  readonly settingsSlot: MobileAiSettingsSlot
  /** Re-reads the AI settings and the ChatGPT status. */
  refreshAiState(): Promise<void>
  /**
   * Sends a message with the photos picked for it: at once when no run is
   * going (the promise settles when that run ends), else into the queue.
   */
  send(prompt: string): Promise<void>
  /** Stops the running AI request, if any, and holds the queue (stable). */
  cancel(): void
  /** Clears the conversation when the active document changes (stable). */
  resetForDocument(nextDocKey: string | null): void
}

/** One run that changed the document (decision 0151). */
interface ChangeCardEntry {
  readonly runId: number
  readonly summary: string
  /** only the most recent changing run keeps its undo */
  readonly undo: (() => void) | null
  readonly state: 'applied' | 'reverted'
  readonly busy: boolean
}

/** What a queued message keeps: the photos picked for it. */
interface QueueMeta {
  readonly photos: readonly PendingPhoto[]
}

/**
 * Catches "not sent because of hidden content" (blocked.ts) where an editor
 * throws it during a run: `buildContext` rethrows so the loop fails the run
 * before anything is sent; `executeTool` stops the run and answers an error,
 * so no further model request goes out.
 */
function watchBlocked(skill: AgentSkill, onBlocked: () => void): AgentSkill {
  const buildContext = skill.buildContext
  return {
    ...skill,
    ...(buildContext
      ? {
          buildContext: () => {
            try {
              return buildContext.call(skill)
            } catch (err) {
              if (isMobileAiBlocked(err)) onBlocked()
              throw err
            }
          },
        }
      : {}),
    executeTool: async (call, signal): Promise<ToolExecution> => {
      try {
        return await skill.executeTool(call, signal)
      } catch (err) {
        if (!isMobileAiBlocked(err)) throw err
        onBlocked()
        return { output: BLOCKED_TOOL_OUTPUT, isError: true, summary: call.name }
      }
    },
  }
}

export function useMobileAi(options: UseMobileAiOptions): MobileAi {
  const { client, aiEnabled, canMutate } = options
  const optionsRef = useRef(options)
  optionsRef.current = options

  const aiMemoryRef = useRef(createMobileAiMemoryStore())
  const [aiSettings, setAiSettings] = useState<MobileAiSettingsSnapshot>(DEFAULT_AI_SETTINGS)
  const [chatgptStatus, setChatgptStatus] = useState<MobileChatGptStatus>(DEFAULT_CHATGPT_STATUS)

  const [aiMessages, setAiMessages] = useState<readonly AgentMessage[]>([])
  // the run each message of the conversation belongs to (parallel to aiMessages)
  const [messageRuns, setMessageRuns] = useState<readonly number[]>([])
  const messageRunsRef = useRef<number[]>([])
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiAutoSwitched, setAiAutoSwitched] = useState(false)
  const [notice, setNotice] = useState<AiNotice | null>(null)
  const [cards, setCards] = useState<readonly ChangeCardEntry[]>([])
  const cardsRef = useRef<readonly ChangeCardEntry[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<readonly PendingPhoto[]>([])
  const pendingPhotosRef = useRef<readonly PendingPhoto[]>([])
  const [photoError, setPhotoError] = useState(false)
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; nonce: number } | null>(null)
  const restoreSeqRef = useRef(0)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  // the shared A2UI question card (ask_questions, decision 0164)
  const inlineQuestions = useAiInlineQuestions()
  const inlineQuestionsRef = useRef(inlineQuestions)
  inlineQuestionsRef.current = inlineQuestions
  const [lastAiPrompt, setLastAiPrompt] = useState<string | null>(null)

  const activeRunCancelRef = useRef<(() => void) | null>(null)
  // the truth about a run in flight (state lags a render behind)
  const runningRef = useRef(false)
  const runSeqRef = useRef(0)
  // a new conversation (document change) makes every older run's callbacks stale
  const convGenRef = useRef(0)
  // the run whose card's undo was pressed and has not been answered yet
  const undoPendingRef = useRef<number | null>(null)

  // the shared AI tools (ai/tools) read the latest AI state through these
  const aiEnabledRef = useRef(aiEnabled)
  aiEnabledRef.current = aiEnabled
  const aiSettingsRef = useRef(aiSettings)
  aiSettingsRef.current = aiSettings
  const chatgptStatusRef = useRef(chatgptStatus)
  chatgptStatusRef.current = chatgptStatus

  // decision 0062: the internet switch and the address question; the allowed
  // addresses live here for the conversation (every run gets a new guard)
  const outboundRef = useRef<MobileOutboundBridge | null>(null)
  outboundRef.current ??= createMobileOutboundBridge({
    readInternetTools: async () => {
      const settings = await refreshMobileAiToolSettings()
      return aiEnabledRef.current && settings?.internetTools === true
    },
  })
  const outbound = outboundRef.current

  useEffect(
    () =>
      bindMobileAiTools({
        client,
        getAiEnabled: () => aiEnabledRef.current,
        getAiSettings: () => aiSettingsRef.current,
        getChatgptStatus: () => chatgptStatusRef.current,
      }),
    [client],
  )
  // a switch changed in settings during a run reaches that run's guard
  useEffect(
    () =>
      onMobileAiToolSettingsChanged((settings) =>
        outbound.notifyInternetTools(aiEnabledRef.current && settings?.internetTools === true),
      ),
    [outbound],
  )

  const refreshAiState = useCallback(async () => {
    const [settings, cgStatus] = await Promise.all([
      client.getAiSettings().catch(() => DEFAULT_AI_SETTINGS),
      client.chatgptStatus().catch(() => DEFAULT_CHATGPT_STATUS),
    ])
    setAiSettings(settings)
    setChatgptStatus(cgStatus)
  }, [client])

  // ── the conversation ──────────────────────────────────────────────────────

  const syncConversation = useCallback(() => {
    setAiMessages(aiMemoryRef.current.getMessages())
    setMessageRuns([...messageRunsRef.current])
  }, [])

  const appendMessage = useCallback(
    (message: AgentMessage, runId: number) => {
      aiMemoryRef.current.append(message)
      messageRunsRef.current = [...messageRunsRef.current, runId]
      syncConversation()
    },
    [syncConversation],
  )

  /** Takes a run's messages out of the conversation (its message was not sent). */
  const dropRunMessages = useCallback(
    (runId: number) => {
      const messages = aiMemoryRef.current.getMessages()
      const runs = messageRunsRef.current
      const keptMessages: AgentMessage[] = []
      const keptRuns: number[] = []
      messages.forEach((message, index) => {
        if (runs[index] === runId) return
        keptMessages.push(message)
        keptRuns.push(runs[index] ?? 0)
      })
      aiMemoryRef.current.setMessages(keptMessages)
      messageRunsRef.current = keptRuns
      syncConversation()
    },
    [syncConversation],
  )

  const setPending = useCallback((next: readonly PendingPhoto[]) => {
    pendingPhotosRef.current = next
    setPendingPhotos(next)
  }, [])

  // ── change cards (decision 0151) ──────────────────────────────────────────

  const setCardsBoth = useCallback((next: readonly ChangeCardEntry[]) => {
    cardsRef.current = next
    setCards(next)
  }, [])

  /** The editor's setUndo for one run. */
  const applyUndo = useCallback(
    (runId: number, entry: { summary: string; undo: () => void } | null) => {
      const current = cardsRef.current
      if (entry) {
        const card: ChangeCardEntry = {
          runId,
          summary: entry.summary,
          undo: entry.undo,
          state: 'applied',
          busy: false,
        }
        // only the newest changing run can take itself back; earlier cards keep their summary
        const others = current
          .filter((c) => c.runId !== runId)
          .map((c) => (c.undo || c.busy ? { ...c, undo: null, busy: false } : c))
        setCardsBoth([...others, card].sort((a, b) => a.runId - b.runId))
        return
      }
      // a null right after the card's undo was pressed: that run was taken back
      const reverted = undoPendingRef.current === runId
      if (reverted) undoPendingRef.current = null
      setCardsBoth(
        current.map((c) =>
          c.runId !== runId
            ? c
            : reverted
              ? { ...c, state: 'reverted', undo: null, busy: false }
              : { ...c, undo: null, busy: false },
        ),
      )
    },
    [setCardsBoth],
  )

  const undoCard = useCallback(
    (runId: number) => {
      const card = cardsRef.current.find((c) => c.runId === runId)
      if (!card?.undo || card.busy || runningRef.current) return
      undoPendingRef.current = runId
      setCardsBoth(cardsRef.current.map((c) => (c.runId === runId ? { ...c, busy: true } : c)))
      try {
        card.undo()
      } catch {
        undoPendingRef.current = null
        setCardsBoth(cardsRef.current.map((c) => (c.runId === runId ? { ...c, busy: false } : c)))
      }
    },
    [setCardsBoth],
  )

  // ── the queue (PC's useChatRunQueue) ──────────────────────────────────────

  const runPromptRef = useRef<(prompt: string, photos: readonly PendingPhoto[]) => Promise<void>>(
    async () => {},
  )
  const queue = useChatRunQueue<QueueMeta>({
    busy: aiStreaming,
    submit: (text, meta) => {
      if (runningRef.current) return false
      void runPromptRef.current(text, meta.photos)
      return true
    },
  })
  const queueRef = useRef(queue)
  queueRef.current = queue

  const resetForDocument = useCallback(
    (nextDocKey: string | null) => {
      convGenRef.current += 1
      // the queue goes first, so the settle of the stopped run starts nothing
      queueRef.current.clear()
      activeRunCancelRef.current?.()
      // the stopped run's tool requests (a picture being made, a page being read) end too
      abortMobileAiToolCalls()
      aiMemoryRef.current.resetForDoc(nextDocKey)
      aiMemoryRef.current.clear()
      messageRunsRef.current = []
      inlineQuestionsRef.current.resetConversation()
      // a new conversation: the allowed addresses, the attached photos and the pages read go
      outboundRef.current?.reset()
      clearMobileAiAttachments()
      resetMobileAiTools()
      undoPendingRef.current = null
      setCardsBoth([])
      setPending([])
      setPhotoError(false)
      setRestoreDraft(null)
      setModelSheetOpen(false)
      setNotice(null)
      setAiMessages([])
      setMessageRuns([])
      setAiAutoSwitched(false)
    },
    [setCardsBoth, setPending],
  )

  /** A Stop (the panel's button, the app going to the background): the queue holds. */
  const cancel = useCallback(() => {
    queueRef.current.hold()
    activeRunCancelRef.current?.()
    abortMobileAiToolCalls()
  }, [])

  // ── one run ───────────────────────────────────────────────────────────────

  const runPrompt = async (prompt: string, photos: readonly PendingPhoto[]): Promise<void> => {
    const doc = optionsRef.current.getActiveDoc()
    const editorDoc = optionsRef.current.getOpenedDocument()
    if (!doc || !aiEnabledRef.current || !editorDoc?.createAiRun) return
    // a document that keeps AI away sends nothing, whatever reached here
    if (editorDoc.aiAvailable === false) return
    if (runningRef.current) {
      queueRef.current.enqueue(prompt, { photos })
      return
    }
    runningRef.current = true
    const runId = ++runSeqRef.current
    const gen = convGenRef.current
    const stale = () => gen !== convGenRef.current
    let stopped = false
    let blocked = false
    let classifiedError = false
    let loop: AgentLoop | null = null
    let resolveRun: (() => void) | null = null
    let run: EditorAiRun | null = null
    const ownCancel = () => {
      stopped = true
      loop?.cancel()
      resolveRun?.()
    }
    activeRunCancelRef.current = ownCancel

    setLastAiPrompt(prompt)
    setNotice(null)
    setPhotoError(false)
    setAiStreaming(true)
    // the message shows at once; reading the document for the tools comes after
    const history = [...aiMemoryRef.current.getMessages()]
    appendMessage({ role: 'user', text: prompt }, runId)
    // the photos of this message stay with the conversation (the tools' attachments())
    // one copy of each photo: the store keeps the same base64 string the message sends
    const attached = photos.map((p) =>
      addMobileAiAttachment({ name: p.name, mime: p.mime, base64: p.base64 }),
    )
    const images: AgentImage[] = photos.map((p) => ({ base64: p.base64, mime: p.mime }))

    const caps = {
      writable: doc.session.writable,
      encrypted: doc.encrypted,
      distribution: doc.distribution,
      isUntitled: doc.isUntitled,
    }
    const switchToEdit = () => {
      optionsRef.current.setModeEdit()
      setAiAutoSwitched(true)
    }
    const markBlocked = () => {
      if (blocked) return
      blocked = true
      loop?.cancel()
      abortMobileAiToolCalls()
    }

    try {
      // the tool settings first: the document's tools ask availability() while they are made,
      // and the guard's first tool list needs the internet switch already read
      await outbound.prime()
      if (stopped || stale()) return

      // the document's tools (read before the run; failing to prepare them is a connection error)
      try {
        run = await editorDoc.createAiRun({
          getMode: () => optionsRef.current.getMode(),
          getCapabilities: () => caps,
          switchToEdit,
          setUndo: (entry) => {
            if (!stale()) applyUndo(runId, entry)
          },
          getLang: () => optionsRef.current.getLang(),
        })
      } catch (err) {
        if (isMobileAiBlocked(err)) blocked = true
        else if (!stale()) setNotice({ kind: 'connection-error' })
        return
      }
      if (stopped || stale()) return

      const base: AgentSkill = run.skill
      // every document can ask through the shared question card
      inlineQuestionsRef.current.supersedeOpen()
      const composed = composeSkills(base.id, '', [
        base,
        inlineQuestionsRef.current.askQuestionsSkill,
      ])
      // the address check reads the loop's whole history, tool results included
      const skill = guardMobileOutbound(
        watchBlocked(composed, markBlocked),
        outbound,
        () => loop?.messages ?? [],
      )

      const transport = createMobileAgentTransport(client, {
        onStreamError: (detail) => {
          classifiedError = true
          if (!blocked && !stale()) setNotice(noticeForStreamError(detail))
        },
      })

      await new Promise<void>((resolve) => {
        resolveRun = resolve
        const agentLoop = new AgentLoop({
          transport,
          skill,
          events: {
            onDone: (result) => {
              if (result.text && !blocked && !stale()) {
                appendMessage({ role: 'assistant', text: result.text }, runId)
              }
              resolve()
            },
            onError: () => {
              if (!blocked && !classifiedError && !stale()) {
                setNotice((prev) => prev ?? { kind: 'connection-error' })
              }
              resolve()
            },
          },
        })
        loop = agentLoop
        if (history.length > 0) agentLoop.appendHistory(history)
        if (stopped) {
          resolve()
          return
        }
        agentLoop.run(prompt, images.length > 0 ? images : undefined)
      })
    } finally {
      if (blocked && !stale()) {
        // not sent: the message goes back into the composer, its photos back to the chips,
        // and the queue holds (the next message would be refused for the same reason)
        queueRef.current.hold()
        dropRunMessages(runId)
        for (const photo of attached) removeMobileAiAttachment(photo.id)
        setPending([...photos, ...pendingPhotosRef.current])
        restoreSeqRef.current += 1
        setRestoreDraft({ text: prompt, nonce: restoreSeqRef.current })
        setNotice({ kind: 'blocked-hidden' })
      }
      if (activeRunCancelRef.current === ownCancel) activeRunCancelRef.current = null
      outbound.endRun()
      try {
        run?.finish?.()
      } catch {
        // the editor's clean-up failing must not wedge the panel
      }
      runningRef.current = false
      setAiStreaming(false)
    }
  }
  runPromptRef.current = runPrompt

  /** The panel's send (composer, quick requests, resend): now, or into the queue. */
  const submitPrompt = useCallback(
    (prompt: string): Promise<void> => {
      const photos = pendingPhotosRef.current
      setPending([])
      if (runningRef.current) {
        queueRef.current.enqueue(prompt, { photos })
        return Promise.resolve()
      }
      return runPromptRef.current(prompt, photos)
    },
    [setPending],
  )

  const stopAll = useCallback(() => {
    queueRef.current.clear()
    activeRunCancelRef.current?.()
    abortMobileAiToolCalls()
  }, [])

  // AI-T6's "stop and turn off?" reads this store and stops through it
  useEffect(() => registerMobileAiStopAll(stopAll), [stopAll])
  useEffect(() => {
    publishMobileAiRunState({ running: aiStreaming, queued: queue.queued.length })
  }, [aiStreaming, queue.queued.length])

  // AI turned off (in settings or anywhere else): the run stops and the queue empties
  useEffect(() => {
    if (aiEnabled) return
    stopAll()
    setModelSheetOpen(false)
  }, [aiEnabled, stopAll])

  // ── the model picker ──────────────────────────────────────────────────────

  const currentModel = useMemo(
    () => mobileCurrentModel(aiSettings, chatgptStatus),
    [aiSettings, chatgptStatus],
  )
  const modelGroups = useMemo(() => mobileModelGroups(aiSettings), [aiSettings])

  const chooseModel = (provider: string, model: string) => {
    if (runningRef.current) return
    if (!mobileModelAllowed(aiSettingsRef.current, provider, model)) return
    setModelSheetOpen(false)
    setNotice((prev) => (prev?.kind === 'free-tier-model' ? null : prev))
    void client
      .setAiSettings({ selectedProvider: provider, modelPatch: { provider, model } })
      .then(setAiSettings)
      .catch(() => {})
  }

  // ── photos ────────────────────────────────────────────────────────────────

  const addPhoto = () => {
    setPhotoError(false)
    void (async () => {
      const file = await pickPhotoFile()
      if (!file) return
      try {
        const photo = await preparePhoto(file)
        setPending([...pendingPhotosRef.current, photo])
      } catch {
        setPhotoError(true)
      }
    })()
  }

  // what the settings' AI rows need beyond SettingsScreen's props (ai/settingsSlot.ts)
  const settingsSlot = useMemo<MobileAiSettingsSlot>(
    () => ({ client, applyAiSettings: setAiSettings }),
    [client],
  )

  const settingsProps: MobileAiSettingsProps = {
    aiSettings,
    chatgptStatus,
    onSelectProvider: (provider) => {
      void client.setAiSettings({ selectedProvider: provider }).then(setAiSettings)
    },
    onValidateAndSaveKey: async ({ provider, apiKey, freeOnly }) => {
      const validated = await client.validateAiKey({ provider, apiKey, freeOnly })
      if (!validated.ok) {
        throw new Error('API key validation failed.')
      }
      const updated = await client.setAiSettings({
        selectedProvider: provider,
        providerKeyPatch: { provider, apiKey, freeOnly },
        ...(validated.models[0] ? { modelPatch: { provider, model: validated.models[0] } } : {}),
      })
      setAiSettings(updated)
    },
    onRemoveKey: async (provider) => {
      const updated = await client.setAiSettings({
        providerKeyPatch: { provider, apiKey: null },
      })
      setAiSettings(updated)
    },
    onChatgptSignIn: async (reconsent) => {
      await client.chatgptSignIn(reconsent)
      await refreshAiState()
    },
    onChatgptSignOut: async () => {
      await client.chatgptSignOut()
      await refreshAiState()
    },
  }

  // a card sits under the last message of its run (or the last one before it, if the run's went)
  const changeCards: AiPanelChangeCard[] = cards.map((card) => {
    let afterIndex = -1
    for (let i = messageRuns.length - 1; i >= 0; i -= 1) {
      if ((messageRuns[i] ?? 0) <= card.runId) {
        afterIndex = i
        break
      }
    }
    return {
      id: card.runId,
      afterIndex,
      summary: card.summary,
      state: card.state,
      ...(card.undo ? { onUndo: () => undoCard(card.runId) } : {}),
      undoBusy: card.busy,
    }
  })

  const sheetPanel = createElement(AiSheetPanel, {
    aiEnabled,
    aiSettings,
    chatgptStatus,
    messages: aiMessages,
    streaming: aiStreaming,
    canMutate,
    autoSwitchedNotice: aiAutoSwitched,
    recoveryNotice: notice?.kind ?? null,
    noticeResetsAt: notice?.resetsAt ?? null,
    onSend: (p: string) => void submitPrompt(p),
    onStop: cancel,
    // a card shows while its run lasts; the reply that follows carries the answer
    questionCard:
      inlineQuestions.activeToolCard &&
      (aiStreaming || inlineQuestions.activeToolCard.status === 'open')
        ? inlineQuestions.activeToolCard
        : null,
    onQuestionSubmit: inlineQuestions.submitToolCard,
    onQuestionSkip: inlineQuestions.skipToolCard,
    onOpenSettings: () => {
      void refreshAiState()
      optionsRef.current.openSettings()
    },
    onAcknowledgeSubscriptionNotice: () => {
      void client
        .setAiSettings({ subscriptionNoticeVersion: AI_SUBSCRIPTION_NOTICE_VERSION })
        .then(setAiSettings)
    },
    onChatgptReconsent: () => void client.chatgptSignIn(true).then(refreshAiState),
    onChatgptReconnect: () => void client.chatgptSignIn(false).then(refreshAiState),
    onRetryLast: lastAiPrompt ? () => void submitPrompt(lastAiPrompt) : undefined,
    currentModel,
    modelGroups,
    modelSheetOpen,
    onOpenModelSheet: () => {
      if (!runningRef.current) setModelSheetOpen(true)
    },
    onCloseModelSheet: () => setModelSheetOpen(false),
    onChooseModel: chooseModel,
    changeCards,
    queue: {
      items: queue.queued,
      paused: queue.paused,
      onResume: () => queueRef.current.setPaused(false),
      onClear: () => queueRef.current.clear(),
      onUpdate: (id: string, text: string) => queueRef.current.update(id, text),
      onMove: (id: string, toIndex: number) => queueRef.current.move(id, toIndex),
      onRemove: (id: string) => queueRef.current.remove(id),
    },
    photos: pendingPhotos,
    photosAllowed: mobileModelSeesPictures(currentModel),
    onAddPhoto: addPhoto,
    onRemovePhoto: (id: string) => setPending(pendingPhotosRef.current.filter((p) => p.id !== id)),
    photoError,
    restoreDraft,
  })
  // the address question sits with the panel: while the panel is off screen nothing is asked
  const panel = createElement(
    Fragment,
    null,
    sheetPanel,
    createElement(OutboundConfirmHost, { bridge: outbound }),
  )

  return {
    panel,
    settingsProps,
    settingsSlot,
    refreshAiState,
    send: submitPrompt,
    cancel,
    resetForDocument,
  }
}
