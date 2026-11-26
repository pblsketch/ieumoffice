import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Lang, Params } from '@genoffice/i18n'
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconClose } from '@genoffice/ui/icons'
import {
  MAX_SPLIT_MAX_BYTES,
  MIN_SPLIT_MAX_BYTES,
  formatPartPages,
  formatSplitOutputNames,
  parseSplitRangeList,
  planSplitParts,
  splitSubfolderName,
  type SplitNamingPattern,
  type SplitPlanRequest,
  type SplitSizeUnit,
} from '../../../../../pdf/src/shared/split-plan'
import {
  PDF_TOOL_ANNOT_KINDS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_PAPERS,
  PDF_TOOL_SHEET_PAGES,
  type PdfBatchItemOutcome,
  type PdfBlankCandidate,
  type PdfBookmarkItem,
  type PdfConvertFormat,
  type PdfEditorToolId,
  type PdfImageOptimize,
  type PdfImageOrientation,
  type PdfInputProblem,
  type PdfOrganizePageSpec,
  type PdfProgressEvent,
  type PdfSpaceAudit,
  type PdfToolAccept,
  type PdfToolAnnotKind,
  type PdfToolError,
  type PdfToolId,
  type PdfToolInput,
  type PdfToolInputKind,
  type PdfToolMargin,
  type PdfToolOptions,
  type PdfToolPaper,
  type PdfToolsStart,
} from '../../../shared/pdf-tools-api'
import { pdfToolsText, type PdfToolsStringKey } from '../i18n/strings-pdf-tools'
import { formatBytes } from '../generate/format'
import {
  IconBlankPages,
  IconCompress,
  IconConvertPdf,
  IconCropPages,
  IconDocsToPdf,
  IconDuplex,
  IconEditText,
  IconExportImg,
  IconExtract,
  IconImagesToPdf,
  IconInterleave,
  IconLockPdf,
  IconMergePages,
  IconMergePdf,
  IconOcrPdf,
  IconOrganizePages,
  IconOverlay,
  IconPageSize,
  IconRepairPdf,
  IconReverse,
  IconRotateAll,
  IconSplitPages,
  IconSplitPdf,
  IconStripAnnots,
  IconToText,
  IconUnlockPdf,
  IconWatermark,
} from '../../../../../pdf/src/renderer/icons'
import { BatchSummary } from './BatchSummary'
import { CompressOptions, type TargetMissedState } from './CompressOptions'
import { OrganizeView } from './OrganizeView'

/** Home groups of the 24 direct tools (spec 3.1) */
const GROUPS: { label: PdfToolsStringKey; tools: PdfToolId[] }[] = [
  {
    label: 'groupOrganize',
    tools: [
      'organize',
      'merge',
      'interleave',
      'split',
      'extract',
      'reverse',
      'rotate',
      'blankPages',
    ],
  },
  { label: 'groupPrint', tools: ['duplex', 'nup', 'pageSize', 'splitPages'] },
  { label: 'groupDecorate', tools: ['overlay'] },
  { label: 'groupClean', tools: ['stripAnnots'] },
  {
    label: 'groupConvert',
    tools: ['ocr', 'imagesToPdf', 'docsToPdf', 'pdfToImages', 'convertFromPdf', 'toText'],
  },
  { label: 'groupSizeSecurity', tools: ['compress', 'encrypt', 'decrypt', 'repair'] },
]

const BATCH_TOOLS: ReadonlySet<PdfToolId> = new Set<PdfToolId>([
  'reverse',
  'rotate',
  'nup',
  'pageSize',
  'splitPages',
  'overlay',
  'stripAnnots',
  'ocr',
  'docsToPdf',
  'pdfToImages',
  'convertFromPdf',
  'toText',
  'compress',
  'encrypt',
  'decrypt',
  'repair',
])

const CHAIN_TARGETS: readonly PdfToolId[] = [
  'compress',
  'encrypt',
  'organize',
  'ocr',
  'pdfToImages',
  'convertFromPdf',
  'merge',
  'interleave',
  'extract',
  'reverse',
  'rotate',
  'blankPages',
  'duplex',
  'nup',
  'pageSize',
  'splitPages',
  'overlay',
  'stripAnnots',
  'toText',
  'repair',
]

const RECOMMENDED_NEXT: Partial<Record<PdfToolId, PdfToolId[]>> = {
  merge: ['compress', 'encrypt', 'organize', 'nup'],
  interleave: ['ocr', 'compress', 'organize', 'encrypt'],
  ocr: ['convertFromPdf', 'toText', 'compress', 'encrypt'],
  organize: ['compress', 'encrypt', 'pdfToImages'],
  imagesToPdf: ['ocr', 'compress', 'encrypt', 'organize'],
  docsToPdf: ['compress', 'encrypt', 'merge', 'overlay'],
  decrypt: ['organize', 'compress', 'convertFromPdf', 'merge'],
  compress: ['encrypt', 'overlay', 'pdfToImages'],
}

const RECENT_STORAGE_KEY = 'ieumoffice-pdf-tools-recent'
const MAX_RECENT_TOOLS = 4

const inputKindOf = (tool: PdfToolId): PdfToolInputKind =>
  tool === 'imagesToPdf'
    ? 'image'
    : tool === 'docsToPdf'
      ? 'document'
      : tool === 'merge'
        ? 'mixed'
        : 'pdf'

const takesMany = (tool: PdfToolId) =>
  tool === 'merge' ||
  tool === 'imagesToPdf' ||
  tool === 'duplex' ||
  tool === 'docsToPdf' ||
  BATCH_TOOLS.has(tool)

const accepts = (tool: PdfToolId): PdfToolAccept =>
  tool === 'decrypt' ? 'encrypted' : tool === 'repair' ? 'damaged' : 'pdf'

const runsAsJob = (tool: PdfToolId) =>
  tool === 'encrypt' ||
  tool === 'decrypt' ||
  tool === 'repair' ||
  tool === 'ocr' ||
  tool === 'pdfToImages' ||
  tool === 'convertFromPdf' ||
  tool === 'docsToPdf'

/** the longest password AES-256 PDF encryption keeps (tools.ts MAX_PASSWORD_BYTES) */
const passwordTooLong = (text: string) => new TextEncoder().encode(text).length > 127

const MARGIN_TEXT: Record<PdfToolMargin, PdfToolsStringKey> = {
  none: 'optMarginNone',
  small: 'optMarginSmall',
  large: 'optMarginLarge',
}

const EDITOR_TOOLS: PdfEditorToolId[] = ['stamps', 'crop', 'edit']

const TOOL_TEXT: Record<PdfToolId | PdfEditorToolId, [PdfToolsStringKey, PdfToolsStringKey]> = {
  organize: ['toolOrganize', 'descOrganize'],
  merge: ['toolMerge', 'descMerge'],
  interleave: ['toolInterleave', 'descInterleave'],
  split: ['toolSplit', 'descSplit'],
  extract: ['toolExtract', 'descExtract'],
  reverse: ['toolReverse', 'descReverse'],
  rotate: ['toolRotate', 'descRotate'],
  nup: ['toolNup', 'descNup'],
  pageSize: ['toolPageSize', 'descPageSize'],
  splitPages: ['toolSplitPages', 'descSplitPages'],
  imagesToPdf: ['toolImagesToPdf', 'descImagesToPdf'],
  docsToPdf: ['toolDocsToPdf', 'descDocsToPdf'],
  pdfToImages: ['toolExportImages', 'descExportImages'],
  convertFromPdf: ['toolConvert', 'descConvert'],
  toText: ['toolToText', 'descToText'],
  duplex: ['toolDuplex', 'descDuplex'],
  overlay: ['toolOverlay', 'descOverlay'],
  stripAnnots: ['toolStripAnnots', 'descStripAnnots'],
  blankPages: ['toolBlankPages', 'descBlankPages'],
  ocr: ['toolOcr', 'descOcr'],
  compress: ['toolCompress', 'descCompress'],
  encrypt: ['toolEncrypt', 'descEncrypt'],
  decrypt: ['toolDecrypt', 'descDecrypt'],
  repair: ['toolRepair', 'descRepair'],
  stamps: ['toolStamps', 'descStamps'],
  crop: ['toolCrop', 'descCrop'],
  edit: ['toolEdit', 'descEdit'],
}

const ERROR_TEXT: Record<PdfToolError, PdfToolsStringKey> = {
  'no-input': 'errNoInput',
  'need-two': 'errNeedTwo',
  missing: 'errMissing',
  'too-large': 'errTooLarge',
  range: 'errRange',
  'same-as-source': 'errSameAsSource',
  'unsaved-target': 'errUnsavedTarget',
  busy: 'errBusy',
  'no-text': 'errNoText',
  'need-background': 'errNeedBackground',
  'need-even': 'errNeedEven',
  'no-annots': 'errNoAnnots',
  'no-kinds': 'errNoKinds',
  'all-pages': 'errAllPages',
  'not-found': 'errNotFound',
  'none-chosen': 'errNoneChosen',
  'not-smaller': 'errNotSmaller',
  'password-empty': 'errPasswordEmpty',
  'password-same': 'errPasswordSame',
  'password-long': 'errPasswordLong',
  'wrong-password': 'errWrongPassword',
  'no-ocr-engine': 'errNoOcrEngine',
  'no-ocr-changes': 'errNoOcrChanges',
  'no-embedded-images': 'errNoEmbeddedImages',
  'invalid-target-size': 'errInvalidTargetSize',
  'mix-converting': 'errMixConverting',
  'mix-failed': 'errMixFailed',
  'empty-organize': 'errEmptyOrganize',
  'no-bookmarks': 'errNoBookmarks',
  'invalid-size': 'errInvalidSize',
  failed: 'errFailed',
}

const REJECT_TEXT: Record<PdfInputProblem, PdfToolsStringKey> = {
  encrypted: 'rejectEncrypted',
  unreadable: 'rejectUnreadable',
  'too-large': 'rejectTooLarge',
  'not-image': 'rejectNotImage',
  'not-encrypted': 'rejectNotEncrypted',
  'unsupported-document': 'rejectUnsupportedDoc',
}

const PER_SHEET = [2, 4, 6, 8, 9, 16]
const CONVERT_FORMATS: { id: PdfConvertFormat; label: string }[] = [
  { id: 'docx', label: 'Word (.docx)' },
  { id: 'xlsx', label: 'Excel (.xlsx)' },
  { id: 'pptx', label: 'PowerPoint (.pptx)' },
  { id: 'hwpx', label: 'HWPX (.hwpx)' },
  { id: 'md', label: 'Markdown (.md)' },
  { id: 'epub', label: 'EPUB (.epub)' },
]

