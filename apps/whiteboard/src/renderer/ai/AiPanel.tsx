/**
 * Whiteboard AI panel aligned with the shared `@genoffice/ui` AI assistant design
 * system used across all editors: slim `AiPanelHeader` (with side swap, new chat,
 * collapse, and project chat switcher), horizontal resizer, centered empty state
 * with starter cards and shortcut hints, streaming progress/work-steps/reply-footer,
 * `AiScrollToBottom`, `AiQueueStrip`, `AiChangesCard`, attachment thumbnails/cards,
 * `AiAttachMenu`, `McpServerButton`, `AiModelPicker`, `useProjectPanel`, and
 * `useAiSendGate`. Automatically attaches a theme-invariant light PNG snapshot of
 * the current page alongside `<whiteboard_page>` text when the active model
 * supports vision, and falls back silently to text-only otherwise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import {
  AgentLoop,
  composeWithDrive,
  toolStepLabel,
  windowMcpState,
  windowMcpUsableServers,
  type AgentImage,
  type IpcStreamError,
} from '@genoffice/agent-core'
import {
  localModelCapabilities,
  type AiSettings,
  type AiSubscriptionProviderId,
  type AiSubscriptionUsage,
} from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import {
  AI_QUEUE_LABELS,
  AiAttachMenu,
  AiAssistantBody,
  AiBlockedNotice,
  AiChangesCard,
  type AiChangesState,
  AiComposer,
  type AiComposerDocs,
  AiConnectPrompt,
  AiEmptyHints,
  AiFirstConnectionNotice,
  AiInputTruncatedNotice,
  AiMark,
  AiModelPicker,
  type AiModelPickerBridge,
  AiPanelHeader,
  AiPanelSideButton,
  AiQualityBadge,
  AiQuestionCard,
  AiQuestionReceipt,
  isQuestionToolActivity,
  AiQueueStrip,
  AiReplyFooter,
  AiReplyProgress,
  AiScrollToBottom,
  AiSubscriptionUsageLine,
  AiToolsUnsupportedNotice,
  AiUsageChip,
  AiWorkSteps,
  type AiWorkStep,
  type AiTokenUsageView,
  type DocMentionAddResult,
  type DriveAttachPicked,
  IconArrowUp,
  IconStop,
  McpPermissionCard,
  McpServerButton,
  NO_SKILL_USE,
  SentSkillChips,
  type SkillChipRef,
  type SkillUse,
  SkillUsedNotes,
  addTokenUsage,
  aiPanelWidthAtPointer,
  aiSubscriptionText,
  docMentionActions,
  openGenerateForCurrentDocument,
  panelProjectSkill,
  panelUserSkills,
  placeRemoteEntries,
  skillChipRefsOf,
  useAiInlineQuestions,
  useAiSendGate,
  useChatRunQueue,
  useComposerSkills,
  useMcpWindow,
  useProjectPanel,
  type ProjectChatEntry,
  type ProjectChatOpened,
  type ProjectMemoryLine,
  type ProjectPanel,
  useScrollToBottom,
  useSkillProposals,
  useSubscriptionUsageUpdates,
} from '@genoffice/ui'
import type { WhiteboardAiHost } from '../../shared/ai-host'
import type { AttachmentAddResult, AttachmentMeta, WhiteboardHandoff } from '../../shared/ipc'
import { t as tGlobal, useI18n } from '../i18n/locale'
import { blockedRunFor, mergeSubscriptionUsage, type BlockedRun } from './connection'
import { createFilesSkill } from './files-skill'
import { aiLangDirective } from './lang-directive'
import { createSearchSkill } from './search-skill'
import { useSubscriptionConnection } from './subscription-client'
import { createElectronTransport } from './transport'
import { modelSupportsVision } from './vision-capability'
import { createWhiteboardSkill, whiteboardContext } from './whiteboard-skill'
import { runWhiteboardStaticQualityAudit } from './whiteboard-qc'
import type { QualityFinding } from '@genoffice/agent-core'
import fileDocumentIcon from './assets/file-document.png'
import fileExcelIcon from './assets/file-excel.png'
import fileGeneralIcon from './assets/file-general.png'
import fileImageIcon from './assets/file-image.png'
import filePdfIcon from './assets/file-pdf.png'
import filePptIcon from './assets/file-ppt.png'
import fileWordIcon from './assets/file-word.png'

const STARTERS = [
  ['aiStarterBrainstorm', 'aiStarterBrainstormPrompt'],
  ['aiStarterKanban', 'aiStarterKanbanPrompt'],
  ['aiStarterOrganize', 'aiStarterOrganizePrompt'],
  ['aiStarterSummarize', 'aiStarterSummarizePrompt'],
] as const

const ATTACHMENT_CARD_ICONS: Record<string, string> = Object.fromEntries(
  (
    [
      [fileWordIcon, ['doc', 'docx', 'odt']],
      [fileExcelIcon, ['xls', 'xlsx', 'xlsm', 'csv', 'tsv']],
      [filePptIcon, ['ppt', 'pptx']],
      [filePdfIcon, ['pdf']],
      [fileImageIcon, ['png', 'jpg', 'jpeg', 'gif', 'webp']],
    ] as [string, string[]][]
  ).flatMap(([icon, exts]) => exts.map((ext) => [ext, icon])),
)

const MAX_IMAGES_PER_MESSAGE = 20
const PANEL_WIDTH_KEY = 'whiteboard-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280
const TOOL_OUTPUT_MAX_CHARS = 2000

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.whiteboardApi.ai.getSettings() as Promise<AiSettings>,
  setSettings: (settings) => window.whiteboardApi.ai.setSettings(settings),
  onSettingsChanged: (handler) => window.whiteboardApi.ai.onSettingsChanged(handler),
  openModelSettings: () => window.whiteboardApi.ai.openModelSettings(),
}

interface TurnChanges {
  batchCount: number
  changedIds: string[]
  state: AiChangesState
}

interface ToolActivity extends AiWorkStep {
  readonly callId?: string
  /** the call's input as JSON: kept for a question card call only, so a reopened chat can draw it */
  readonly input?: string
}

