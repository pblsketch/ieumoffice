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
import { AgentLoop, composeSkills, type AgentMessage, type AgentSkill } from '@genoffice/agent-core'
import { useAiInlineQuestions } from '@genoffice/ui'
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
import { AiSheetPanel, type ChatGptRecoveryNoticeKind } from '../components/AiSheetPanel'
import type { EditorAiRun, EditorDocument } from '../editors/editorKind'
import type { SettingsScreenProps } from '../settings/SettingsScreen'
import type { MobileAiSettingsSlot } from './settingsSlot'
import { OutboundConfirmHost } from './OutboundConfirmSheet'
import {
  createMobileOutboundBridge,
  guardMobileOutbound,
  type MobileOutboundBridge,
} from './outbound'
import {
  bindMobileAiTools,
  clearMobileAiAttachments,
  onMobileAiToolSettingsChanged,
  refreshMobileAiToolSettings,
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
  send(prompt: string): Promise<void>
  /** Stops the running AI request, if any. */
  cancel(): void
  /** Clears the conversation when the active document changes (stable). */
  resetForDocument(nextDocKey: string | null): void
}

export function useMobileAi(options: UseMobileAiOptions): MobileAi {
  const { client, aiEnabled, canMutate } = options
  const optionsRef = useRef(options)
  optionsRef.current = options

  const aiMemoryRef = useRef(createMobileAiMemoryStore())
  const [aiSettings, setAiSettings] = useState<MobileAiSettingsSnapshot>(DEFAULT_AI_SETTINGS)
  const [chatgptStatus, setChatgptStatus] = useState<MobileChatGptStatus>(DEFAULT_CHATGPT_STATUS)

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

  const activeRunCancelRef = useRef<(() => void) | null>(null)

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

  const resetForDocument = useCallback((nextDocKey: string | null) => {
    activeRunCancelRef.current?.()
    aiMemoryRef.current.resetForDoc(nextDocKey)
    inlineQuestionsRef.current.resetConversation()
    // a new conversation: the allowed addresses, the attached photos and the pages read go
    outboundRef.current?.reset()
    clearMobileAiAttachments()
    resetMobileAiTools()
    setAiMessages([])
    setLastAiUndo(null)
    setAiAutoSwitched(false)
  }, [])

  const cancel = useCallback(() => {
    activeRunCancelRef.current?.()
  }, [])

  const handleSendAi = useCallback(
    async (prompt: string) => {
      const doc = optionsRef.current.getActiveDoc()
      const editorDoc = optionsRef.current.getOpenedDocument()
      if (!doc || !aiEnabled || !editorDoc?.createAiRun) return
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
        optionsRef.current.setModeEdit()
        setAiAutoSwitched(true)
      }

      // the tool settings first: the document's tools ask availability() while they are made,
      // and the guard's first tool list needs the internet switch already read
      await outbound.prime()

      // the document's tools (read before the run; failing to prepare them is a connection error)
      let run: EditorAiRun
      try {
        run = await editorDoc.createAiRun({
          getMode: () => optionsRef.current.getMode(),
          getCapabilities: () => caps,
          switchToEdit,
          setUndo: (entry) => setLastAiUndo(entry),
          getLang: () => optionsRef.current.getLang(),
        })
      } catch {
        setAiRecoveryNotice('connection-error')
        setAiStreaming(false)
        return
      }
      const base: AgentSkill = run.skill
      // every document can ask through the shared question card
      inlineQuestionsRef.current.supersedeOpen()
      const composed = composeSkills(base.id, '', [
        base,
        inlineQuestionsRef.current.askQuestionsSkill,
      ])
      // the address check reads the loop's whole history, tool results included
      let activeLoop: AgentLoop | null = null
      const skill = guardMobileOutbound(composed, outbound, () => activeLoop?.messages ?? [])

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
        activeLoop = loop
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
      outbound.endRun()
      setAiStreaming(false)
      run.finish?.()
    },
    [client, aiEnabled, outbound],
  )

  const settingsSlot = useMemo<MobileAiSettingsSlot>(() => ({}), [])

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

  const sheetPanel = createElement(AiSheetPanel, {
    aiEnabled,
    aiSettings,
    chatgptStatus,
    messages: aiMessages,
    streaming: aiStreaming,
    canMutate,
    autoSwitchedNotice: aiAutoSwitched,
    recoveryNotice: aiRecoveryNotice,
    lastChangeSummary: lastAiUndo?.summary ?? null,
    onUndoLastChange: lastAiUndo?.undo,
    onSend: (p: string) => void handleSendAi(p),
    onStop: () => activeRunCancelRef.current?.(),
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
    onRetryLast: lastAiPrompt ? () => void handleSendAi(lastAiPrompt) : undefined,
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
    send: handleSendAi,
    cancel,
    resetForDocument,
  }
}