const DEFAULT_OPTIONS: PdfToolOptions = {
  chunkSize: 1,
  splitMode: 'ranges',
  splitRanges: '',
  splitMergeRanges: false,
  splitFixedKind: 'pagesPerFile',
  splitFixedValue: 1,
  splitBookmarkLevel: 1,
  splitIncludeLeading: true,
  splitMaxBytes: 10 * 1024 * 1024,
  splitPrefix: '',
  splitPattern: 'numbered',
  splitCreateSubfolder: true,
  pages: '',
  perSheet: 2,
  direction: 'horizontal',
  separator: false,
  rotation: 90,
  paper: 'A4',
  perPage: 2,
  imagePaper: 'A4',
  margin: 'small',
  imageOrientation: 'auto',
  imageOptimize: 'original',
  sheetPages: 1,
  compressLevel: 'medium',
  compressMode: 'medium',
  targetSizeMb: 5,
  grayscaleImages: false,
  linearize: false,
  stripMetadata: false,
  reocrExisting: false,
  reverseEven: true,
  pdfToImagesMode: 'pages',
  imageFormat: 'jpg',
  imageDpi: 200,
  imageQuality: 'medium',
  imageOutMode: 'zip',
  targetFormat: 'docx',
  epubCover: true,
  epubPageBreaks: false,
  addBookmarks: true,
  unifyPaper: 'keep',
  docsOutputMode: 'each',
  layer: 'behind',
  backgroundPage: 1,
  applyPages: '',
  annotKinds: PDF_TOOL_ANNOT_KINDS.filter((kind) => kind !== 'links'),
}

const ANNOT_KIND_TEXT: Record<PdfToolAnnotKind, PdfToolsStringKey> = {
  comments: 'kindComments',
  highlights: 'kindHighlights',
  drawings: 'kindDrawings',
  stamps: 'kindStamps',
  links: 'kindLinks',
  other: 'kindOther',
}

interface BlankState {
  finding: { done: number; total: number } | null
  found: { pageCount: number; candidates: PdfBlankCandidate[] } | null
  chosen: number[]
}

const NO_BLANK: BlankState = { finding: null, found: null, chosen: [] }

type View =
  { kind: 'home' } | { kind: 'tool'; tool: PdfToolId } | { kind: 'editor'; tool: PdfEditorToolId }

type Outcome =
  | {
      kind: 'done'
      outputs: { id: string; name: string; size: number }[]
      notice?: 'unlocked-unencrypted'
      ocrSummary?: { ocredPages: number; skippedPages: number }
      batch?: PdfBatchItemOutcome[]
      oversizedPages?: number[]
    }
  | { kind: 'canceled'; savedCount: number }
  | { kind: 'error'; message: string }
  | null

const TOOL_ICON: Record<PdfToolId | PdfEditorToolId, () => ReactElement> = {
  organize: IconOrganizePages,
  merge: IconMergePdf,
  interleave: IconInterleave,
  split: IconSplitPdf,
  extract: IconExtract,
  reverse: IconReverse,
  rotate: IconRotateAll,
  nup: IconMergePages,
  pageSize: IconPageSize,
  splitPages: IconSplitPages,
  imagesToPdf: IconImagesToPdf,
  docsToPdf: IconDocsToPdf,
  pdfToImages: IconExportImg,
  convertFromPdf: IconConvertPdf,
  toText: IconToText,
  duplex: IconDuplex,
  overlay: IconOverlay,
  stripAnnots: IconStripAnnots,
  blankPages: IconBlankPages,
  ocr: IconOcrPdf,
  compress: IconCompress,
  encrypt: IconLockPdf,
  decrypt: IconUnlockPdf,
  repair: IconRepairPdf,
  stamps: IconWatermark,
  crop: IconCropPages,
  edit: IconEditText,
}

function ToolIcon({ tool }: { tool: PdfToolId | PdfEditorToolId }) {
  const Glyph = TOOL_ICON[tool]
  return (
    <span className="pt-card-icon">
      <Glyph />
    </span>
  )
}

function readRecentTools(): PdfToolId[] {
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (id): id is PdfToolId =>
          typeof id === 'string' &&
          id in TOOL_ICON &&
          !(EDITOR_TOOLS as readonly string[]).includes(id),
      )
      .slice(0, MAX_RECENT_TOOLS)
  } catch {
    return []
  }
}

function pushRecentTool(tool: PdfToolId): PdfToolId[] {
  const next = [tool, ...readRecentTools().filter((id) => id !== tool)].slice(0, MAX_RECENT_TOOLS)
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage quota errors
  }
  return next
}