/** a question card call keeps its input and output up to the store's own cut (spec 5.1) */
const QUESTION_TOOL_FIELD_MAX_CHARS = 16_000

/** a tool call's input as the transcript keeps it (undefined when it cannot be written out) */
function toolInputText(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    return text ? text.slice(0, QUESTION_TOOL_FIELD_MAX_CHARS) : undefined
  } catch {
    return undefined
  }
}

/**
 * A tool's activity as the transcript keeps and shows it: a question card call
 * keeps its input and whole output (a reopened chat draws it as a read-only
 * card); any other tool keeps a short output only, as before.
 */
function keptToolActivity(tool: {
  name: string
  summary: string
  isError?: boolean
  input?: unknown
  output?: string
}): ToolActivity {
  const question = isQuestionToolActivity(tool)
  const input = question ? toolInputText(tool.input) : undefined
  const max = question ? QUESTION_TOOL_FIELD_MAX_CHARS : TOOL_OUTPUT_MAX_CHARS
  return {
    name: tool.name,
    summary: tool.summary,
    isError: tool.isError,
    ...(input !== undefined ? { input } : {}),
    output: tool.output ? tool.output.slice(0, max) : undefined,
  }
}

/**
 * A reply's tool steps. In a reopened chat each question card call is drawn in
 * its place as the read-only card (spec 5.1); live, the card shows below the chat.
 */
function ReplyToolSteps({
  lang,
  tools,
  restored,
}: {
  lang: Lang
  tools: ToolActivity[]
  restored: boolean
}): ReactNode {
  if (!restored) return <AiWorkSteps lang={lang} steps={tools} />
  const parts: ReactNode[] = []
  let steps: ToolActivity[] = []
  const flush = () => {
    if (steps.length === 0) return
    parts.push(<AiWorkSteps key={`s-${parts.length}`} lang={lang} steps={steps} />)
    steps = []
  }
  for (const tool of tools) {
    if (!isQuestionToolActivity(tool)) {
      steps.push(tool)
      continue
    }
    flush()
    parts.push(<AiQuestionReceipt key={`q-${parts.length}`} lang={lang} activity={tool} />)
  }
  flush()
  return parts
}

interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  blocked?: BlockedRun
  undelivered?: boolean
  attachments?: AttachmentMeta[]
  skills?: SkillChipRef[]
  skillText?: string
  skillProposals?: string[]
  tools?: ToolActivity[]
  usage?: AiTokenUsageView
  changes?: TurnChanges
  memory?: readonly ProjectMemoryLine[]
  otherEditorTools?: ProjectChatEntry['otherEditorTools']
  /** read back from a saved chat: its question cards are read-only */
  restored?: boolean
}

export interface WhiteboardAiPanelProps {
  host: WhiteboardAiHost
  filePath: string | null
  handoff?: WhiteboardHandoff | null
  onCollapse(): void
  onHandoffConsumed?(): void
  onOpenTweaks?(): void
  onAiDoneRecord?(promptSummary: string): void
}

function clampPanelWidth(w: number): number {
  const max = Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), max)
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
}

function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

function nameFromRequest(text: string): string {
  const line = text.split(/\r?\n/).find((each) => each.trim() !== '') ?? ''
  const clean = line.replace(/\s+/g, ' ').trim()
  return clean.length > 40 ? `${clean.slice(0, 40).trimEnd()}…` : clean
}

function toDocAddResult(
  res: AttachmentAddResult | null,
): DocMentionAddResult<AttachmentMeta> | null {
  if (!res) return null
  return {
    accepted: res.added,
    rejected: res.rejected.map((r) => `${r.name}: ${r.reason}`),
  }
}

let entrySeq = 0
function nextEntryId(prefix: 'u' | 'a'): string {
  return `${prefix}-${Date.now()}-${++entrySeq}`
}

function chatEntryOf(entry: ProjectChatEntry): ChatEntry {
  return {
    id: nextEntryId(entry.role === 'user' ? 'u' : 'a'),
    role: entry.role,
    text: entry.text,
    restored: true,
    ...(entry.tools && entry.tools.length > 0 ? { tools: entry.tools.map(keptToolActivity) } : {}),
    ...(entry.role === 'user' && skillChipRefsOf(entry.skills).length > 0
      ? { skills: skillChipRefsOf(entry.skills) }
      : {}),
    ...(entry.memory ? { memory: entry.memory } : {}),
    ...(entry.otherEditorTools ? { otherEditorTools: entry.otherEditorTools } : {}),
  }
}

function AttachmentList({
  atts,
  previews,
  onRemove,
  removeLabel,
}: {
  atts: AttachmentMeta[]
  previews: Record<string, string>
  onRemove?: (path: string) => void
  removeLabel?: string
}): ReactElement {
  const remove = (path: string) =>
    onRemove && (
      <button
        type="button"
        className="ai-attachment-thumb-remove"
        onClick={() => onRemove(path)}
        data-tip={removeLabel}
        aria-label={removeLabel}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
          <path
            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
            fill="currentColor"
          />
        </svg>
      </button>
    )
  return (
    <>
      {atts.map((a) =>
        a.isImage ? (
          <span key={a.path} className="ai-attachment-thumb" title={a.name}>
            {previews[a.path] ? (
              <img src={previews[a.path]} alt={a.name} />
            ) : (
              <span className="ai-attachment-thumb-pending" aria-hidden>
                <img src={fileImageIcon} alt="" />
              </span>
            )}
            {remove(a.path)}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.path}>
            <span className="ai-attachment-card-icon">
              <img
                src={ATTACHMENT_CARD_ICONS[a.ext] ?? fileDocumentIcon ?? fileGeneralIcon}
                alt=""
                aria-hidden
              />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{a.name}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.size)}</span>
            </span>
            {remove(a.path)}
          </span>
        ),
      )}
    </>
  )
}