export function PdfToolsWindow({ lang }: { lang: Lang }) {
  const api = window.aiOfficePdfTools
  const t = (key: PdfToolsStringKey, params?: Params) => pdfToolsText(lang, key, params)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [search, setSearch] = useState('')
  const [recentTools, setRecentTools] = useState<PdfToolId[]>(() => readRecentTools())
  const [inputs, setInputs] = useState<PdfToolInput[]>([])
  const [background, setBackground] = useState<PdfToolInput | null>(null)
  const [evenInput, setEvenInput] = useState<PdfToolInput | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [options, setOptions] = useState<PdfToolOptions>(DEFAULT_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [blank, setBlank] = useState<BlankState>(NO_BLANK)
  const [progress, setProgress] = useState<PdfProgressEvent | null>(null)
  const [splitBookmarks, setSplitBookmarks] = useState<{
    loading: boolean
    items: PdfBookmarkItem[]
  }>({ loading: false, items: [] })
  const [audit, setAudit] = useState<PdfSpaceAudit | null>(null)
  const [targetMissed, setTargetMissed] = useState<TargetMissedState | null>(null)
  const [ocrStatus, setOcrStatus] = useState<{ available: boolean; platform: string } | null>(null)
  const [unlockErrors, setUnlockErrors] = useState<Record<string, string>>({})
  const [unlockDrafts, setUnlockDrafts] = useState<Record<string, string>>({})
  const extraOrganizeIdsRef = useRef<string[]>([])

  const releaseIds = (ids: string[]) => {
    const clean = ids.filter((id) => id.length > 0)
    if (clean.length > 0) void api.releaseInputs?.(clean)
  }

  const openTool = (next: View) => {
    if (targetMissed) {
      void api.confirmSavePartial(targetMissed.pendingId, false)
    }
    releaseIds([
      ...inputs.map((i) => i.id),
      ...(background ? [background.id] : []),
      ...(evenInput ? [evenInput.id] : []),
      ...extraOrganizeIdsRef.current,
    ])
    extraOrganizeIdsRef.current = []
    setView(next)
    setInputs([])
    setBackground(null)
    setEvenInput(null)
    setBlank(NO_BLANK)
    setSplitBookmarks({ loading: false, items: [] })
    setRejected([])
    setOptions(DEFAULT_OPTIONS)
    setOutcome(null)
    setAudit(null)
    setTargetMissed(null)
    setUnlockErrors({})
    setUnlockDrafts({})
  }

  // Subscribe to background mixed-merge status events
  useEffect(() => {
    return api.onMixStatus?.((ev) => {
      setInputs((prev) =>
        prev.map((item) =>
          item.id === ev.inputId
            ? {
                ...item,
                mixState: ev.state,
                ...(ev.pages !== undefined ? { pages: ev.pages } : {}),
                ...(ev.thumb !== undefined ? { thumb: ev.thumb } : {}),
                ...(ev.error !== undefined ? { mixError: ev.error } : {}),
              }
            : item,
        ),
      )
    })
  }, [api])

  // Check local OCR engine availability once when entering OCR tool
  useEffect(() => {
    if (view.kind === 'tool' && view.tool === 'ocr' && ocrStatus === null) {
      void api.ocrAvailable().then(setOcrStatus)
    }
  }, [api, view, ocrStatus])

  // Run space audit automatically when a single unlocked PDF is active in compress
  useEffect(() => {
    if (view.kind !== 'tool' || view.tool !== 'compress' || inputs.length !== 1) {
      setAudit(null)
      return
    }
    const first = inputs[0]!
    if (first.encrypted && !first.unlocked) {
      setAudit(null)
      return
    }
    let canceled = false
    void api.auditSpace(first.id).then((res) => {
      if (!canceled && res.ok) setAudit(res.audit)
    })
    return () => {
      canceled = true
    }
  }, [api, view, inputs])

  const acceptPickedResult = (
    tool: PdfToolId,
    result: { inputs: PdfToolInput[]; rejected: { name: string; problem: PdfInputProblem }[] },
  ) => {
    setRejected(result.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
    if (result.inputs.length === 0) return
    setOutcome(null)
    setTargetMissed(null)
    setBlank(NO_BLANK)
    const many = takesMany(tool)
    if (!many) {
      releaseIds([...inputs.map((i) => i.id), ...extraOrganizeIdsRef.current])
      extraOrganizeIdsRef.current = []
      const unused = result.inputs.slice(1).map((i) => i.id)
      releaseIds(unused)
    }
    setInputs((prev) => (many ? [...prev, ...result.inputs] : result.inputs.slice(0, 1)))
  }

  const firstInputId = inputs[0]?.id ?? null
  const firstInputPages = inputs[0]?.pages ?? 0
  const firstInputName = inputs[0]?.name ?? ''
  useEffect(() => {
    if (view.kind !== 'tool' || view.tool !== 'split' || !firstInputId) {
      setSplitBookmarks({ loading: false, items: [] })
      return
    }
    let live = true
    const defaultRange =
      firstInputPages >= 2
        ? `1-${Math.floor(firstInputPages / 2)}, ${Math.floor(firstInputPages / 2) + 1}-${firstInputPages}`
        : firstInputPages === 1
          ? '1'
          : ''
    const basePrefix = firstInputName.replace(/\.pdf$/i, '')
    setOptions((prev) => ({
      ...prev,
      splitRanges: defaultRange,
      splitPrefix: basePrefix,
    }))
    setSplitBookmarks({ loading: true, items: [] })
    void api.readBookmarks(firstInputId).then((res) => {
      if (!live) return
      setSplitBookmarks({ loading: false, items: res.ok ? res.bookmarks : [] })
    })
    return () => {
      live = false
    }
  }, [api, view, firstInputId, firstInputPages, firstInputName])

  const pick = async (tool: PdfToolId) => {
    const many = takesMany(tool)
    const result = await api.pickInputs(many, inputKindOf(tool), accepts(tool))
    acceptPickedResult(tool, result)
  }

  const drop = async (tool: PdfToolId, files: File[]) => {
    if (files.length === 0) return
    const result = await api.dropInputs(files, inputKindOf(tool), accepts(tool))
    acceptPickedResult(tool, result)
  }

  const unlockRow = async (inputId: string, isBackground = false, isEven = false) => {
    const pw = unlockDrafts[inputId] ?? ''
    if (!pw) return
    const res = await api.unlockInput(inputId, pw)
    if (!res.ok) {
      setUnlockErrors((prev) => ({ ...prev, [inputId]: t('errWrongPassword') }))
      return
    }
    setUnlockDrafts((prev) => {
      const next = { ...prev }
      delete next[inputId]
      return next
    })
    setUnlockErrors((prev) => {
      const next = { ...prev }
      delete next[inputId]
      return next
    })
    if (isBackground) {
      setBackground((prev) => (prev ? { ...prev, unlocked: true, pages: res.pages } : prev))
    } else if (isEven) {
      setEvenInput((prev) => (prev ? { ...prev, unlocked: true, pages: res.pages } : prev))
    } else {
      setInputs((prev) =>
        prev.map((item) =>
          item.id === inputId ? { ...item, unlocked: true, pages: res.pages } : item,
        ),
      )
    }
  }

  const findBlank = async () => {
    const input = inputs[0]
    if (!input) return
    setOutcome(null)
    setBlank({ ...NO_BLANK, finding: { done: 0, total: input.pages } })
    const stop = api.onProgress((done, total) =>
      setBlank((prev) => (prev.finding ? { ...prev, finding: { done, total } } : prev)),
    )
    try {
      const result = await api.findBlankPages(input.id)
      if (result.ok) {
        const chosen = result.candidates.filter((c) => c.reason === 'empty').map((c) => c.page)
        setBlank({ finding: null, found: result, chosen })
      } else {
        setBlank(NO_BLANK)
        if ('error' in result) setOutcome({ kind: 'error', message: t(ERROR_TEXT[result.error]) })
      }
    } finally {
      stop()
    }
  }

  const pickBackground = async () => {
    const result = await api.pickInputs(false, 'pdf')
    setRejected(result.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
    const picked = result.inputs[0]
    if (!picked) return
    if (background) releaseIds([background.id])
    setOutcome(null)
    setBackground(picked)
    setOptions((prev) =>
      (prev.backgroundPage ?? 1) > picked.pages ? { ...prev, backgroundPage: 1 } : prev,
    )
  }

  const pickEven = async () => {
    const result = await api.pickInputs(false, 'pdf')
    setRejected(result.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
    const picked = result.inputs[0]
    if (!picked) return
    if (evenInput) releaseIds([evenInput.id])
    setOutcome(null)
    setEvenInput(picked)
  }

  const move = (index: number, by: -1 | 1) => {
    setInputs((prev) => {
      const next = [...prev]
      const target = index + by
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  const reorderInput = (from: number, to: number) => {
    if (from === to) return
    setInputs((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      if (!moved) return prev
      next.splice(to, 0, moved)
      return next
    })
  }

  const runTool = async (tool: PdfToolId, organizePlan?: PdfOrganizePageSpec[]) => {
    setBusy(true)
    setOutcome(null)
    setTargetMissed(null)
    const stop = api.onProgress((done, total, detail) => setProgress(detail ?? { done, total }))
    // the typed-again password is only checked here; it is never sent
    const { passwordConfirm: _confirm, ...sent } = options
    try {
      const result = await api.run({
        tool,
        inputIds: inputs.map((i) => i.id),
        options: tool === 'blankPages' ? { ...sent, removePages: blank.chosen.join(',') } : sent,
        ...(tool === 'overlay' && background ? { backgroundId: background.id } : {}),
        ...(tool === 'interleave' && evenInput ? { evenId: evenInput.id } : {}),
        ...(tool === 'organize' && organizePlan ? { organizePlan } : {}),
      })
      if (result.ok) {
        setRecentTools(pushRecentTool(tool))
        setOutcome({
          kind: 'done',
          outputs: result.outputs,
          ...(result.notice ? { notice: result.notice } : {}),
          ...(result.ocrSummary ? { ocrSummary: result.ocrSummary } : {}),
          ...(result.batch ? { batch: result.batch } : {}),
          ...(result.oversizedPages?.length ? { oversizedPages: result.oversizedPages } : {}),
        })
        // a password the file now has, or had, is not kept on screen once it is used
        setOptions((prev) => ({
          ...prev,
          password: '',
          passwordConfirm: '',
          permissionPassword: '',
        }))
      } else if ('targetMissed' in result && result.targetMissed) {
        setTargetMissed({
          pendingId: result.pendingId,
          achievedBytes: result.achievedBytes,
          targetBytes: result.targetBytes,
          originalBytes: result.originalBytes,
        })
      } else if ('canceled' in result && result.canceled) {
        if (result.savedCount && result.savedCount > 0) {
          setOutcome({ kind: 'canceled', savedCount: result.savedCount })
        }
      } else if ('error' in result) {
        setOutcome({ kind: 'error', message: t(ERROR_TEXT[result.error]) })
      }
    } finally {
      stop()
      setProgress(null)
      setBusy(false)
    }
  }

  const handleConfirmPartial = async (save: boolean) => {
    if (!targetMissed) return
    setBusy(true)
    try {
      const res = await api.confirmSavePartial(targetMissed.pendingId, save)
      setTargetMissed(null)
      if (res.ok) {
        setRecentTools(pushRecentTool('compress'))
        setOutcome({
          kind: 'done',
          outputs: res.outputs,
          ...(res.notice ? { notice: res.notice } : {}),
        })
      } else if ('error' in res) {
        setOutcome({ kind: 'error', message: t(ERROR_TEXT[res.error]) })
      }
    } finally {
      setBusy(false)
    }
  }

  const handlePromoteResult = async (outputId: string, nextTool: PdfToolId) => {
    const res = await api.promoteResult(outputId, nextTool)
    if (!res.ok) {
      setOutcome({ kind: 'error', message: t(ERROR_TEXT[res.error]) })
      return
    }
    openTool({ kind: 'tool', tool: res.start.tool })
    setInputs(res.start.inputs)
    setRejected(res.start.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
  }

  const handlePromoteInput = async (inputId: string, nextTool: PdfToolId) => {
    const res = await api.promoteInput(inputId, nextTool)
    if (!res.ok) {
      setOutcome({ kind: 'error', message: t(ERROR_TEXT[res.error]) })
      return
    }
    openTool({ kind: 'tool', tool: res.start.tool })
    setInputs(res.start.inputs)
    setRejected(res.start.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
  }

  const set = (patch: PdfToolOptions) => setOptions((prev) => ({ ...prev, ...patch }))

  const startRef = useRef<(start: PdfToolsStart) => void>(() => {})
  startRef.current = (start) => {
    openTool({ kind: 'tool', tool: start.tool })
    setInputs(start.inputs)
    setRejected(start.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
  }
  useEffect(() => {
    const take = () =>
      void api.takeStart().then((start) => {
        if (start) startRef.current(start)
      })
    take()
    return api.onStartReady(take)
  }, [api])

  const query = search.trim().toLowerCase()
  const matchesQuery = (id: PdfToolId | PdfEditorToolId): boolean => {
    if (!query) return true
    const [titleKey, descKey] = TOOL_TEXT[id]
    return t(titleKey).toLowerCase().includes(query) || t(descKey).toLowerCase().includes(query)
  }

  const filteredGroups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, tools: g.tools.filter(matchesQuery) })).filter(
        (g) => g.tools.length > 0,
      ),
    [query, lang],
  )
  const filteredEditorTools = useMemo(() => EDITOR_TOOLS.filter(matchesQuery), [query, lang])

  return (
    <div className="pt">
      <header className="pt-head">
        <h1 className="pt-title">{t('windowTitle')}</h1>
        {/* "pick a task first" is stale once a task is open */}
        {view.kind === 'home' && <p className="pt-intro">{t('intro')}</p>}
        <p className="pt-local">{t('localNote')}</p>
      </header>
      <main className="pt-body">
        {view.kind === 'home' && (
          <>
            <div className="pt-search-wrap">
              <input
                type="search"
                className="pt-input pt-search-input"
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {!query && recentTools.length > 0 && (
              <section className="pt-section">
                <h2 className="pt-label">{t('recentTools')}</h2>
                <div className="pt-cards">
                  {recentTools.map((tool) => (
                    <button
                      key={`recent-${tool}`}
                      type="button"
                      className="pt-card"
                      onClick={() => openTool({ kind: 'tool', tool })}
                    >
                      <ToolIcon tool={tool} />
                      <span className="pt-card-text">
                        <span className="pt-card-title">{t(TOOL_TEXT[tool][0])}</span>
                        <span className="pt-card-desc">{t(TOOL_TEXT[tool][1])}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {filteredGroups.map((group) => (
              <section className="pt-section" key={group.label}>
                <h2 className="pt-label">{t(group.label)}</h2>
                <div className="pt-cards">
                  {group.tools.map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      className="pt-card"
                      onClick={() => openTool({ kind: 'tool', tool })}
                    >
                      <ToolIcon tool={tool} />
                      <span className="pt-card-text">
                        <span className="pt-card-title">{t(TOOL_TEXT[tool][0])}</span>
                        <span className="pt-card-desc">{t(TOOL_TEXT[tool][1])}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {filteredEditorTools.length > 0 && (
              <section className="pt-section">
                <h2 className="pt-label">{t('groupEditor')}</h2>
                <div className="pt-cards">
                  {filteredEditorTools.map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      className="pt-card pt-card-editor"
                      onClick={() => openTool({ kind: 'editor', tool })}
                    >
                      <ToolIcon tool={tool} />
                      <span className="pt-card-text">
                        <span className="pt-card-title">{t(TOOL_TEXT[tool][0])}</span>
                        <span className="pt-card-desc">{t(TOOL_TEXT[tool][1])}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {filteredGroups.length === 0 && filteredEditorTools.length === 0 && (
              <p className="pt-hint">{t('searchEmpty')}</p>
            )}
          </>
        )}

        {view.kind === 'editor' && (
          <section className="pt-section">
            <button type="button" className="pt-back" onClick={() => openTool({ kind: 'home' })}>
              <span className="pt-back-arrow">
                <IconArrowLeft size={14} />
              </span>
              {t('back')}
            </button>
            <h2 className="pt-tool-title">{t(TOOL_TEXT[view.tool][0])}</h2>
            <p className="pt-hint">{t(TOOL_TEXT[view.tool][1])}</p>
            <p className="pt-hint">{t('editorHint')}</p>
            <div className="pt-actions">
              <button
                type="button"
                className="pt-btn pt-btn-primary"
                onClick={() => void api.openInEditor()}
              >
                {t('openInEditor')}
              </button>
            </div>
          </section>
        )}

        {view.kind === 'tool' && (
          <ToolPanel
            lang={lang}
            tool={view.tool}
            t={t}
            inputs={inputs}
            background={background}
            evenInput={evenInput}
            blank={blank}
            splitBookmarks={splitBookmarks}
            onOpenSplitInEditor={(id) => void api.openSplitInEditor(id)}
            progress={progress}
            audit={audit}
            targetMissed={targetMissed}
            ocrStatus={ocrStatus}
            unlockDrafts={unlockDrafts}
            unlockErrors={unlockErrors}
            onUnlockDraft={(id, val) => setUnlockDrafts((prev) => ({ ...prev, [id]: val }))}
            onUnlock={(id, isBg, isEv) => void unlockRow(id, isBg, isEv)}
            onConfirmPartial={(save) => void handleConfirmPartial(save)}
            onCancelRun={() => void api.cancelRun()}
            onFindBlank={() => void findBlank()}
            onCancelFind={() => void api.cancelFind()}
            onChooseBlank={(chosen) => setBlank((prev) => ({ ...prev, chosen }))}
            rejected={rejected}
            options={options}
            busy={busy}
            outcome={outcome}
            onBack={() => openTool({ kind: 'home' })}
            onPick={() => void pick(view.tool)}
            onDrop={(files) => void drop(view.tool, files)}
            onPickInsertPdf={async () => {
              const res = await api.pickInputs(false, 'pdf')
              setRejected(res.rejected.map((r) => t(REJECT_TEXT[r.problem], { name: r.name })))
              return res.inputs[0] ?? null
            }}
            onTrackExtraInput={(id) => {
              extraOrganizeIdsRef.current.push(id)
            }}
            onPickBackground={() => void pickBackground()}
            onRemoveBackground={() => {
              if (background) releaseIds([background.id])
              setBackground(null)
            }}
            onPickEven={() => void pickEven()}
            onRemoveEven={() => {
              if (evenInput) releaseIds([evenInput.id])
              setEvenInput(null)
            }}
            onRemove={(id) => {
              releaseIds([id])
              setInputs((prev) => prev.filter((i) => i.id !== id))
              setBlank(NO_BLANK)
            }}
            onMove={move}
            onReorder={reorderInput}
            onOptions={set}
            onRun={(plan) => void runTool(view.tool, plan)}
            onOpen={(id) => void api.openResult(id)}
            onReveal={(id) => void api.revealResult(id)}
            onOpenInEditorWithInput={(id) => void api.openInEditorWithInput(id)}
            onPromoteResult={(outId, next) => void handlePromoteResult(outId, next)}
            onPromoteInput={(inId, next) => void handlePromoteInput(inId, next)}
          />
        )}
      </main>
      <footer className="pt-foot">
        <button type="button" className="pt-btn" onClick={() => void api.close()}>
          {t('close')}
        </button>
      </footer>
    </div>
  )
}

interface ToolPanelProps {
  lang: Lang
  tool: PdfToolId
  t: (key: PdfToolsStringKey, params?: Params) => string
  inputs: PdfToolInput[]
  background: PdfToolInput | null
  evenInput: PdfToolInput | null
  blank: BlankState
  splitBookmarks: { loading: boolean; items: PdfBookmarkItem[] }
  onOpenSplitInEditor(inputId: string): void
  progress: PdfProgressEvent | null
  audit: PdfSpaceAudit | null
  targetMissed: TargetMissedState | null
  ocrStatus: { available: boolean; platform: string } | null
  unlockDrafts: Record<string, string>
  unlockErrors: Record<string, string>
  onUnlockDraft(id: string, val: string): void
  onUnlock(id: string, isBg?: boolean, isEven?: boolean): void
  onConfirmPartial(save: boolean): void
  onCancelRun(): void
  onFindBlank(): void
  onCancelFind(): void
  onChooseBlank(pages: number[]): void
  rejected: string[]
  options: PdfToolOptions
  busy: boolean
  outcome: Outcome
  onBack(): void
  onPick(): void
  onDrop(files: File[]): void
  onPickInsertPdf(): Promise<PdfToolInput | null>
  onTrackExtraInput(id: string): void
  onPickBackground(): void
  onRemoveBackground(): void
  onPickEven(): void
  onRemoveEven(): void
  onRemove(id: string): void
  onMove(index: number, by: -1 | 1): void
  onReorder(from: number, to: number): void
  onOptions(patch: PdfToolOptions): void
  onRun(plan?: PdfOrganizePageSpec[]): void
  onOpen(id: string): void
  onReveal(id: string): void
  onOpenInEditorWithInput(id: string): void
  onPromoteResult(outputId: string, nextTool: PdfToolId): void
  onPromoteInput(inputId: string, nextTool: PdfToolId): void
}

function ToolPanel(p: ToolPanelProps) {
  const { t, tool, inputs, options } = p
  const [dragOver, setDragOver] = useState(false)
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null)
  const [chainChoice, setChainChoice] = useState<string>('')

  const many = takesMany(tool)
  const kind = inputKindOf(tool)
  const isBatch = BATCH_TOOLS.has(tool) && inputs.length >= 2
  const first = inputs[0]
  const hasUnlockedFile =
    inputs.some((i) => i.encrypted && i.unlocked) ||
    Boolean(p.background?.encrypted && p.background.unlocked) ||
    Boolean(p.evenInput?.encrypted && p.evenInput.unlocked)

  const usableInputs = inputs.filter(
    (i) => !i.encrypted || i.unlocked || tool === 'decrypt' || tool === 'repair',
  )
  const mixConverting =
    tool === 'merge' && inputs.some((i) => i.mixState === 'pending' || i.mixState === 'converting')
  const mixFailed = tool === 'merge' && inputs.some((i) => i.mixState === 'error')

  const splitReady = (opts: PdfToolOptions, pages: number): boolean => {
    const mode = opts.splitMode ?? 'ranges'
    if (mode === 'ranges') return parseSplitRangeList(opts.splitRanges ?? '', pages).ok
    if (mode === 'fixed') return (opts.splitFixedValue ?? opts.chunkSize ?? 1) >= 1
    if (mode === 'bookmarks') return !p.splitBookmarks.loading && p.splitBookmarks.items.length > 0
    const maxBytes = opts.splitMaxBytes ?? 0
    return maxBytes >= MIN_SPLIT_MAX_BYTES && maxBytes <= MAX_SPLIT_MAX_BYTES
  }

  const ready = (() => {
    if (tool === 'organize') return inputs.length === 1 && usableInputs.length === 1
    if (tool === 'split') {
      return (
        inputs.length === 1 &&
        usableInputs.length === 1 &&
        !!first &&
        splitReady(options, first.pages)
      )
    }
    if (tool === 'merge')
      return (
        inputs.length >= 2 && usableInputs.length === inputs.length && !mixConverting && !mixFailed
      )
    if (tool === 'interleave') {
      return (
        inputs.length === 1 &&
        usableInputs.length === 1 &&
        !!p.evenInput &&
        (!p.evenInput.encrypted || p.evenInput.unlocked === true)
      )
    }
    if (tool === 'ocr' && p.ocrStatus && !p.ocrStatus.available) return false
    if (many) {
      if (usableInputs.length === 0) return false
      if (
        tool === 'overlay' &&
        (!p.background || (p.background.encrypted && !p.background.unlocked))
      )
        return false
      if (tool === 'stripAnnots' && (options.annotKinds ?? []).length === 0) return false
      if (tool === 'encrypt' && !encryptReady(options)) return false
      if (tool === 'decrypt' && !options.password) return false
      return true
    }
    return (
      inputs.length === 1 &&
      usableInputs.length === 1 &&
      (tool !== 'blankPages' || p.blank.chosen.length > 0)
    )
  })()

  const pickLabel: PdfToolsStringKey =
    kind === 'image'
      ? inputs.length === 0
        ? 'pickImages'
        : 'addMoreImages'
      : kind === 'document'
        ? inputs.length === 0
          ? 'pickDocuments'
          : 'addMoreDocuments'
        : kind === 'mixed'
          ? inputs.length === 0
            ? 'pickMixed'
            : 'addMoreMixed'
          : inputs.length === 0
            ? 'pickFiles'
            : many
              ? 'addMore'
              : 'replaceFile'

  const hint: PdfToolsStringKey =
    kind === 'image'
      ? 'hintImages'
      : kind === 'document'
        ? 'hintDocsToPdf'
        : kind === 'mixed'
          ? 'hintMergeMixed'
          : tool === 'interleave'
            ? 'hintInterleave'
            : tool === 'duplex'
              ? 'hintDuplex'
              : tool === 'overlay'
                ? 'hintOverlay'
                : tool === 'decrypt'
                  ? 'hintDecrypt'
                  : tool === 'repair'
                    ? 'hintRepair'
                    : 'hintOne'

  const done = p.outcome?.kind === 'done' ? p.outcome : null
  const firstOutput = done?.outputs[0]
  const canChain =
    done &&
    !done.batch &&
    done.outputs.length === 1 &&
    firstOutput &&
    firstOutput.name.toLowerCase().endsWith('.pdf')

  const orderedChainTargets = useMemo(() => {
    const rec = RECOMMENDED_NEXT[tool] ?? []
    const base = CHAIN_TARGETS.filter((id) => id !== tool)
    const top = rec.filter((id) => base.includes(id))
    const rest = base.filter((id) => !top.includes(id))
    return [...top, ...rest]
  }, [tool])

  const meta = (input: PdfToolInput) =>
    input.kind === 'image' || input.pages === 0
      ? formatBytes(input.size, p.lang)
      : `${t(input.pages === 1 ? 'pageCountOne' : 'pageCount', { n: input.pages })} · ${formatBytes(input.size, p.lang)}`

  const renderUnlockRow = (input: PdfToolInput, isBg = false, isEven = false) => {
    if (!input.encrypted || input.unlocked || tool === 'decrypt' || tool === 'repair') return null
    return (
      <div className="pt-unlock-row">
        <span className="pt-badge pt-badge-warn">{t('lockedBadge')}</span>
        <input
          type="password"
          className="pt-input pt-unlock-input"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('unlockPlaceholder')}
          value={p.unlockDrafts[input.id] ?? ''}
          onChange={(e) => p.onUnlockDraft(input.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') p.onUnlock(input.id, isBg, isEven)
          }}
        />
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={p.busy || !(p.unlockDrafts[input.id] ?? '')}
          onClick={() => p.onUnlock(input.id, isBg, isEven)}
        >
          {t('unlockButton')}
        </button>
        {p.unlockErrors[input.id] && (
          <span className="pt-inline-error">{p.unlockErrors[input.id]}</span>
        )}
      </div>
    )
  }

  return (
    <section className="pt-section">
      <button type="button" className="pt-back" disabled={p.busy} onClick={p.onBack}>
        <span className="pt-back-arrow">
          <IconArrowLeft size={14} />
        </span>
        {t('back')}
      </button>
      <h2 className="pt-tool-title">{t(TOOL_TEXT[tool][0])}</h2>
      <p className="pt-hint">{t(hint)}</p>

      {tool === 'ocr' && p.ocrStatus && !p.ocrStatus.available && (
        <p className="pt-note pt-note-error" role="alert">
          {t('ocrUnavailable', { platform: p.ocrStatus.platform })}
        </p>
      )}

      {tool === 'interleave' && <h3 className="pt-field-label pt-subhead">{t('labelOddPdf')}</h3>}

      <div
        className={`pt-dropzone${dragOver ? ' is-drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            p.onDrop(Array.from(e.dataTransfer.files))
          }
        }}
      >
        {inputs.length > 0 ? (
          <ul className="pt-list">
            {inputs.map((input, index) => {
              const itemRot = options.itemRotations?.[input.id] ?? 0
              const mixPendingOrConverting =
                input.mixState === 'pending' || input.mixState === 'converting'
              return (
                <li
                  className="pt-item-wrap"
                  key={input.id}
                  draggable={many && !p.busy}
                  onDragStart={() => setDragRowIdx(index)}
                  onDragOver={(e) => {
                    if (dragRowIdx !== null) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    if (dragRowIdx !== null) {
                      e.preventDefault()
                      e.stopPropagation()
                      p.onReorder(dragRowIdx, index)
                      setDragRowIdx(null)
                    }
                  }}
                  onDragEnd={() => setDragRowIdx(null)}
                >
                  <div className="pt-item">
                    {input.thumb && (
                      <img
                        src={input.thumb}
                        alt=""
                        className="pt-item-thumb"
                        style={itemRot ? { transform: `rotate(${itemRot}deg)` } : undefined}
                      />
                    )}
                    <span className="pt-item-name" title={input.name}>
                      {input.name}
                    </span>
                    {input.unlocked && (
                      <span className="pt-badge pt-badge-ok">{t('unlockedBadge')}</span>
                    )}
                    {input.mixState === 'pending' && (
                      <span className="pt-badge">{t('mixPending')}</span>
                    )}
                    {input.mixState === 'converting' && (
                      <span className="pt-badge">{t('mixConverting')}</span>
                    )}
                    {input.mixState === 'error' && (
                      <span className="pt-badge pt-badge-err">{t('mixError')}</span>
                    )}
                    <span className="pt-item-meta">{meta(input)}</span>
                    {tool === 'merge' && (
                      <input
                        type="text"
                        className="pt-input pt-range-mini"
                        disabled={mixPendingOrConverting || input.mixState === 'error'}
                        placeholder={t('optPerFileRange')}
                        value={options.mergeRanges?.[input.id] ?? ''}
                        onChange={(e) =>
                          p.onOptions({
                            mergeRanges: {
                              ...(options.mergeRanges ?? {}),
                              [input.id]: e.target.value,
                            },
                          })
                        }
                      />
                    )}
                    {tool === 'imagesToPdf' && (
                      <button
                        type="button"
                        className="pt-btn pt-btn-sm"
                        title={t('rotateItem')}
                        onClick={() =>
                          p.onOptions({
                            itemRotations: {
                              ...(options.itemRotations ?? {}),
                              [input.id]: ((itemRot + 90) % 360) as 0 | 90 | 180 | 270,
                            },
                          })
                        }
                      >
                        {itemRot > 0 ? `${itemRot}°` : '90°'}
                      </button>
                    )}
                    {many && (
                      <>
                        <button
                          type="button"
                          className="pt-icon-btn"
                          aria-label={t('moveUp')}
                          title={t('moveUp')}
                          disabled={p.busy || index === 0}
                          onClick={() => p.onMove(index, -1)}
                        >
                          <IconArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="pt-icon-btn"
                          aria-label={t('moveDown')}
                          title={t('moveDown')}
                          disabled={p.busy || index === inputs.length - 1}
                          onClick={() => p.onMove(index, 1)}
                        >
                          <IconArrowDown size={14} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="pt-icon-btn"
                      aria-label={t('remove')}
                      title={t('remove')}
                      disabled={p.busy}
                      onClick={() => p.onRemove(input.id)}
                    >
                      <IconClose size={14} />
                    </button>
                  </div>
                  {input.unsavedWarning && (
                    <p className="pt-item-warn">{t('unsavedWarningBadge')}</p>
                  )}
                  {renderUnlockRow(input)}
                </li>
              )
            })}
          </ul>
        ) : null}
        {/* the button first: the hint reads "or drop files here" */}
        <div className="pt-actions pt-actions-start">
          <button type="button" className="pt-btn" onClick={p.onPick} disabled={p.busy}>
            {t(pickLabel)}
          </button>
          <span className="pt-drop-inline">{t('dropZoneHint')}</span>
        </div>
      </div>

      {tool === 'interleave' && (
        <>
          <h3 className="pt-field-label pt-subhead">{t('labelEvenPdf')}</h3>
          {p.evenInput && (
            <ul className="pt-list">
              <li className="pt-item-wrap">
                <div className="pt-item">
                  <span className="pt-item-name" title={p.evenInput.name}>
                    {p.evenInput.name}
                  </span>
                  {p.evenInput.unlocked && (
                    <span className="pt-badge pt-badge-ok">{t('unlockedBadge')}</span>
                  )}
                  <span className="pt-item-meta">{meta(p.evenInput)}</span>
                  <button
                    type="button"
                    className="pt-icon-btn"
                    aria-label={t('remove')}
                    title={t('remove')}
                    disabled={p.busy}
                    onClick={p.onRemoveEven}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
                {renderUnlockRow(p.evenInput, false, true)}
              </li>
            </ul>
          )}
          <div className="pt-actions pt-actions-start">
            <button type="button" className="pt-btn" onClick={p.onPickEven} disabled={p.busy}>
              {t(p.evenInput ? 'replaceEvenPdf' : 'pickEvenPdf')}
            </button>
          </div>
          {first &&
            p.evenInput &&
            first.pages > 0 &&
            p.evenInput.pages > 0 &&
            first.pages !== p.evenInput.pages && (
              <p className="pt-note pt-note-warn">
                {t('interleaveMismatchWarn', { odd: first.pages, even: p.evenInput.pages })}
              </p>
            )}
        </>
      )}

      {tool === 'overlay' && (
        <>
          <h3 className="pt-field-label pt-subhead">{t('labelBackground')}</h3>
          {p.background && (
            <ul className="pt-list">
              <li className="pt-item-wrap">
                <div className="pt-item">
                  <span className="pt-item-name" title={p.background.name}>
                    {p.background.name}
                  </span>
                  {p.background.unlocked && (
                    <span className="pt-badge pt-badge-ok">{t('unlockedBadge')}</span>
                  )}
                  <span className="pt-item-meta">{meta(p.background)}</span>
                  <button
                    type="button"
                    className="pt-icon-btn"
                    aria-label={t('remove')}
                    title={t('remove')}
                    disabled={p.busy}
                    onClick={p.onRemoveBackground}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
                {renderUnlockRow(p.background, true, false)}
              </li>
            </ul>
          )}
          <div className="pt-actions pt-actions-start">
            <button type="button" className="pt-btn" onClick={p.onPickBackground} disabled={p.busy}>
              {t(p.background ? 'replaceBackground' : 'pickBackground')}
            </button>
          </div>
        </>
      )}

      {hasUnlockedFile && <p className="pt-note pt-note-warn">{t('noticeUnlockedUnencrypted')}</p>}

      {tool === 'convertFromPdf' &&
        first &&
        inputs.length === 1 &&
        first.hasTextLayer === false && (
          <div className="pt-note pt-note-warn">
            <p className="pt-warn-text">{t('scannedBanner')}</p>
            <div className="pt-actions pt-actions-start">
              <button
                type="button"
                className="pt-btn pt-btn-sm"
                onClick={() => p.onPromoteInput(first.id, 'ocr')}
              >
                {t('runOcrFirst')}
              </button>
            </div>
          </div>
        )}

      {p.rejected.map((line) => (
        <p className="pt-note pt-note-error" key={line} role="alert">
          {line}
        </p>
      ))}

      {first && tool === 'organize' && (!first.encrypted || first.unlocked) && (
        <OrganizeView
          t={t}
          primaryInput={first}
          busy={p.busy}
          onSave={(plan) => p.onRun(plan)}
          onPickInsertPdf={p.onPickInsertPdf}
          onTrackExtraInput={p.onTrackExtraInput}
        />
      )}

      {first && tool === 'blankPages' && (!first.encrypted || first.unlocked) && (
        <BlankPagesReview
          t={t}
          blank={p.blank}
          busy={p.busy}
          onFind={p.onFindBlank}
          onCancel={p.onCancelFind}
          onChoose={p.onChooseBlank}
        />
      )}

      {first && tool === 'compress' && (
        <CompressOptions
          lang={p.lang}
          t={t}
          options={options}
          audit={p.audit}
          targetMissed={p.targetMissed}
          busy={p.busy}
          onChange={p.onOptions}
          onConfirmPartial={p.onConfirmPartial}
        />
      )}

      {first && tool !== 'organize' && tool !== 'compress' && (
        <Options
          tool={tool}
          t={t}
          options={options}
          pages={first.pages}
          inputCount={inputs.length}
          isBatch={isBatch}
          sourceName={first.name}
          sourceId={first.id}
          splitBookmarks={p.splitBookmarks}
          onOpenSplitInEditor={p.onOpenSplitInEditor}
          backgroundPages={p.background?.pages ?? 0}
          onChange={p.onOptions}
        />
      )}

      {tool !== 'organize' && (
        <div className="pt-actions pt-run-row">
          {(tool === 'pdfToImages' || tool === 'convertFromPdf') && first && (
            <button
              type="button"
              className="pt-btn"
              disabled={p.busy}
              onClick={() => p.onOpenInEditorWithInput(first.id)}
            >
              {t('openThisInEditor')}
            </button>
          )}
          <button
            type="button"
            className="pt-btn pt-btn-primary"
            disabled={!ready || p.busy}
            onClick={() => p.onRun()}
          >
            {p.busy ? t('running') : t('run')}
          </button>
        </div>
      )}

      {p.busy && (p.progress || runsAsJob(tool)) && (
        <div className="pt-actions" role="status">
          {p.progress && (
            <span className="pt-hint">
              {p.progress.fileTotal && p.progress.fileTotal > 1 && p.progress.currentName
                ? t('batchProgress', {
                    fileDone: (p.progress.fileDone ?? 0) + 1,
                    fileTotal: p.progress.fileTotal,
                    name: p.progress.currentName,
                    done: p.progress.done,
                    total: p.progress.total,
                  })
                : t('workingProgress', { done: p.progress.done, total: p.progress.total })}
            </span>
          )}
          <button type="button" className="pt-btn" onClick={p.onCancelRun}>
            {t('cancelRun')}
          </button>
        </div>
      )}

      {p.outcome?.kind === 'error' && (
        <p className="pt-note pt-note-error" role="alert">
          {p.outcome.message}
        </p>
      )}

      {p.outcome?.kind === 'canceled' && (
        <p className="pt-note pt-note-warn" role="status">
          {t('canceledSavedCount', { n: p.outcome.savedCount })}
        </p>
      )}

      {done && done.batch && (
        <>
          {done.notice === 'unlocked-unencrypted' && (
            <p className="pt-note pt-note-warn">{t('noticeUnlockedUnencrypted')}</p>
          )}
          <BatchSummary
            lang={p.lang}
            t={t}
            items={done.batch}
            errorText={ERROR_TEXT}
            firstOutputId={firstOutput?.id}
            onReveal={p.onReveal}
          />
        </>
      )}

      {done && !done.batch && firstOutput && (
        <div className="pt-note pt-note-done" role="status">
          <div className="pt-done-text">
            <span>
              {done.ocrSummary
                ? t('doneOcr', {
                    name: firstOutput.name,
                    ocred: done.ocrSummary.ocredPages,
                    skipped: done.ocrSummary.skippedPages,
                  })
                : done.outputs.length === 1
                  ? tool === 'compress' && first
                    ? t('doneCompressed', {
                        name: firstOutput.name,
                        before: formatBytes(first.size, p.lang),
                        after: formatBytes(firstOutput.size, p.lang),
                      })
                    : t('doneOne', { name: firstOutput.name })
                  : t('doneMany', { n: done.outputs.length })}
              {done.oversizedPages?.length
                ? ` ${t('splitOversizedWarn', { pages: formatPartPages(done.oversizedPages) })}`
                : ''}
            </span>
            {done.notice === 'unlocked-unencrypted' && (
              <span className="pt-done-sub">{t('noticeUnlockedUnencrypted')}</span>
            )}
          </div>
          <span className="pt-done-actions">
            {done.outputs.length === 1 && !firstOutput.name.toLowerCase().endsWith('.zip') && (
              <button type="button" className="pt-btn" onClick={() => p.onOpen(firstOutput.id)}>
                {t('openResult')}
              </button>
            )}
            <button type="button" className="pt-btn" onClick={() => p.onReveal(firstOutput.id)}>
              {t('reveal')}
            </button>
            {canChain && (
              <select
                className="pt-input pt-chain-select"
                aria-label={t('continueWith')}
                value={chainChoice}
                onChange={(e) => {
                  const next = e.target.value as PdfToolId | ''
                  setChainChoice('')
                  if (next) p.onPromoteResult(firstOutput.id, next)
                }}
              >
                <option value="">{t('continueWith')} ▾</option>
                {orderedChainTargets.map((nextId) => (
                  <option key={nextId} value={nextId}>
                    {t(TOOL_TEXT[nextId][0])}
                  </option>
                ))}
              </select>
            )}
          </span>
        </div>
      )}
    </section>
  )
}

interface OptionsProps {
  tool: PdfToolId
  t: (key: PdfToolsStringKey, params?: Params) => string
  options: PdfToolOptions
  pages: number
  inputCount: number
  isBatch: boolean
  sourceName: string
  sourceId: string
  splitBookmarks: { loading: boolean; items: PdfBookmarkItem[] }
  onOpenSplitInEditor(inputId: string): void
  /** overlay: pages of the picked background, 0 before one is picked */
  backgroundPages: number
  onChange(patch: PdfToolOptions): void
}

function SplitOptions({
  t,
  options,
  pages,
  sourceName,
  sourceId,
  splitBookmarks,
  onOpenSplitInEditor,
  onChange,
}: Omit<OptionsProps, 'tool' | 'backgroundPages' | 'inputCount' | 'isBatch'>) {
  const [sizeUnit, setSizeUnit] = useState<SplitSizeUnit>('MB')
  const [showFiles, setShowFiles] = useState(false)
  const [patternTouched, setPatternTouched] = useState(false)

  const mode = options.splitMode ?? 'ranges'
  const fixedKind = options.splitFixedKind ?? 'pagesPerFile'
  const fixedValue = options.splitFixedValue ?? options.chunkSize ?? 1
  const bookmarkLevel = options.splitBookmarkLevel ?? 1
  const includeLeading = options.splitIncludeLeading !== false
  const maxBytes = options.splitMaxBytes ?? 10 * 1024 * 1024
  const sizeInput =
    sizeUnit === 'MB'
      ? Math.round((maxBytes / (1024 * 1024)) * 100) / 100
      : Math.round((maxBytes / 1024) * 100) / 100
  const pattern = options.splitPattern ?? 'numbered'
  const prefix = options.splitPrefix ?? sourceName.replace(/\.pdf$/i, '')
  const createSubfolder = options.splitCreateSubfolder !== false

  const plan = useMemo<SplitPlanRequest>(() => {
    if (mode === 'ranges') {
      const parsed = parseSplitRangeList(options.splitRanges ?? '', pages)
      return {
        mode: 'ranges',
        ranges: parsed.ok ? parsed.ranges : [],
        mergeRanges: options.splitMergeRanges === true,
      }
    }
    if (mode === 'fixed') {
      return { mode: 'fixed', kind: fixedKind, value: fixedValue }
    }
    if (mode === 'bookmarks') {
      return {
        mode: 'bookmarks',
        level: bookmarkLevel,
        includeLeadingPages: includeLeading,
        bookmarks: splitBookmarks.items,
      }
    }
    return { mode: 'maxSize', maxBytes }
  }, [
    mode,
    options.splitRanges,
    options.splitMergeRanges,
    pages,
    fixedKind,
    fixedValue,
    bookmarkLevel,
    includeLeading,
    splitBookmarks.items,
    maxBytes,
  ])

  const planned = useMemo(
    () => planSplitParts(plan, pages, splitBookmarks.items),
    [plan, pages, splitBookmarks.items],
  )
  const previewNames = useMemo(
    () =>
      planned.ok && !planned.dynamic
        ? formatSplitOutputNames(planned.parts, sourceName, { prefix, pattern })
        : [],
    [planned, sourceName, prefix, pattern],
  )
  const multiOutput = planned.ok && (planned.dynamic || planned.parts.length >= 2)
  const subfolder = splitSubfolderName(sourceName, prefix)

  const switchMode = (next: 'ranges' | 'fixed' | 'bookmarks' | 'maxSize') => {
    onChange({
      splitMode: next,
      ...(!patternTouched ? { splitPattern: next === 'bookmarks' ? 'bookmark' : 'numbered' } : {}),
    })
  }

  return (
    <div className="pt-fields">
      <div className="pt-split-tabs" role="tablist">
        {(
          [
            ['ranges', 'splitModeRanges'],
            ['fixed', 'splitModeFixed'],
            ['bookmarks', 'splitModeBookmarks'],
            ['maxSize', 'splitModeMaxSize'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`pt-split-tab${mode === id ? ' active' : ''}`}
            onClick={() => switchMode(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {mode === 'ranges' && (
        <>
          <label className="pt-field">
            <span className="pt-field-label">{t('splitRangesLabel')}</span>
            <input
              type="text"
              className="pt-input"
              value={options.splitRanges ?? ''}
              placeholder={
                pages >= 2
                  ? `1-${Math.floor(pages / 2)}, ${Math.floor(pages / 2) + 1}-${pages}`
                  : '1'
              }
              onChange={(e) => onChange({ splitRanges: e.target.value })}
            />
          </label>
          <label className="pt-check">
            <input
              type="checkbox"
              checked={options.splitMergeRanges === true}
              onChange={(e) => onChange({ splitMergeRanges: e.target.checked })}
            />
            {t('splitMergeRanges')}
          </label>
        </>
      )}

      {mode === 'fixed' && (
        <>
          <fieldset className="pt-field pt-choices">
            <Choice
              name="splitFixedKind"
              checked={fixedKind === 'pagesPerFile'}
              label={t('splitFixedEvery')}
              onPick={() => onChange({ splitFixedKind: 'pagesPerFile' })}
            />
            <Choice
              name="splitFixedKind"
              checked={fixedKind === 'fileCount'}
              label={t('splitFixedCount')}
              onPick={() => onChange({ splitFixedKind: 'fileCount' })}
            />
          </fieldset>
          <label className="pt-field">
            <span className="pt-field-label">
              {fixedKind === 'pagesPerFile' ? t('optChunk') : t('splitFixedFilesLabel')}
            </span>
            <input
              type="number"
              className="pt-input pt-input-short"
              min={1}
              max={pages}
              value={fixedValue}
              onChange={(e) =>
                onChange({
                  splitFixedValue: Math.max(
                    1,
                    Math.min(pages, Math.floor(Number(e.target.value) || 1)),
                  ),
                })
              }
            />
          </label>
          <div className="pt-split-presets">
            {(fixedKind === 'pagesPerFile' ? [1, 2, 5, 10] : [2, 3, 4, 5])
              .filter((n) => n <= pages)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pt-split-chip${fixedValue === n ? ' active' : ''}`}
                  onClick={() => onChange({ splitFixedValue: n })}
                >
                  {fixedKind === 'pagesPerFile'
                    ? n === 1
                      ? t('splitPresetAll')
                      : t('splitPresetEvery', { n })
                    : `${n}`}
                </button>
              ))}
          </div>
        </>
      )}

      {mode === 'bookmarks' && (
        <>
          {splitBookmarks.loading ? (
            <p className="pt-hint">{t('splitLoadingBookmarks')}</p>
          ) : splitBookmarks.items.length === 0 ? (
            <p className="pt-hint">{t('splitNoBookmarks')}</p>
          ) : (
            <>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('splitBookmarkLevel')}</legend>
                <Choice
                  name="splitBookmarkLevel"
                  checked={bookmarkLevel === 1}
                  label={t('splitBookmarkLevel1')}
                  onPick={() => onChange({ splitBookmarkLevel: 1 })}
                />
                <Choice
                  name="splitBookmarkLevel"
                  checked={bookmarkLevel === 2}
                  label={t('splitBookmarkLevel2')}
                  onPick={() => onChange({ splitBookmarkLevel: 2 })}
                />
              </fieldset>
              <label className="pt-check">
                <input
                  type="checkbox"
                  checked={includeLeading}
                  onChange={(e) => onChange({ splitIncludeLeading: e.target.checked })}
                />
                {t('splitIncludeLeading')}
              </label>
            </>
          )}
        </>
      )}

      {mode === 'maxSize' && (
        <>
          <div className="pt-field">
            <span className="pt-field-label">{t('splitMaxSizeLabel')}</span>
            <div className="pt-split-size-row">
              <input
                type="number"
                className="pt-input pt-input-short"
                min={1}
                step="any"
                value={sizeInput}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0)
                  onChange({
                    splitMaxBytes: Math.round(val * (sizeUnit === 'MB' ? 1024 * 1024 : 1024)),
                  })
                }}
              />
              <select
                className="pt-input pt-split-unit"
                value={sizeUnit}
                onChange={(e) => {
                  const nextUnit: SplitSizeUnit = e.target.value === 'KB' ? 'KB' : 'MB'
                  setSizeUnit(nextUnit)
                  onChange({
                    splitMaxBytes: Math.round(sizeInput * (nextUnit === 'MB' ? 1024 * 1024 : 1024)),
                  })
                }}
              >
                <option value="MB">MB</option>
                <option value="KB">KB</option>
              </select>
            </div>
          </div>
          <div className="pt-split-presets">
            {[5, 10, 20, 50].map((mb) => (
              <button
                key={mb}
                type="button"
                className={`pt-split-chip${maxBytes === mb * 1024 * 1024 ? ' active' : ''}`}
                onClick={() => {
                  setSizeUnit('MB')
                  onChange({ splitMaxBytes: mb * 1024 * 1024 })
                }}
              >
                {mb} MB
              </button>
            ))}
          </div>
          <p className="pt-hint">{t('splitMaxSizeNote')}</p>
        </>
      )}

      {/* Live output preview */}
      <div className="pt-split-preview">
        <div className="pt-split-preview-head">
          <span className="pt-split-preview-count">
            {!planned.ok
              ? mode === 'bookmarks'
                ? t('splitNoBookmarks')
                : mode === 'maxSize'
                  ? t('errInvalidSize')
                  : t('errRange')
              : planned.dynamic
                ? t('splitPreviewDynamic')
                : planned.parts.length === 1
                  ? t('splitPreviewOne')
                  : t('splitPreviewCount', { n: planned.parts.length })}
          </span>
          {planned.ok && !planned.dynamic && previewNames.length > 0 && (
            <button type="button" className="pt-split-link" onClick={() => setShowFiles((v) => !v)}>
              {showFiles ? t('splitHideFiles') : t('splitShowFiles')}
            </button>
          )}
        </div>
        {showFiles && planned.ok && !planned.dynamic && (
          <ul className="pt-split-files">
            {planned.parts.map((part, idx) => (
              <li key={idx} className="pt-split-file">
                <span className="pt-split-file-name" title={previewNames[idx]}>
                  {previewNames[idx]}
                </span>
                <span className="pt-split-file-pages">{formatPartPages(part.pages)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Output naming & subfolder */}
      <div className="pt-split-output-row">
        <label className="pt-field">
          <span className="pt-field-label">{t('splitPrefix')}</span>
          <input
            type="text"
            className="pt-input"
            value={prefix}
            onChange={(e) => onChange({ splitPrefix: e.target.value })}
          />
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{t('splitPattern')}</span>
          <select
            className="pt-input"
            value={pattern}
            onChange={(e) => {
              setPatternTouched(true)
              onChange({ splitPattern: e.target.value as SplitNamingPattern })
            }}
          >
            <option value="numbered">{t('splitPatternNumbered')}</option>
            <option value="range">{t('splitPatternRange')}</option>
            {mode === 'bookmarks' && <option value="bookmark">{t('splitPatternBookmark')}</option>}
          </select>
        </label>
      </div>

      {multiOutput && (
        <label className="pt-check">
          <input
            type="checkbox"
            checked={createSubfolder}
            onChange={(e) => onChange({ splitCreateSubfolder: e.target.checked })}
          />
          {t('splitSubfolder', { folder: subfolder })}
        </label>
      )}

      {pages > 1 && (
        <div>
          <button type="button" className="pt-btn" onClick={() => onOpenSplitInEditor(sourceId)}>
            {t('splitVisualInEditor')}
          </button>
        </div>
      )}
    </div>
  )
}

function Options({
  tool,
  t,
  options,
  pages,
  inputCount,
  isBatch,
  sourceName,
  sourceId,
  splitBookmarks,
  onOpenSplitInEditor,
  backgroundPages,
  onChange,
}: OptionsProps) {
  switch (tool) {
    case 'split':
      return (
        <SplitOptions
          t={t}
          options={options}
          pages={pages}
          sourceName={sourceName}
          sourceId={sourceId}
          splitBookmarks={splitBookmarks}
          onOpenSplitInEditor={onOpenSplitInEditor}
          onChange={onChange}
        />
      )
    case 'merge':
      return (
        <div className="pt-fields">
          <label className="pt-check">
            <input
              type="checkbox"
              checked={options.addBookmarks !== false}
              onChange={(e) => onChange({ addBookmarks: e.target.checked })}
            />
            {t('optAddBookmarks')}
          </label>
          <label className="pt-field">
            <span className="pt-field-label">{t('optUnifyPaper')}</span>
            <select
              className="pt-input pt-input-short"
              value={options.unifyPaper ?? 'keep'}
              onChange={(e) => onChange({ unifyPaper: e.target.value as 'keep' | PdfToolPaper })}
            >
              <option value="keep">{t('optKeepPaper')}</option>
              {PDF_TOOL_PAPERS.map((paper) => (
                <option key={paper} value={paper}>
                  {paper}
                </option>
              ))}
            </select>
          </label>
        </div>
      )
    case 'interleave':
      return (
        <label className="pt-check">
          <input
            type="checkbox"
            checked={options.reverseEven !== false}
            onChange={(e) => onChange({ reverseEven: e.target.checked })}
          />
          {t('optReverseEven')}
        </label>
      )
    case 'ocr':
      return (
        <div className="pt-fields">
          {!isBatch && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optApplyPages')}</span>
              <input
                type="text"
                className="pt-input"
                value={options.applyPages ?? ''}
                placeholder={`1-${pages}`}
                onChange={(e) => onChange({ applyPages: e.target.value })}
              />
            </label>
          )}
          <label className="pt-check">
            <input
              type="checkbox"
              checked={options.reocrExisting === true}
              onChange={(e) => onChange({ reocrExisting: e.target.checked })}
            />
            {t('optReocrExisting')}
          </label>
        </div>
      )
    case 'docsToPdf':
      return (
        <div className="pt-fields">
          {inputCount >= 2 && (
            <>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optDocsOutputMode')}</legend>
                <Choice
                  name="docsOutputMode"
                  checked={options.docsOutputMode !== 'merge'}
                  label={t('optDocsEach')}
                  onPick={() => onChange({ docsOutputMode: 'each' })}
                />
                <Choice
                  name="docsOutputMode"
                  checked={options.docsOutputMode === 'merge'}
                  label={t('optDocsMerge')}
                  onPick={() => onChange({ docsOutputMode: 'merge' })}
                />
              </fieldset>
              {options.docsOutputMode === 'merge' && (
                <label className="pt-check">
                  <input
                    type="checkbox"
                    checked={options.addBookmarks !== false}
                    onChange={(e) => onChange({ addBookmarks: e.target.checked })}
                  />
                  {t('optAddBookmarks')}
                </label>
              )}
            </>
          )}
          <p className="pt-hint">{t('noteDocsHtmlImages')}</p>
        </div>
      )
    case 'pdfToImages': {
      const mode = options.pdfToImagesMode ?? 'pages'
      const format = options.imageFormat ?? 'jpg'
      return (
        <div className="pt-fields">
          <fieldset className="pt-field pt-choices">
            <legend className="pt-field-label">{t('optPdfToImgMode')}</legend>
            <Choice
              name="pdfToImagesMode"
              checked={mode !== 'embedded'}
              label={t('optModePages')}
              onPick={() => onChange({ pdfToImagesMode: 'pages' })}
            />
            <Choice
              name="pdfToImagesMode"
              checked={mode === 'embedded'}
              label={t('optModeEmbedded')}
              onPick={() => onChange({ pdfToImagesMode: 'embedded' })}
            />
          </fieldset>
          {mode === 'pages' && (
            <>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optImageFormat')}</legend>
                <Choice
                  name="imageFormat"
                  checked={format === 'jpg'}
                  label="JPG"
                  onPick={() => onChange({ imageFormat: 'jpg' })}
                />
                <Choice
                  name="imageFormat"
                  checked={format === 'png'}
                  label="PNG"
                  onPick={() => onChange({ imageFormat: 'png' })}
                />
              </fieldset>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optImageDpi')}</legend>
                {([150, 200, 300] as const).map((dpi) => (
                  <Choice
                    key={dpi}
                    name="imageDpi"
                    checked={(options.imageDpi ?? 200) === dpi}
                    label={`${dpi} DPI`}
                    onPick={() => onChange({ imageDpi: dpi })}
                  />
                ))}
              </fieldset>
              {format === 'jpg' && (
                <fieldset className="pt-field pt-choices">
                  <legend className="pt-field-label">{t('optImageQuality')}</legend>
                  <Choice
                    name="imageQuality"
                    checked={options.imageQuality === 'high'}
                    label={t('optQualHigh')}
                    onPick={() => onChange({ imageQuality: 'high' })}
                  />
                  <Choice
                    name="imageQuality"
                    checked={(options.imageQuality ?? 'medium') === 'medium'}
                    label={t('optQualMedium')}
                    onPick={() => onChange({ imageQuality: 'medium' })}
                  />
                  <Choice
                    name="imageQuality"
                    checked={options.imageQuality === 'small'}
                    label={t('optQualSmall')}
                    onPick={() => onChange({ imageQuality: 'small' })}
                  />
                </fieldset>
              )}
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optImageOutMode')}</legend>
                <Choice
                  name="imageOutMode"
                  checked={options.imageOutMode !== 'folder'}
                  label={t('optOutZip')}
                  onPick={() => onChange({ imageOutMode: 'zip' })}
                />
                <Choice
                  name="imageOutMode"
                  checked={options.imageOutMode === 'folder'}
                  label={t('optOutFolder')}
                  onPick={() => onChange({ imageOutMode: 'folder' })}
                />
              </fieldset>
            </>
          )}
          {!isBatch && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optApplyPages')}</span>
              <input
                type="text"
                className="pt-input"
                value={options.applyPages ?? ''}
                placeholder={`1-${pages}`}
                onChange={(e) => onChange({ applyPages: e.target.value })}
              />
            </label>
          )}
        </div>
      )
    }
    case 'convertFromPdf': {
      const fmt = options.targetFormat ?? 'docx'
      return (
        <div className="pt-fields">
          <label className="pt-field">
            <span className="pt-field-label">{t('optConvertFormat')}</span>
            <select
              className="pt-input pt-input-med"
              value={fmt}
              onChange={(e) => onChange({ targetFormat: e.target.value as PdfConvertFormat })}
            >
              {CONVERT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {!isBatch && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optApplyPages')}</span>
              <input
                type="text"
                className="pt-input"
                value={options.applyPages ?? ''}
                placeholder={`1-${pages}`}
                onChange={(e) => onChange({ applyPages: e.target.value })}
              />
            </label>
          )}
          {fmt === 'epub' && (
            <>
              <label className="pt-field">
                <span className="pt-field-label">{t('optEpubTitle')}</span>
                <input
                  type="text"
                  className="pt-input"
                  value={options.epubTitle ?? ''}
                  onChange={(e) => onChange({ epubTitle: e.target.value })}
                />
              </label>
              <label className="pt-field">
                <span className="pt-field-label">{t('optEpubAuthor')}</span>
                <input
                  type="text"
                  className="pt-input"
                  value={options.epubAuthor ?? ''}
                  onChange={(e) => onChange({ epubAuthor: e.target.value })}
                />
              </label>
              <label className="pt-check">
                <input
                  type="checkbox"
                  checked={options.epubCover !== false}
                  onChange={(e) => onChange({ epubCover: e.target.checked })}
                />
                {t('optEpubCover')}
              </label>
              <label className="pt-check">
                <input
                  type="checkbox"
                  checked={options.epubPageBreaks === true}
                  onChange={(e) => onChange({ epubPageBreaks: e.target.checked })}
                />
                {t('optEpubPageBreaks')}
              </label>
            </>
          )}
        </div>
      )
    }
    case 'extract':
      return (
        <label className="pt-field">
          <span className="pt-field-label">{t('optRange')}</span>
          <input
            type="text"
            className="pt-input"
            value={options.pages ?? ''}
            placeholder={`1-${pages}`}
            onChange={(e) => onChange({ pages: e.target.value })}
          />
        </label>
      )
    case 'nup':
      return (
        <div className="pt-fields">
          <label className="pt-field">
            <span className="pt-field-label">{t('optPerSheet')}</span>
            <select
              className="pt-input pt-input-short"
              value={options.perSheet ?? 2}
              onChange={(e) => onChange({ perSheet: Number(e.target.value) })}
            >
              {PER_SHEET.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="pt-field pt-choices">
            <legend className="pt-field-label">{t('optDirection')}</legend>
            <Choice
              name="direction"
              checked={options.direction !== 'vertical'}
              label={t('optHorizontal')}
              onPick={() => onChange({ direction: 'horizontal' })}
            />
            <Choice
              name="direction"
              checked={options.direction === 'vertical'}
              label={t('optVertical')}
              onPick={() => onChange({ direction: 'vertical' })}
            />
          </fieldset>
          <label className="pt-check">
            <input
              type="checkbox"
              checked={options.separator === true}
              onChange={(e) => onChange({ separator: e.target.checked })}
            />
            {t('optSeparator')}
          </label>
        </div>
      )
    case 'rotate':
      return (
        <fieldset className="pt-field pt-choices">
          <legend className="pt-field-label">{t('optRotation')}</legend>
          <Choice
            name="rotation"
            checked={options.rotation === 90}
            label={t('optRotateRight')}
            onPick={() => onChange({ rotation: 90 })}
          />
          <Choice
            name="rotation"
            checked={options.rotation === 270}
            label={t('optRotateLeft')}
            onPick={() => onChange({ rotation: 270 })}
          />
          <Choice
            name="rotation"
            checked={options.rotation === 180}
            label={t('opt180')}
            onPick={() => onChange({ rotation: 180 })}
          />
        </fieldset>
      )
    case 'pageSize':
      return (
        <label className="pt-field">
          <span className="pt-field-label">{t('optPaper')}</span>
          <select
            className="pt-input pt-input-short"
            value={options.paper ?? 'A4'}
            onChange={(e) => onChange({ paper: e.target.value as PdfToolPaper })}
          >
            {PDF_TOOL_PAPERS.map((paper) => (
              <option key={paper} value={paper}>
                {paper}
              </option>
            ))}
          </select>
        </label>
      )
    case 'splitPages':
      return (
        <fieldset className="pt-field pt-choices">
          <legend className="pt-field-label">{t('optPerPage')}</legend>
          {([2, 4, 9] as const).map((n) => (
            <Choice
              key={n}
              name="perPage"
              checked={(options.perPage ?? 2) === n}
              label={String(n)}
              onPick={() => onChange({ perPage: n })}
            />
          ))}
        </fieldset>
      )
    case 'imagesToPdf': {
      const paper = options.imagePaper ?? 'A4'
      return (
        <div className="pt-fields">
          <label className="pt-field">
            <span className="pt-field-label">{t('optPaper')}</span>
            <select
              className="pt-input pt-input-short"
              value={paper}
              onChange={(e) => onChange({ imagePaper: e.target.value as PdfToolPaper | 'image' })}
            >
              {PDF_TOOL_PAPERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="image">{t('optImageSize')}</option>
            </select>
          </label>
          {paper !== 'image' && (
            <>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optOrientation')}</legend>
                {(
                  [
                    ['auto', 'optOrientAuto'],
                    ['portrait', 'optOrientPortrait'],
                    ['landscape', 'optOrientLandscape'],
                  ] as const
                ).map(([id, label]) => (
                  <Choice
                    key={id}
                    name="imageOrientation"
                    checked={(options.imageOrientation ?? 'auto') === id}
                    label={t(label)}
                    onPick={() => onChange({ imageOrientation: id as PdfImageOrientation })}
                  />
                ))}
              </fieldset>
              <fieldset className="pt-field pt-choices">
                <legend className="pt-field-label">{t('optMargin')}</legend>
                {PDF_TOOL_MARGINS.map((margin) => (
                  <Choice
                    key={margin}
                    name="margin"
                    checked={(options.margin ?? 'small') === margin}
                    label={t(MARGIN_TEXT[margin])}
                    onPick={() => onChange({ margin })}
                  />
                ))}
              </fieldset>
            </>
          )}
          <fieldset className="pt-field pt-choices">
            <legend className="pt-field-label">{t('optImageOptimize')}</legend>
            {(
              [
                ['original', 'optImgOrig'],
                ['balanced', 'optImgBalanced'],
                ['compact', 'optImgCompact'],
              ] as const
            ).map(([id, label]) => (
              <Choice
                key={id}
                name="imageOptimize"
                checked={(options.imageOptimize ?? 'original') === id}
                label={t(label)}
                onPick={() => onChange({ imageOptimize: id as PdfImageOptimize })}
              />
            ))}
          </fieldset>
        </div>
      )
    }
    case 'stripAnnots': {
      const chosen = options.annotKinds ?? []
      const toggle = (kind: PdfToolAnnotKind, on: boolean) =>
        onChange({
          annotKinds: PDF_TOOL_ANNOT_KINDS.filter((k) => (k === kind ? on : chosen.includes(k))),
        })
      return (
        <div className="pt-fields">
          <fieldset className="pt-field pt-choices">
            <legend className="pt-field-label">{t('optAnnotKinds')}</legend>
            {PDF_TOOL_ANNOT_KINDS.map((kind) => (
              <label className="pt-check" key={kind}>
                <input
                  type="checkbox"
                  checked={chosen.includes(kind)}
                  onChange={(e) => toggle(kind, e.target.checked)}
                />
                {t(ANNOT_KIND_TEXT[kind])}
              </label>
            ))}
          </fieldset>
          {!isBatch && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optCleanPages')}</span>
              <input
                type="text"
                className="pt-input"
                value={options.applyPages ?? ''}
                placeholder={`1-${pages}`}
                onChange={(e) => onChange({ applyPages: e.target.value })}
              />
            </label>
          )}
          <p className="pt-hint">{t('noteStripAnnots')}</p>
        </div>
      )
    }
    case 'overlay':
      return (
        <div className="pt-fields">
          <fieldset className="pt-field pt-choices">
            <legend className="pt-field-label">{t('optLayer')}</legend>
            <Choice
              name="layer"
              checked={options.layer !== 'front'}
              label={t('optBehind')}
              onPick={() => onChange({ layer: 'behind' })}
            />
            <Choice
              name="layer"
              checked={options.layer === 'front'}
              label={t('optFront')}
              onPick={() => onChange({ layer: 'front' })}
            />
          </fieldset>
          {backgroundPages > 1 && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optBackgroundPage')}</span>
              <input
                type="number"
                className="pt-input pt-input-short"
                min={1}
                max={backgroundPages}
                value={options.backgroundPage ?? 1}
                onChange={(e) =>
                  onChange({
                    backgroundPage: Math.min(
                      backgroundPages,
                      Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    ),
                  })
                }
              />
            </label>
          )}
          {!isBatch && (
            <label className="pt-field">
              <span className="pt-field-label">{t('optApplyPages')}</span>
              <input
                type="text"
                className="pt-input"
                value={options.applyPages ?? ''}
                placeholder={`1-${pages}`}
                onChange={(e) => onChange({ applyPages: e.target.value })}
              />
            </label>
          )}
          <p className="pt-hint">{t('noteOverlay')}</p>
        </div>
      )
    case 'duplex':
      return (
        <div className="pt-fields">
          <label className="pt-field">
            <span className="pt-field-label">{t('optSheetPages')}</span>
            <select
              className="pt-input pt-input-short"
              value={options.sheetPages ?? 1}
              onChange={(e) => onChange({ sheetPages: Number(e.target.value) })}
            >
              {PDF_TOOL_SHEET_PAGES.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? t('optNoNup') : n}
                </option>
              ))}
            </select>
          </label>
          <p className="pt-hint">{t('noteDuplex')}</p>
        </div>
      )
    case 'toText':
      return <p className="pt-hint">{t('noteToText')}</p>
    case 'encrypt':
      return <EncryptOptions t={t} options={options} onChange={onChange} />
    case 'decrypt':
      return (
        <div className="pt-fields">
          <label className="pt-field">
            <span className="pt-field-label">{t('optCurrentPassword')}</span>
            <input
              type="password"
              className="pt-input"
              autoComplete="off"
              spellCheck={false}
              value={options.password ?? ''}
              onChange={(e) => onChange({ password: e.target.value })}
            />
          </label>
          <p className="pt-hint">{t('noteDecrypt')}</p>
        </div>
      )
    case 'repair':
      return <p className="pt-hint">{t('noteRepair')}</p>
    default:
      return null
  }
}

/** encrypt: both passwords typed, the same twice, and the permission one different */
function encryptReady(o: PdfToolOptions): boolean {
  const password = o.password ?? ''
  if (!password || password !== o.passwordConfirm || passwordTooLong(password)) return false
  if (!o.restrict) return true
  const permission = o.permissionPassword ?? ''
  return !!permission && permission !== password && !passwordTooLong(permission)
}

function EncryptOptions({
  t,
  options,
  onChange,
}: Pick<OptionsProps, 't' | 'options' | 'onChange'>) {
  const password = options.password ?? ''
  const confirm = options.passwordConfirm ?? ''
  const permission = options.restrict ? (options.permissionPassword ?? '') : ''
  const problem: PdfToolsStringKey | null =
    passwordTooLong(password) || passwordTooLong(permission)
      ? 'errPasswordLong'
      : confirm && confirm !== password
        ? 'passwordMismatch'
        : permission && permission === password
          ? 'errPasswordSame'
          : null
  const field = (label: PdfToolsStringKey, value: string, patch: (v: string) => PdfToolOptions) => (
    <label className="pt-field">
      <span className="pt-field-label">{t(label)}</span>
      <input
        type="password"
        className="pt-input"
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(patch(e.target.value))}
      />
    </label>
  )
  return (
    <div className="pt-fields">
      {field('optPassword', password, (v) => ({ password: v }))}
      {field('optPasswordConfirm', confirm, (v) => ({ passwordConfirm: v }))}
      <label className="pt-check">
        <input
          type="checkbox"
          checked={options.restrict === true}
          onChange={(e) => onChange({ restrict: e.target.checked })}
        />
        {t('optRestrict')}
      </label>
      {options.restrict && (
        <>
          {field('optPermissionPassword', permission, (v) => ({ permissionPassword: v }))}
          <p className="pt-hint">{t('noteRestrict')}</p>
        </>
      )}
      {problem && (
        <p className="pt-note pt-note-error" role="alert">
          {t(problem)}
        </p>
      )}
      <p className="pt-hint">{t('noteEncrypt')}</p>
    </div>
  )
}

interface BlankPagesReviewProps {
  t: (key: PdfToolsStringKey, params?: Params) => string
  blank: BlankState
  busy: boolean
  onFind(): void
  onCancel(): void
  onChoose(pages: number[]): void
}

function BlankPagesReview({ t, blank, busy, onFind, onCancel, onChoose }: BlankPagesReviewProps) {
  const { finding, found, chosen } = blank
  if (finding) {
    return (
      <div className="pt-actions pt-actions-start" role="status">
        <span className="pt-hint">
          {t('findingBlank', { done: finding.done, total: finding.total })}
        </span>
        <button type="button" className="pt-btn" onClick={onCancel}>
          {t('cancelFind')}
        </button>
      </div>
    )
  }
  if (!found) {
    return (
      <>
        <p className="pt-hint">{t('noteBlank')}</p>
        <div className="pt-actions pt-actions-start">
          <button type="button" className="pt-btn" onClick={onFind} disabled={busy}>
            {t('findBlank')}
          </button>
        </div>
      </>
    )
  }
  if (found.candidates.length === 0) {
    return (
      <p className="pt-note" role="status">
        {t('blankNone')}
      </p>
    )
  }
  const picked = new Set(chosen)
  const toggle = (page: number, on: boolean) =>
    onChoose(found.candidates.map((c) => c.page).filter((p) => (p === page ? on : picked.has(p))))
  return (
    <>
      <div className="pt-actions pt-actions-start">
        <span className="pt-hint">{t('blankFound', { n: found.candidates.length })}</span>
        <button
          type="button"
          className="pt-btn"
          onClick={() => onChoose(found.candidates.map((c) => c.page))}
        >
          {t('selectAll')}
        </button>
        <button type="button" className="pt-btn" onClick={() => onChoose([])}>
          {t('selectNone')}
        </button>
      </div>
      <ul className="pt-blank-grid">
        {found.candidates.map((c) => (
          <li key={c.page}>
            <label className="pt-blank">
              {c.thumb ? (
                <img className="pt-blank-thumb" src={c.thumb} alt="" />
              ) : (
                <span className="pt-blank-thumb pt-blank-nothumb" />
              )}
              <span className="pt-blank-text">
                <input
                  type="checkbox"
                  checked={picked.has(c.page)}
                  onChange={(e) => toggle(c.page, e.target.checked)}
                />
                {t('blankPageLabel', { n: c.page })}
              </span>
              <span className="pt-blank-reason">
                {t(c.reason === 'empty' ? 'blankEmpty' : 'blankNearlyWhite')}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

function Choice(props: { name: string; checked: boolean; label: string; onPick(): void }) {
  return (
    <label className="pt-choice">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onPick} />
      {props.label}
    </label>
  )
}