export function AiPanel({
  host,
  filePath,
  handoff,
  onCollapse,
  onHandoffConsumed,
  onOpenTweaks,
  onAiDoneRecord,
}: WhiteboardAiPanelProps): ReactElement {
  const { lang, t } = useI18n()
  const sub = useSubscriptionConnection()
  const mcpWindow = useMcpWindow()
  const skills = useComposerSkills({
    lang,
    editor: 'whiteboard',
    usableMcpServers: mcpWindow.state?.usableServers(),
  })
  const skillsRef = useRef(skills)
  skillsRef.current = skills
  const skillCards = useSkillProposals({ lang })
  const skillCardsRef = useRef(skillCards)
  skillCardsRef.current = skillCards

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const inlineQuestions = useAiInlineQuestions()
  const [qualityFindings, setQualityFindings] = useState<QualityFinding[]>([])
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [inputTruncated, setInputTruncated] = useState(false)
  const [subscriptionUsage, setSubscriptionUsage] = useState<AiSubscriptionUsage[]>([])
  const [sessionUsage, setSessionUsage] = useState<AiTokenUsageView | undefined>(undefined)
  const [markedMsgId, setMarkedMsgId] = useState<string | null>(null)

  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)

  const asideRef = useRef<HTMLElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const mountedRef = useRef(true)

  const {
    showButton: showScrollBottom,
    onScroll: onScrollBottom,
    scrollToBottom,
  } = useScrollToBottom(chatRef)

  const hostRef = useRef(host)
  hostRef.current = host
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const langRef = useRef(lang)
  langRef.current = lang
  const settingsRef = useRef<AiSettings | null>(null)
  settingsRef.current = aiSettings
  const attachmentsRef = useRef<AttachmentMeta[]>([])
  attachmentsRef.current = attachments
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  const previewRequestedRef = useRef(new Set<string>())
  const contextRef = useRef('')
  const lastStreamErrorRef = useRef<IpcStreamError | null>(null)
  const turnBatchesRef = useRef(0)
  const turnChangedIdsRef = useRef<string[]>([])
  const runToolsRef = useRef<ToolActivity[]>([])
  const runUsageRef = useRef<AiTokenUsageView | undefined>(undefined)
  const runInstructionRef = useRef('')
  const lastSentRef = useRef<{
    text: string
    attachments: AttachmentMeta[]
    skillUse: SkillUse
  } | null>(null)
  const sendSeqRef = useRef(0)
  const namedRef = useRef(false)
  const chatNowRef = useRef(chat)
  chatNowRef.current = chat
  const activeAsstIdRef = useRef<string | null>(null)
  const projectRef = useRef<ProjectPanel | null>(null)
  const loopRef = useRef<AgentLoop | null>(null)

  const availableAttachments = useCallback((): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) => {
      if (seen.has(a.path)) return false
      seen.add(a.path)
      return true
    })
  }, [])

  const showAttachNotice = useCallback((lines: string[]) => {
    if (lines.length === 0) return
    setAttachNotice(lines.join('; '))
    window.setTimeout(() => setAttachNotice(null), 5000)
  }, [])

  const mergeAttachments = useCallback(
    (result: DocMentionAddResult<AttachmentMeta> | null) => {
      if (!result) return
      if (result.accepted.length > 0) {
        const seen = new Set(attachmentsRef.current.map((a) => a.path))
        const next = [
          ...attachmentsRef.current,
          ...result.accepted.filter((a) => !seen.has(a.path)),
        ]
        attachmentsRef.current = next
        setAttachments(next)
      }
      showAttachNotice(result.rejected)
    },
    [showAttachNotice],
  )

  const attachFromPicker = useCallback(
    async ({ paths, notes }: DriveAttachPicked) => {
      const added =
        paths.length > 0
          ? toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(paths))
          : null
      mergeAttachments({
        accepted: added?.accepted ?? [],
        rejected: [...(added?.rejected ?? []), ...notes],
      })
    },
    [mergeAttachments],
  )

  const removeAttachment = useCallback((path: string) => {
    const next = attachmentsRef.current.filter((a) => a.path !== path)
    attachmentsRef.current = next
    setAttachments(next)
  }, [])

  const docMention: AiComposerDocs = useMemo(
    () => ({
      lang,
      ...docMentionActions<AttachmentMeta>({
        lang,
        add: async (paths) =>
          toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(paths)),
        merge: mergeAttachments,
      }),
      attachments,
    }),
    [attachments, lang, mergeAttachments],
  )

  const handlePasteFiles = useCallback(
    async (files: File[]) => {
      const localPaths: string[] = []
      const pasted: AttachmentMeta[] = []
      for (const f of files) {
        const p = window.whiteboardApi.ai.resolveFilePath(f)
        if (p) {
          localPaths.push(p)
        } else if (f.type.startsWith('image/')) {
          const bytes = new Uint8Array(await f.arrayBuffer())
          const saved = await window.whiteboardApi.ai.savePastedImage(bytes, f.type)
          if (saved) pasted.push(saved)
        }
      }
      if (pasted.length > 0) {
        mergeAttachments({ accepted: pasted, rejected: [] })
      }
      if (localPaths.length > 0) {
        mergeAttachments(
          toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(localPaths)),
        )
      }
    },
    [mergeAttachments],
  )

  const onDrop = useCallback(
    async (e: ReactDragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.whiteboardApi.ai.resolveFilePath(f))
        .filter(Boolean)
      if (paths.length > 0) {
        mergeAttachments(toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(paths)))
      }
    },
    [mergeAttachments],
  )

  useEffect(() => {
    const wanted = [...attachments, ...chat.flatMap((e) => e.attachments ?? [])]
    const alive = new Set(wanted.map((a) => a.path))
    setAttachmentPreviews((prev) => {
      const stale = Object.keys(prev).filter((path) => !alive.has(path))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const path of stale) delete next[path]
      return next
    })
    for (const path of previewRequestedRef.current) {
      if (!alive.has(path)) previewRequestedRef.current.delete(path)
    }
    for (const a of wanted) {
      if (!a.isImage || previewRequestedRef.current.has(a.path)) continue
      previewRequestedRef.current.add(a.path)
      void window.whiteboardApi.ai
        .readAttachmentImage(a.path)
        .then((r) => {
          if (!previewRequestedRef.current.has(a.path)) return
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => previewRequestedRef.current.delete(a.path))
    }
  }, [attachments, chat])

  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  useEffect(() => {
    const onResize = (): void => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const resizer = e.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const w = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = w
      setPanelWidth(w)
    }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      resizeCleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      resizer.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(preferredWidthRef.current)))
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(e.pointerId)
  }

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.whiteboardApi.ai
        .getSettings()
        .then((s: unknown) => {
          if (alive) setAiSettings(s as AiSettings)
        })
        .catch(() => {})
    }
    refresh()
    const off = window.whiteboardApi.ai.onSettingsChanged(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useSubscriptionUsageUpdates(
    () => window.whiteboardApi?.subscription,
    setSubscriptionUsage,
    mergeSubscriptionUsage,
  )

  const patchLast = useCallback(
    (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => {
      setChat((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'assistant') return prev
        next[next.length - 1] = {
          ...last,
          ...(typeof patch === 'function' ? patch(last) : patch),
        }
        return next
      })
    },
    [],
  )

  const clearMarks = useCallback(() => {
    hostRef.current.setHighlights([])
    setMarkedMsgId(null)
  }, [])

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current) {
    transportRef.current = createElectronTransport(() => settingsRef.current!, {
      getLang: () => langRef.current,
      onStreamError: (err) => {
        lastStreamErrorRef.current = err
      },
      onSubscriptionUsage: (reported) => {
        setSubscriptionUsage((prev) => mergeSubscriptionUsage(prev, reported))
      },
      onInputTruncated: () => setInputTruncated(true),
    })
  }

  const sendRef = useRef<
    (text: string, overrideAttachments?: AttachmentMeta[], skillUse?: SkillUse) => boolean
  >(() => false)

  const sendGate = useAiSendGate<{
    text: string
    attachments: AttachmentMeta[] | undefined
    skillUse: SkillUse
  }>({
    settings: aiSettings,
    statuses: sub.statuses,
    store: {
      getSettings: MODEL_BRIDGE.getSettings,
      setSettings: MODEL_BRIDGE.setSettings,
    },
    start: (held) => {
      sendRef.current(held.text, held.attachments, held.skillUse)
    },
    onNotConnected: () => sub.refresh(),
    onSettingsSaved: setAiSettings,
  })
  const sendGateRef = useRef(sendGate)
  sendGateRef.current = sendGate

  const msgQueue = useChatRunQueue<{ atts: AttachmentMeta[]; skillUse: SkillUse }>({
    busy,
    submit: (text, meta) => {
      const loop = loopRef.current
      if (!loop || loop.busy) return false
      if (!sendGateRef.current.admitQueued(() => msgQueueRef.current.setPaused(true))) return false
      return sendRef.current(text, meta.atts, meta.skillUse)
    },
  })
  const msgQueueRef = useRef(msgQueue)
  msgQueueRef.current = msgQueue

  const resetConversationRef = useRef<() => void>(() => {})
  const startNewChatRef = useRef<() => void>(() => {})

  const openChat = useCallback((opened: ProjectChatOpened, initial = false) => {
    if (initial && (chatNowRef.current.length > 0 || loopRef.current?.busy)) return
    resetConversationRef.current()
    if (opened.kind === 'document') return
    const entries = opened.entries.map(chatEntryOf)
    setChat(entries)
    skillsRef.current.restoreHistory(
      entries.map((entry) => (entry.role === 'user' ? entry.skills : undefined)),
    )
    windowMcpState()?.newConversation()
    loopRef.current?.restore(entries.map((entry) => ({ role: entry.role, text: entry.text })))
  }, [])

  const project = useProjectPanel({
    editor: 'whiteboard',
    lang,
    busy,
    loop: () => loopRef.current,
    consolidation: () => {
      const live = sendGateRef.current.settings
      if (live && !loopRef.current?.busy) settingsRef.current = live
      const transport = transportRef.current
      return transport ? { transport, gate: () => sendGateRef.current.peek() } : null
    },
    onOpen: (opened, initial) => openChat(opened, initial),
    onRemoteMessages: (entries, running) => {
      setChat((prev) => placeRemoteEntries(prev, entries.map(chatEntryOf), running))
    },
    onNewChat: () => startNewChatRef.current(),
  })
  projectRef.current = project

  if (!loopRef.current) {
    const wbSkill = createWhiteboardSkill({
      host: () => hostRef.current,
      context: () => contextRef.current,
      onApplied: (ids) => {
        turnBatchesRef.current += 1
        turnChangedIdsRef.current.push(...ids)
      },
    })
    const composed = composeWithDrive(
      'whiteboard+search',
      '',
      () => loopRef.current?.messages ?? [],
      [
        wbSkill,
        inlineQuestions.askQuestionsSkill,
        createSearchSkill(),
        createFilesSkill(availableAttachments),
        ...panelUserSkills({
          editor: 'whiteboard',
          lang: () => langRef.current,
          messages: () => loopRef.current?.messages ?? [],
          mcpServerUsable: (name) => windowMcpUsableServers().has(name),
          onProposal: (proposal) => {
            skillCardsRef.current.add(proposal)
            patchLast((last) => ({
              skillProposals: [...(last.skillProposals ?? []), proposal.key],
            }))
          },
        }),
        ...panelProjectSkill({ run: project.chat.run, lang: () => langRef.current }),
      ],
    )
    loopRef.current = new AgentLoop({
      transport: transportRef.current,
      toolsAllowed: () =>
        settingsRef.current ? localModelCapabilities(settingsRef.current).tools !== false : true,
      skill: composed,
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        onText: (fullText) => patchLast({ text: fullText }),
        onToolStart: (call) => {
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              {
                callId: call.id,
                name: call.name,
                summary: toolStepLabel(call.name),
                running: true,
              },
            ],
          }))
        },
        onToolExecuted: ({ call, execution }) => {
          const activity: ToolActivity = {
            callId: call.id,
            running: false,
            ...keptToolActivity({
              name: call.name,
              summary: execution.summary || toolStepLabel(call.name),
              isError: execution.isError,
              input: call.input,
              output: execution.output,
            }),
          }
          runToolsRef.current.push(activity)
          patchLast((last) => {
            const tools = [...(last.tools ?? [])]
            const idx = tools.findIndex((s) => s.callId === call.id)
            if (idx >= 0) tools[idx] = activity
            else {
              if (tools.at(-1)?.running) tools.pop()
              tools.push(activity)
            }
            return { tools }
          })
        },
        onTurnEnd: () => {
          patchLast({ streaming: false, usage: undefined })
          const nextId = nextEntryId('a')
          activeAsstIdRef.current = nextId
          setChat((prev) => [...prev, { id: nextId, role: 'assistant', text: '', streaming: true }])
        },
        onUsage: (reported) => {
          runUsageRef.current = addTokenUsage(runUsageRef.current, reported)
          setSessionUsage((prev) => addTokenUsage(prev, reported))
          patchLast({ usage: runUsageRef.current })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          const batches = turnBatchesRef.current
          const changedIds = [...new Set(turnChangedIdsRef.current)]
          let changes: TurnChanges | undefined
          if (batches > 0) {
            hostRef.current.setHighlights(changedIds)
            changes = { batchCount: batches, changedIds, state: 'applied' }
            if (activeAsstIdRef.current) setMarkedMsgId(activeAsstIdRef.current)
            if (!cancelled) {
              setQualityFindings(
                runWhiteboardStaticQualityAudit(hostRef.current.getDocument(), {
                  pageId: hostRef.current.getActivePageId(),
                  userPrompt: runInstructionRef.current,
                }).findings,
              )
              onAiDoneRecord?.(runInstructionRef.current)
            }
          }
          setChat((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (!last || last.role !== 'assistant') return prev
            next[next.length - 1] = {
              ...last,
              streaming: false,
              text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
              tools: last.tools?.filter((tl) => !tl.running),
              ...(runUsageRef.current ? { usage: runUsageRef.current } : {}),
              ...(changes ? { changes } : {}),
            }
            return next
          })
          projectRef.current?.chat.persist({
            role: 'assistant',
            text: final,
            ...(runToolsRef.current.length > 0 ? { tools: runToolsRef.current } : {}),
          })
          projectRef.current?.finishSend()
          setBusy(false)
        },
        onError: (msg) => {
          const blocked = blockedRunFor(msg, lastStreamErrorRef.current)
          if (blocked) msgQueueRef.current.hold()
          const undelivered = runToolsRef.current.length === 0
          const batches = turnBatchesRef.current
          const changedIds = [...new Set(turnChangedIdsRef.current)]
          let changes: TurnChanges | undefined
          if (batches > 0) {
            hostRef.current.setHighlights(changedIds)
            changes = { batchCount: batches, changedIds, state: 'applied' }
            if (activeAsstIdRef.current) setMarkedMsgId(activeAsstIdRef.current)
          }
          setChat((prev) => {
            const next = [...prev]
            for (let i = undelivered ? next.length - 1 : -1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                next[i] = { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                text: msg,
                isError: true,
                ...(blocked ? { blocked } : {}),
                ...(changes ? { changes } : {}),
                tools: last.tools?.filter((tl) => !tl.running),
              }
            }
            return next
          })
          projectRef.current?.finishSend()
          setBusy(false)
        },
      },
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loopRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (filePath) void projectRef.current?.chat.documentSaved()
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo?.({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    onScrollBottom()
  }

  const collectAttachedImages = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => a.isImage)
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const img = await window.whiteboardApi.ai.readAttachmentImage(att.path)
      if (img.ok && img.base64 && img.mime) {
        images.push({ base64: img.base64, mime: img.mime })
      } else {
        failures.push(img.error ?? tGlobal('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(tGlobal('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    showAttachNotice(failures)
    return images
  }

  const send = (
    text: string,
    overrideAttachments?: AttachmentMeta[],
    skillUse: SkillUse = NO_SKILL_USE,
  ): boolean => {
    const instruction = text.trim()
    const loop = loopRef.current
    if (!instruction || !loop || loop.busy) return false
    if (!sendGate.admit({ text: instruction, attachments: overrideAttachments, skillUse })) {
      return false
    }
    inlineQuestions.supersedeOpen()

    lastStreamErrorRef.current = null
    setInputTruncated(false)
    clearMarks()
    turnBatchesRef.current = 0
    turnChangedIdsRef.current = []
    runToolsRef.current = []
    runUsageRef.current = undefined
    runInstructionRef.current = instruction

    const sentAtts = overrideAttachments ?? attachmentsRef.current
    lastSentRef.current = { text: instruction, attachments: sentAtts, skillUse }
    if (sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      if (!overrideAttachments) {
        attachmentsRef.current = []
        setAttachments([])
      }
    }

    if (!namedRef.current && filePathRef.current === null) {
      const name = nameFromRequest(instruction)
      if (name) {
        namedRef.current = true
        window.whiteboardApi.core.setProvisionalTitle(name)
      }
    }

    stickToBottomRef.current = true
    const asstId = nextEntryId('a')
    activeAsstIdRef.current = asstId
    setChat((prev) => [
      ...prev,
      {
        id: nextEntryId('u'),
        role: 'user',
        text: instruction,
        ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}),
        ...(skillUse.chips.length > 0 ? { skills: skillUse.chips, skillText: skillUse.text } : {}),
      },
      { id: asstId, role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    skillsRef.current.consume(skillUse)
    setBusy(true)
    projectRef.current?.chat.persist({
      role: 'user',
      text: instruction,
      ...(skillUse.chips.length > 0 ? { skills: skillUse.chips } : {}),
    })

    const seq = ++sendSeqRef.current
    void (async () => {
      try {
        const currentSettings = (await window.whiteboardApi.ai.getSettings()) as AiSettings
        if (!mountedRef.current || seq !== sendSeqRef.current) return
        settingsRef.current = currentSettings
        setAiSettings(currentSettings)

        const pageTable = await hostRef.current.readPage()
        if (!mountedRef.current || seq !== sendSeqRef.current) return
        contextRef.current = whiteboardContext(pageTable)

        const images: AgentImage[] = []
        if (modelSupportsVision(currentSettings)) {
          const png = await hostRef.current.captureCurrentPagePng(1600)
          if (png) images.push({ base64: png.base64, mime: png.mime })
        }
        if (sentAtts.length > 0) {
          images.push(...(await collectAttachedImages(sentAtts)))
        }
        if (!mountedRef.current || seq !== sendSeqRef.current) return

        await projectRef.current?.prepareSend()
        if (!mountedRef.current || seq !== sendSeqRef.current) {
          projectRef.current?.finishSend()
          return
        }

        await loop.run(instruction + skillUse.text, images.length > 0 ? images : undefined)
      } catch (err) {
        projectRef.current?.finishSend()
        if (!mountedRef.current || seq !== sendSeqRef.current) return
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()

    return true
  }
  sendRef.current = send

  const cancelPendingSend = (): void => {
    sendSeqRef.current++
    setChat((prev) => {
      const last = prev.at(-1)
      if (!last || last.role !== 'assistant' || !last.streaming || last.text) return prev
      const rest = prev.slice(0, -1)
      const user = rest.at(-1)
      if (user?.role === 'user') rest[rest.length - 1] = { ...user, undelivered: true }
      return rest
    })
    setBusy(false)
  }

  const stop = (): void => {
    msgQueue.hold()
    const loop = loopRef.current
    if (loop?.busy) loop.cancel()
    else cancelPendingSend()
  }

  const sendDraft = (): void => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => send(text, undefined, skillUse))
  }

  const enqueueDraft = (): void => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => {
      skillsRef.current.consume(skillUse)
      const atts = attachmentsRef.current
      if (atts.length > 0) {
        attachmentsRef.current = []
        setAttachments([])
      }
      msgQueue.enqueue(text, { atts, skillUse })
      setPrompt('')
      // a message sent while a card waits closes it: the run goes on without the answer
      // (and cannot ask again in this run)
      inlineQuestions.closeOpenCard()
    })
  }

  const entrySkillUse = (entry: ChatEntry): SkillUse =>
    entry.skills && entry.skillText !== undefined
      ? { text: entry.skillText, chips: entry.skills }
      : NO_SKILL_USE

  const retry = (): void => {
    const last = lastSentRef.current
    if (last) send(last.text, last.attachments, last.skillUse)
    else if (runInstructionRef.current) send(runInstructionRef.current, [], NO_SKILL_USE)
  }

  const continueWith = (provider: AiSubscriptionProviderId): void => {
    const last = [...chat].reverse().find((entry) => entry.role === 'user')
    sendGate.continueWith(provider, () => {
      if (last) send(last.text, last.attachments ?? [], entrySkillUse(last))
      else retry()
    })
  }

  const resetConversation = (): void => {
    msgQueue.clear()
    sendGate.reset()
    stop()
    loopRef.current?.reset()
    windowMcpState()?.newConversation()
    setBusy(false)
    setChat([])
    setInputTruncated(false)
    clearMarks()
    skills.resetConversation()
    skillCards.reset()
    // question cards belong to the chat: an open one answers skip, all states go
    inlineQuestions.resetConversation()
    attachmentsRef.current = []
    setAttachments([])
    setAttachNotice(null)
    sentAttachmentsRef.current = []
  }
  resetConversationRef.current = resetConversation

  const startNewChat = (): void => {
    resetConversation()
    if (projectRef.current?.chat.projectId) void projectRef.current.chat.newChat()
  }
  startNewChatRef.current = startNewChat

  const consumedHandoffId = useRef<string | null>(null)
  useEffect(() => {
    if (!handoff || consumedHandoffId.current === handoff.id) return
    consumedHandoffId.current = handoff.id
    void (async () => {
      let added: AttachmentMeta[] = []
      if (handoff.sourcePaths.length > 0) {
        const res = await window.whiteboardApi.ai.addAttachmentPaths(handoff.sourcePaths)
        added = res.added
        if (added.length > 0) {
          const next = [...attachmentsRef.current, ...added]
          attachmentsRef.current = next
          setAttachments(next)
        }
      }
      window.whiteboardApi.handoff.reportRunStarted({
        id: handoff.id,
        attachedPaths: added.map((a) => a.path),
      })
      onHandoffConsumed?.()
      if (handoff.prompt.trim()) {
        if (!sendRef.current(handoff.prompt, added)) {
          setPrompt(handoff.prompt)
        }
      }
    })()
  }, [handoff, onHandoffConsumed])

  const latestAppliedChangesId = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i]!
      if (m.changes?.state === 'applied') return m.id
    }
    return null
  }, [chat])

  const handleRevertTurn = useCallback(async (msgId: string, changes: TurnChanges) => {
    const ok = await hostRef.current.undoBatches(changes.batchCount)
    if (!ok) {
      setChat((prev) =>
        prev.map((m) =>
          m.id === msgId && m.changes ? { ...m, changes: { ...m.changes, state: 'refused' } } : m,
        ),
      )
      return
    }
    hostRef.current.setHighlights([])
    setMarkedMsgId(null)
    setChat((prev) =>
      prev.map((m) =>
        m.id === msgId && m.changes ? { ...m, changes: { ...m.changes, state: 'reverted' } } : m,
      ),
    )
  }, [])

  const handleAddAttachments = useCallback(async () => {
    const res = toDocAddResult(await window.whiteboardApi.ai.addAttachments())
    mergeAttachments(res)
  }, [mergeAttachments])

  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}${dragOver ? ' ai-panel-dragover' : ''}`}
      style={{ width: '100%' }}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={aiSubscriptionText(lang, 'aiAssistant')}
      />
      <AiPanelHeader
        lang={lang}
        chatMenu={project.chatMenu}
        actions={
          <>
            <AiPanelSideButton
              lang={lang}
              onMove={async (side) => {
                await window.whiteboardApi.ai.setPanelPrefs({ side })
                return window.whiteboardApi.ai.getPanelPrefs()
              }}
            />
            {chat.length > 0 && (
              <button
                type="button"
                className="ai-header-btn"
                onClick={startNewChat}
                data-tip={t('aiNewChat')}
                aria-label={t('aiNewChat')}
              >
                <IconNewChat />
              </button>
            )}
            <button
              type="button"
              className="ai-header-btn ai-panel-collapse"
              onClick={onCollapse}
              data-tip={t('aiCollapsePanel')}
              aria-label={t('aiCollapsePanel')}
            >
              <IconCollapse />
            </button>
          </>
        }
      />

      <div className="ai-chat" ref={chatRef} onScroll={onChatScroll}>
        {chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-badge" aria-hidden="true">
              <AiMark size={24} />
            </div>
            <div className="ai-chat-empty-title">{t('aiEmptyTitle')}</div>
            <div className="ai-chat-empty-body">{t('aiEmptyBody')}</div>
            <div className="ai-starter-list">
              {STARTERS.map(([labelKey, promptKey]) => (
                <button
                  key={labelKey}
                  type="button"
                  className="ai-starter"
                  onClick={() => {
                    setPrompt(t(promptKey))
                    inputRef.current?.focus()
                  }}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <AiEmptyHints lang={lang} showSkill={Boolean(skills.composer)} showDocMention />
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'user') {
            return (
              <div key={entry.id} className="ai-msg ai-msg-user">
                <SentSkillChips lang={lang} chips={entry.skills} isAvailable={skills.isAvailable} />
                {entry.attachments && entry.attachments.length > 0 && (
                  <div className="ai-msg-attachments">
                    <AttachmentList atts={entry.attachments} previews={attachmentPreviews} />
                  </div>
                )}
                <span dir="auto">{entry.text}</span>
                {entry.undelivered && (
                  <div className="ai-msg-undelivered">
                    {t('aiUndelivered')}
                    {!busy && (
                      <button
                        type="button"
                        className="ai-retry-btn"
                        onClick={() =>
                          send(entry.text, entry.attachments ?? [], entrySkillUse(entry))
                        }
                      >
                        {t('aiRetry')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          if (!entry.text && !entry.streaming && !hasTools && !entry.changes) return null
          const isLast = i === chat.length - 1
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar = !entry.streaming && turnEnded && !!entry.text && !entry.isError
          return (
            <div
              key={entry.id}
              className={`ai-msg ai-msg-assistant${entry.isError && !entry.blocked ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {hasTools && (
                <ReplyToolSteps lang={lang} tools={entry.tools!} restored={!!entry.restored} />
              )}
              {entry.blocked ? (
                <AiBlockedNotice
                  kind={entry.blocked.kind}
                  provider={entry.blocked.provider}
                  resetsAt={entry.blocked.resetsAt}
                  message={entry.text}
                  settings={aiSettings ?? {}}
                  statuses={isLast && !busy ? sub.statuses : {}}
                  lang={lang}
                  onContinueWith={continueWith}
                />
              ) : (
                entry.text && (
                  <div dir="auto">
                    <AiAssistantBody
                      lang={lang}
                      text={entry.text}
                      streaming={entry.streaming}
                      restored={entry.restored}
                      questionStatus={inlineQuestions.textCardStates[entry.id]?.status}
                      questionAnswer={inlineQuestions.textCardStates[entry.id]?.answer}
                      onQuestionSubmit={(view, answer) => {
                        inlineQuestions.markTextCard(entry.id, 'submitted', answer)
                        send(inlineQuestions.formatFollowUp(lang, view, answer))
                      }}
                      onQuestionSkip={(view) => {
                        inlineQuestions.markTextCard(entry.id, 'skipped')
                        send(inlineQuestions.formatFollowUp(lang, view, { kind: 'skip' }))
                      }}
                    />
                  </div>
                )
              )}
              <SkillUsedNotes tools={entry.tools} />
              {project.messageParts(entry)}
              {entry.skillProposals?.map((key) => skillCards.render(key))}
              {entry.changes && (
                <AiChangesCard
                  lang={lang}
                  state={entry.changes.state}
                  count={entry.changes.changedIds.length || entry.changes.batchCount}
                  canRevert={
                    !busy &&
                    entry.changes.state === 'applied' &&
                    entry.id === latestAppliedChangesId
                  }
                  onRevert={() => void handleRevertTurn(entry.id, entry.changes!)}
                  onClearMarks={markedMsgId === entry.id ? clearMarks : null}
                />
              )}
              <AiReplyProgress
                reply={entry}
                thinking={t('aiThinking')}
                working={t('aiWorking')}
                paused={inlineQuestions.waitingForPerson}
              />
              {isLast && !busy && qualityFindings.length > 0 && (
                <AiQualityBadge
                  lang={lang}
                  findings={qualityFindings}
                  aiVisible
                  onFixWithAi={() => {
                    const summary = qualityFindings
                      .map((f) => `- [${f.severity}] ${f.message}`)
                      .join('\n')
                    send(
                      `Please fix the following quality audit findings on the whiteboard:\n${summary}`,
                    )
                  }}
                />
              )}
              {(showToolbar || (turnEnded && entry.usage)) && (
                <AiReplyFooter
                  lang={lang}
                  isLast={isLast}
                  copyText={showToolbar ? entry.text : undefined}
                  onRetry={
                    showToolbar && isLast && !busy && runInstructionRef.current ? retry : undefined
                  }
                  usage={turnEnded ? entry.usage : undefined}
                  nextSteps={
                    isLast
                      ? {
                          context: {
                            aiVisible: true,
                            streaming: Boolean(entry.streaming),
                            completedNormally: !entry.isError && !entry.blocked,
                            editorKind: 'whiteboard',
                            editedDocument: Boolean(entry.changes),
                            qualityIssueCount: qualityFindings.length,
                            usedSkillName: entry.skills?.[0]?.title,
                            canGenerateOtherDoc: true,
                            hasSavedPath: Boolean(filePath),
                          },
                          onRunAi: (fixPrompt) => send(fixPrompt),
                          onOpenTweaks,
                          onGenerateOtherDoc: openGenerateForCurrentDocument,
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )
        })}
        {inlineQuestions.activeToolCard && (
          <AiQuestionCard
            key={inlineQuestions.activeToolCard.id}
            lang={lang}
            view={inlineQuestions.activeToolCard.view}
            status={inlineQuestions.activeToolCard.status}
            answer={inlineQuestions.activeToolCard.answer}
            onSubmit={inlineQuestions.submitToolCard}
            onSkip={inlineQuestions.skipToolCard}
          />
        )}
        <McpPermissionCard lang={lang} />
        {project.hint}
        {project.notices}
      </div>

      <AiScrollToBottom
        visible={showScrollBottom && chat.length > 0}
        lang={lang}
        onClick={() => {
          stickToBottomRef.current = true
          scrollToBottom()
        }}
      />

      {(sendGate.connectChoice || sendGate.noticeDue) && (
        <div className="ai-composer">
          {sendGate.connectChoice ? (
            <AiConnectPrompt
              choice={sendGate.connectChoice}
              statuses={sub.statuses}
              lang={lang}
              disabled={sub.busy}
              attention={sendGate.connectAttention}
              onOpenSettings={() => void window.whiteboardApi.ai.openModelSettings()}
              onInstall={sub.install}
              onUpdate={sub.update}
              onCancelLogin={sub.cancelLogin}
              onLogin={sub.login}
              onRecheck={sub.recheck}
              onAcceptMetered={sub.acceptMetered}
              onOpenInstallHelp={sub.openInstallHelp}
              onOpenConnectHelp={sub.openConnectHelp}
            />
          ) : (
            <AiFirstConnectionNotice
              lang={lang}
              codexKeepsHistory
              onAcknowledge={sendGate.acknowledgeNotice}
            />
          )}
        </div>
      )}

      <div className="ai-composer">
        {attachments.length > 0 && (
          <div className="ai-attachments">
            <AttachmentList
              atts={attachments}
              previews={attachmentPreviews}
              onRemove={removeAttachment}
              removeLabel={t('aiRemoveAttachmentTitle')}
            />
          </div>
        )}
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
        {inputTruncated && (
          <AiInputTruncatedNotice lang={lang} onDismiss={() => setInputTruncated(false)} />
        )}
        {aiSettings !== null && localModelCapabilities(aiSettings).tools === false && (
          <AiToolsUnsupportedNotice lang={lang} />
        )}
        <AiSubscriptionUsageLine usage={subscriptionUsage} lang={lang} />
        <AiComposer
          queueStrip={
            <AiQueueStrip
              items={msgQueue.queued}
              labels={AI_QUEUE_LABELS[lang]}
              onUpdate={msgQueue.update}
              onRemove={msgQueue.remove}
              onClear={msgQueue.clear}
              paused={msgQueue.paused}
              onTogglePause={msgQueue.togglePaused}
              onMove={msgQueue.move}
            />
          }
          onQueue={enqueueDraft}
          queuePlaceholder={AI_QUEUE_LABELS[lang].queuePlaceholder}
          value={prompt}
          busy={busy}
          placeholder={t('aiComposerPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          lang={lang}
          showSkillButton
          sendIconEnabled={<IconArrowUp size={15} />}
          sendIconDisabled={<IconArrowUp size={15} />}
          stopIcon={<IconStop size={12} />}
          textareaRef={inputRef}
          onChange={setPrompt}
          onSend={sendDraft}
          onStop={stop}
          skills={skills.composer}
          docs={docMention}
          onPasteFiles={(files) => void handlePasteFiles(files)}
          footerBelow={project.picker}
          footerBelowEnd={sessionUsage && <AiUsageChip usage={sessionUsage} session lang={lang} />}
          footerStart={
            <>
              <AiAttachMenu
                lang={lang}
                onPickPc={() => void handleAddAttachments()}
                onPickedDocs={attachFromPicker}
                onPickedDrive={attachFromPicker}
              />
              <McpServerButton lang={lang} />
            </>
          }
          footerEnd={
            <AiModelPicker
              bridge={MODEL_BRIDGE}
              lang={lang}
              subscriptionStatuses={sub.statuses}
              onRefreshSubscriptions={() => sub.refresh()}
            />
          }
        />
      </div>
    </aside>
  )
}

function Svg({ children, size = 15 }: { children: ReactNode; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function IconNewChat(): ReactElement {
  return (
    <Svg>
      <path d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3" />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </Svg>
  )
}

function IconCollapse(): ReactElement {
  return (
    <Svg>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5.5 2.5v11" />
      <path d="M12.5 8H8.1M9.8 5.9 7.7 8l2.1 2.1" strokeWidth="1.3" />
    </Svg>
  )
}
