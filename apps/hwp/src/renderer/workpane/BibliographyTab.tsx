/**
 * Bibliography and citation management tab for the HWP left workpane.
 *
 * Provides document-level citation style switching (APA 7, Chicago, MLA 9, IEEE),
 * single/multi-entry in-text citation insertion with parenthetical/narrative modes
 * and page locators, managed bibliography insertion/refresh with legacy-list and
 * manual-edit safeguards, full library CRUD + search + tag filtering, two-step
 * file and document-line import previews (with optional AI assistance strictly on
 * user-checked unparsed lines when AI is enabled), format export, and six-way
 * citation/bibliography auditing with click-to-jump navigation.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { IconClose } from '@genoffice/ui/icons'
import {
  CITATION_STYLES,
  DEFAULT_CITATION_STYLE,
  ENTRY_TYPES,
  formatAuthorDisplay,
  sanitizeCitationKey,
  type BibAuthor,
  type BibEntry,
  type BibEntryInput,
  type BibEntryType,
  type CitationStyle,
  type EntryLanguage,
} from '../../../studio-plugin/citation-styles.mjs'
import {
  BIBLIOGRAPHY_FORMATS,
  parseDocumentReferenceLines,
  planImportPreview,
  type BibliographyFormat,
  type DuplicateMatch,
  type ImportPreviewPlan,
  type UnparsedDocumentReferenceLine,
} from '../../../studio-plugin/citation-io.mjs'
import type {
  AuditIssue,
  AuditIssueKind,
  DetectUnmarkedBibliographyResult,
} from '../../../studio-plugin/citations.mjs'
import type { FindMatch } from '../../../studio-plugin/find.mjs'
import type { BibliographyCommandAction } from '../../../studio-plugin/workpane-menu.mjs'
import type { BibKeyRenameInfo, HwpApi } from '../../shared/ipc'
import type { AgentBridge } from '../ai/agent-bridge'
import { useBiblioI18n, type BiblioStringKey } from '../i18n/biblio'
import './bibliography-tab.css'

export type BibliographyTabBridge = Pick<
  AgentBridge,
  | 'getCitationStyle'
  | 'setCitationStyle'
  | 'listCitationMarks'
  | 'insertCitation'
  | 'switchCitationStyle'
  | 'insertBibliographyBlock'
  | 'refreshBibliographyBlock'
  | 'detectUnmarkedBibliography'
  | 'detectBibliographyManualEdits'
  | 'highlightBibliographyRange'
  | 'rewriteCitationKeys'
  | 'auditCitations'
  | 'revealFindMatch'
  | 'reveal'
>

export type BibliographyLibraryApi = Pick<
  HwpApi,
  | 'bibList'
  | 'bibAdd'
  | 'bibUpdate'
  | 'bibDelete'
  | 'bibVerify'
  | 'bibPickImportFile'
  | 'bibPreviewImport'
  | 'bibCommitImport'
  | 'bibExportFile'
>

export interface BibliographyCommandRequest {
  action: BibliographyCommandAction
  nonce: number
}

export interface BibliographyTabProps {
  bridge: BibliographyTabBridge
  /** App-wide bibliography entries kept in sync by App (falls back to api.bibList when omitted). */
  entries?: readonly BibEntry[]
  /** Optional library IPC API override for tests; defaults to window.hwpApi. */
  api?: BibliographyLibraryApi
  /** Increments whenever the document changes externally (App.tsx docTick). */
  changeTick?: number
  /** Whether the Bibliography tab panel is currently visible on screen. */
  visible?: boolean
  /** Whether AI features are enabled in settings. */
  aiEnabled?: boolean
  /** Callback sending only user-checked unparsed document lines to the AI panel. */
  onRequestAiParseLines?: (lines: readonly string[]) => void
  /** External command dispatched from the editor Tool menu. */
  command?: BibliographyCommandRequest | null
  /** Pending citation-key rename banner when the open document cites `oldKey`. */
  pendingKeyRename?: BibKeyRenameInfo | null
  /** Dismiss the pending key-rename banner. */
  onDismissKeyRename?: () => void
  /** Notify the host that a document mutation occurred. */
  onDocumentChanged?: () => void
}

type SubTab = 'library' | 'audit'
type NoticeTone = 'info' | 'error' | 'warn'

interface BibNotice {
  tone: NoticeTone
  text: string
}

interface EntryFormState {
  editingId: string | null
  type: BibEntryType
  title: string
  authors: string
  year: string
  key: string
  containerTitle: string
  volume: string
  issue: string
  pages: string
  publisher: string
  place: string
  edition: string
  editors: string
  degree: string
  institution: string
  doi: string
  url: string
  accessed: string
  language: 'auto' | EntryLanguage
  tags: string
  memo: string
  showMore: boolean
}

interface ComposerState {
  entryIds: string[]
  mode: 'parenthetical' | 'narrative'
  locators: Record<string, string>
}

interface DeleteConfirmState {
  entry: BibEntry
  citedCount: number
}

type LegacyFoundInfo = Extract<DetectUnmarkedBibliographyResult, { found: true }>

interface ManualOverwriteConfirmState {
  kind: 'style' | 'refresh' | 'insert'
  nextStyle?: CitationStyle
  count: number
}

interface ImportPreviewState {
  source: 'import' | 'document'
  fileName?: string
  plan: ImportPreviewPlan
  unparsed: UnparsedDocumentReferenceLine[]
  checkedUnparsed: Record<number, boolean>
}

const STYLE_LABELS: Record<CitationStyle, string> = {
  apa: 'APA 7',
  chicago: 'Chicago',
  mla: 'MLA 9',
  ieee: 'IEEE',
}

const EXPORT_FORMAT_LABELS: Record<BibliographyFormat, string> = {
  bibtex: 'BibTeX (.bib)',
  ris: 'RIS (.ris)',
  'csl-json': 'CSL JSON (.json)',
}

const ENTRY_TYPE_LABEL_KEYS: Record<BibEntryType, BiblioStringKey> = {
  article: 'typeArticle',
  book: 'typeBook',
  chapter: 'typeChapter',
  thesis: 'typeThesis',
  report: 'typeReport',
  conference: 'typeConference',
  webpage: 'typeWebpage',
  other: 'typeOther',
}

const AUDIT_KIND_LABEL_KEYS: Record<AuditIssueKind, BiblioStringKey> = {
  missing_from_bibliography: 'auditIssueMissingFromBib',
  uncited_in_bibliography: 'auditIssueUncitedInBib',
  wrong_sort_order: 'auditIssueWrongSortOrder',
  missing_disambiguation: 'auditIssueMissingDisambiguation',
  manual_citation_edit: 'auditIssueManualCitationEdit',
  unverified_citation: 'auditIssueUnverifiedCitation',
}

/** Return sorted unique tags across all library entries. */
export function listEntryTags(entries: readonly BibEntry[]): string[] {
  const tags = new Set<string>()
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      const trimmed = tag.trim()
      if (trimmed) tags.add(trimmed)
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}

function emptyFormState(): EntryFormState {
  return {
    editingId: null,
    type: 'article',
    title: '',
    authors: '',
    year: '',
    key: '',
    containerTitle: '',
    volume: '',
    issue: '',
    pages: '',
    publisher: '',
    place: '',
    edition: '',
    editors: '',
    degree: '',
    institution: '',
    doi: '',
    url: '',
    accessed: '',
    language: 'auto',
    tags: '',
    memo: '',
    showMore: false,
  }
}

function formatAuthorsForInput(
  authors: readonly BibAuthor[] | undefined,
  lang: EntryLanguage,
): string {
  if (!authors || authors.length === 0) return ''
  return authors
    .map((author) => formatAuthorDisplay(author, lang))
    .filter((name) => name.length > 0)
    .join('; ')
}

function formStateFromEntry(entry: BibEntry): EntryFormState {
  const hasExtra = Boolean(
    entry.volume ||
    entry.issue ||
    entry.publisher ||
    entry.place ||
    entry.edition ||
    (entry.editors && entry.editors.length > 0) ||
    entry.degree ||
    entry.institution ||
    entry.doi ||
    entry.url ||
    entry.accessed ||
    entry.memo,
  )
  return {
    editingId: entry.id,
    type: entry.type,
    title: entry.title,
    authors: formatAuthorsForInput(entry.authors, entry.language),
    year: entry.year ?? '',
    key: entry.key,
    containerTitle: entry.containerTitle ?? '',
    volume: entry.volume ?? '',
    issue: entry.issue ?? '',
    pages: entry.pages ?? '',
    publisher: entry.publisher ?? '',
    place: entry.place ?? '',
    edition: entry.edition ?? '',
    editors: formatAuthorsForInput(entry.editors, entry.language),
    degree: entry.degree ?? '',
    institution: entry.institution ?? '',
    doi: entry.doi ?? '',
    url: entry.url ?? '',
    accessed: entry.accessed ?? '',
    language: entry.language,
    tags: (entry.tags ?? []).join(', '),
    memo: entry.memo ?? '',
    showMore: hasExtra,
  }
}

function splitAuthorInput(raw: string): string[] {
  return raw
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function splitTagInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function formatEntryAuthorsSummary(entry: BibEntry, fallback: string): string {
  if (!entry.authors || entry.authors.length === 0) return fallback
  const names = entry.authors
    .map((author) => formatAuthorDisplay(author, entry.language))
    .filter((name) => name.length > 0)
  return names.length > 0 ? names.join(', ') : fallback
}

function entryMatchesQuery(entry: BibEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const authors = (entry.authors ?? [])
    .map((author) => formatAuthorDisplay(author, entry.language))
    .join(' ')
  const haystack = [
    entry.title,
    entry.key,
    authors,
    entry.year ?? '',
    entry.containerTitle ?? '',
    entry.publisher ?? '',
    entry.doi ?? '',
    ...(entry.tags ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

function entryHasKey(entry: BibEntry, key: string): boolean {
  return entry.key === key || (entry.oldKeys ?? []).includes(key)
}

function buildInputFromForm(form: EntryFormState): BibEntryInput {
  const authors = splitAuthorInput(form.authors)
  const editors = splitAuthorInput(form.editors)
  const tags = splitTagInput(form.tags)
  const trimmedKey = form.key.trim()
  return {
    type: form.type,
    title: form.title.trim(),
    authors,
    ...(editors.length > 0 ? { editors } : { editors: [] }),
    year: form.year.trim() || undefined,
    ...(trimmedKey ? { key: trimmedKey } : {}),
    containerTitle: form.containerTitle.trim() || undefined,
    volume: form.volume.trim() || undefined,
    issue: form.issue.trim() || undefined,
    pages: form.pages.trim() || undefined,
    publisher: form.publisher.trim() || undefined,
    place: form.place.trim() || undefined,
    edition: form.edition.trim() || undefined,
    degree: form.degree.trim() || undefined,
    institution: form.institution.trim() || undefined,
    doi: form.doi.trim() || undefined,
    url: form.url.trim() || undefined,
    accessed: form.accessed.trim() || undefined,
    ...(form.language !== 'auto' ? { language: form.language } : {}),
    tags,
    memo: form.memo.trim() || undefined,
  }
}

function dupReasonText(match: DuplicateMatch, t: ReturnType<typeof useBiblioI18n>['t']): string {
  return match.matchReason === 'doi' ? t('importDupReasonDoi') : t('importDupReasonTitleYear')
}

export function BibliographyTab({
  bridge,
  entries: entriesProp,
  api: apiProp,
  changeTick = 0,
  visible = true,
  aiEnabled = false,
  onRequestAiParseLines,
  command = null,
  pendingKeyRename = null,
  onDismissKeyRename,
  onDocumentChanged,
}: BibliographyTabProps): ReactElement {
  const { t } = useBiblioI18n()
  const tRef = useRef(t)
  tRef.current = t
  const styleSelectId = useId()
  const api: BibliographyLibraryApi | undefined =
    apiProp ?? (typeof window !== 'undefined' ? window.hwpApi : undefined)

  const [localEntries, setLocalEntries] = useState<BibEntry[]>(() =>
    entriesProp ? [...entriesProp] : [],
  )
  const entries = localEntries

  const [docStyle, setDocStyle] = useState<CitationStyle>(DEFAULT_CITATION_STYLE)
  const [subTab, setSubTab] = useState<SubTab>('library')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<BibNotice | null>(null)

  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [formState, setFormState] = useState<EntryFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)
  const [legacyConfirm, setLegacyConfirm] = useState<LegacyFoundInfo | null>(null)
  const [manualConfirm, setManualConfirm] = useState<ManualOverwriteConfirmState | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreviewState | null>(null)

  const [auditIssues, setAuditIssues] = useState<AuditIssue[] | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)

  const lastCommandNonceRef = useRef<number | null>(null)

  // Sync controlled entries prop into local mirror so standalone and App-hosted modes both stay fresh.
  useEffect(() => {
    if (entriesProp !== undefined) {
      setLocalEntries([...entriesProp])
    }
  }, [entriesProp])

  // Load initial library when entries prop is not supplied by the host.
  useEffect(() => {
    if (entriesProp !== undefined || !api?.bibList) return
    let active = true
    void api
      .bibList()
      .then((res) => {
        if (active && res.ok) setLocalEntries(res.entries)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [entriesProp, api])

  // Keep selectedIds pruned to existing entries.
  useEffect(() => {
    const valid = new Set(entries.map((entry) => entry.id))
    setSelectedIds((prev) => {
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [entries])

  // Read active document citation style whenever the tab opens or the document changes.
  useEffect(() => {
    if (!visible) return
    let active = true
    void bridge
      .getCitationStyle()
      .then((res) => {
        if (active && res?.ok) setDocStyle(res.style)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [bridge, visible, changeTick])

  const tags = useMemo(() => listEntryTags(entries), [entries])

  useEffect(() => {
    if (activeTag && !tags.includes(activeTag)) {
      setActiveTag(null)
    }
  }, [activeTag, tags])

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (activeTag && !(entry.tags ?? []).includes(activeTag)) return false
        return entryMatchesQuery(entry, search)
      }),
    [entries, activeTag, search],
  )

  const selectedEntries = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    return selectedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is BibEntry => entry !== undefined)
  }, [entries, selectedIds])

  const describeWriteFailure = useCallback(
    (reason: string, error?: string): string => {
      switch (reason) {
        case 'has_objects':
        case 'memo_removal_requires_approval':
          return t('errorHasObjects')
        case 'multi_section_range':
          return t('errorMultiSection')
        case 'no_entries':
          return t('errorNoEntries')
        case 'not_found':
          return t('errorNotFound')
        case 'unsupported_place':
          return t('errorUnsupportedPlace')
        case 'unverified_entry':
          return t('errorUnverifiedInDoc')
        default:
          return t('errorActionFailed', { error: error || reason })
      }
    },
    [t],
  )

  const runAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const res = await bridge.auditCitations(entries)
      if (res?.ok) {
        setAuditIssues(res.issues)
        setDocStyle(res.style)
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: tRef.current('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setAuditLoading(false)
    }
  }, [bridge, entries])

  // Refresh audit automatically when viewing the Audit sub-tab.
  useEffect(() => {
    if (visible && subTab === 'audit') {
      void runAudit()
    }
  }, [visible, subTab, changeTick, runAudit])

  const openDocumentLinesPreview = useCallback(
    async (legacy: LegacyFoundInfo) => {
      const rawLines = legacy.lines.map((line) => line.text)
      const parsed = parseDocumentReferenceLines(rawLines, { source: 'document' })
      if (!parsed.ok) {
        setNotice({
          tone: 'error',
          text: t('errorActionFailed', { error: parsed.error || parsed.reason }),
        })
        return
      }
      let plan: ImportPreviewPlan
      if (parsed.entries.length > 0 && api?.bibPreviewImport) {
        const res = await api.bibPreviewImport(parsed.entries)
        plan = res.ok ? res.preview : planImportPreview(parsed.entries, entries)
      } else {
        plan = planImportPreview(parsed.entries, entries)
      }
      const checkedUnparsed: Record<number, boolean> = {}
      for (const item of parsed.unparsed) {
        checkedUnparsed[item.lineIndex] = true
      }
      setLegacyConfirm(null)
      setFormState(null)
      setComposer(null)
      setImportPreview({
        source: 'document',
        plan,
        unparsed: parsed.unparsed,
        checkedUnparsed,
      })
    },
    [api, entries, t],
  )

  const executeStyleSwitch = useCallback(
    async (nextStyle: CitationStyle, allowOverwriteManual: boolean) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await bridge.switchCitationStyle(nextStyle, entries, {
          foreign: true,
          ...(allowOverwriteManual ? { allowOverwriteManual: true } : {}),
        })
        if (res.ok) {
          setDocStyle(res.style)
          setManualConfirm(null)
          onDocumentChanged?.()
          const parts: string[] = [
            t('noticeStyleSwitched', {
              style: STYLE_LABELS[res.style],
              updated: res.updatedCitations,
            }),
          ]
          if (res.skippedManual.length > 0) {
            parts.push(t('noticeStyleSkippedManual', { count: res.skippedManual.length }))
          }
          if (res.missingKeys.length > 0) {
            parts.push(t('noticeStyleMissingKeys', { keys: res.missingKeys.join(', ') }))
          }
          setNotice({
            tone: res.skippedManual.length > 0 || res.missingKeys.length > 0 ? 'warn' : 'info',
            text: parts.join(' '),
          })
          return
        }
        if (res.reason === 'manual_edits' && !allowOverwriteManual) {
          const count =
            'modifiedLines' in res && Array.isArray(res.modifiedLines)
              ? res.modifiedLines.length
              : 1
          setManualConfirm({ kind: 'style', nextStyle, count: Math.max(1, count) })
          return
        }
        setNotice({
          tone: 'error',
          text: describeWriteFailure(res.reason, 'error' in res ? res.error : undefined),
        })
      } catch (error) {
        setNotice({
          tone: 'error',
          text: t('errorActionFailed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        })
      } finally {
        setBusy(false)
      }
    },
    [bridge, describeWriteFailure, entries, onDocumentChanged, t],
  )

  const handleStyleChange = (nextStyle: CitationStyle) => {
    if (nextStyle === docStyle || busy) return
    void executeStyleSwitch(nextStyle, false)
  }

  const openCitationComposer = useCallback(
    (targetEntries: readonly BibEntry[]) => {
      setImportMenuOpen(false)
      setExportMenuOpen(false)
      if (targetEntries.length === 0) {
        setNotice({ tone: 'warn', text: t('selectEntryFirst') })
        return
      }
      if (targetEntries.some((entry) => entry.verified === false)) {
        setNotice({ tone: 'error', text: t('unverifiedBlockError') })
        return
      }
      setNotice(null)
      setFormState(null)
      setImportPreview(null)
      setSubTab('library')
      setComposer({
        entryIds: targetEntries.map((entry) => entry.id),
        mode: 'parenthetical',
        locators: {},
      })
    },
    [t],
  )

  const handleConfirmInsertCitation = async (event: FormEvent) => {
    event.preventDefault()
    if (!composer || busy) return
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const chosen = composer.entryIds
      .map((id) => byId.get(id))
      .filter((entry): entry is BibEntry => entry !== undefined)
    if (chosen.length === 0) {
      setNotice({ tone: 'warn', text: t('selectEntryFirst') })
      return
    }
    if (chosen.some((entry) => entry.verified === false)) {
      setNotice({ tone: 'error', text: t('unverifiedBlockError') })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const items = chosen.map((entry) => {
        const locator = (composer.locators[entry.id] ?? '').trim()
        return locator ? { key: entry.key, locator } : { key: entry.key }
      })
      const res = await bridge.insertCitation({
        entries,
        items,
        mode: composer.mode,
        style: docStyle,
        foreign: true,
      })
      if (res.ok) {
        setComposer(null)
        onDocumentChanged?.()
        setNotice({ tone: 'info', text: t('noticeCitationInserted', { text: res.text }) })
      } else {
        setNotice({
          tone: 'error',
          text: describeWriteFailure(res.reason, 'error' in res ? res.error : undefined),
        })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const executeInsertBibliography = useCallback(
    async (options: { replaceLegacy?: boolean; allowOverwriteManual?: boolean }) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await bridge.insertBibliographyBlock(entries, {
          style: docStyle,
          foreign: true,
          ...(options.replaceLegacy ? { replaceLegacy: true } : {}),
          ...(options.allowOverwriteManual ? { allowOverwriteManual: true } : {}),
        })
        if (res.ok) {
          setLegacyConfirm(null)
          setManualConfirm(null)
          onDocumentChanged?.()
          setNotice({ tone: 'info', text: t('noticeListInserted', { count: res.count }) })
          return
        }
        if (res.reason === 'legacy_bibliography_found' && res.legacy) {
          await bridge.highlightBibliographyRange(res.legacy.range).catch(() => {})
          setLegacyConfirm(res.legacy)
          return
        }
        if (res.reason === 'manual_edits' && !options.allowOverwriteManual) {
          setManualConfirm({
            kind: 'insert',
            count: Math.max(1, res.modifiedLines?.length ?? 1),
          })
          return
        }
        setNotice({
          tone: 'error',
          text: describeWriteFailure(res.reason, 'error' in res ? res.error : undefined),
        })
      } catch (error) {
        setNotice({
          tone: 'error',
          text: t('errorActionFailed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        })
      } finally {
        setBusy(false)
      }
    },
    [bridge, describeWriteFailure, docStyle, entries, onDocumentChanged, t],
  )

  const handleInsertBibliography = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const legacy = await bridge.detectUnmarkedBibliography()
      if (legacy.found) {
        await bridge.highlightBibliographyRange(legacy.range).catch(() => {})
        setLegacyConfirm(legacy)
        setBusy(false)
        return
      }
    } catch {
      // Proceed to insertBibliographyBlock which also enforces legacy detection.
    }
    setBusy(false)
    await executeInsertBibliography({})
  }, [bridge, busy, executeInsertBibliography])

  const executeRefreshBibliography = useCallback(
    async (allowOverwriteManual: boolean) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await bridge.refreshBibliographyBlock(entries, {
          style: docStyle,
          foreign: true,
          ...(allowOverwriteManual ? { allowOverwriteManual: true } : {}),
        })
        if (res.ok) {
          setManualConfirm(null)
          onDocumentChanged?.()
          setNotice({ tone: 'info', text: t('noticeListRefreshed', { count: res.count }) })
          return
        }
        if (res.reason === 'manual_edits' && !allowOverwriteManual) {
          setManualConfirm({
            kind: 'refresh',
            count: Math.max(1, res.modifiedLines?.length ?? 1),
          })
          return
        }
        setNotice({
          tone: 'error',
          text: describeWriteFailure(res.reason, 'error' in res ? res.error : undefined),
        })
      } catch (error) {
        setNotice({
          tone: 'error',
          text: t('errorActionFailed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        })
      } finally {
        setBusy(false)
      }
    },
    [bridge, describeWriteFailure, docStyle, entries, onDocumentChanged, t],
  )

  const handleRefreshBibliography = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const edits = await bridge.detectBibliographyManualEdits()
      if (edits.hasManualEdits) {
        setManualConfirm({
          kind: 'refresh',
          count: Math.max(1, edits.modifiedLines.length),
        })
        setBusy(false)
        return
      }
    } catch {
      // Fall through to refreshBibliographyBlock which performs the authoritative check.
    }
    setBusy(false)
    await executeRefreshBibliography(false)
  }, [bridge, busy, executeRefreshBibliography])

  // Dispatch external Tool-menu commands sent from App.tsx.
  useEffect(() => {
    if (!command || command.nonce === lastCommandNonceRef.current) return
    lastCommandNonceRef.current = command.nonce
    if (command.action === 'open-tab') {
      setSubTab('library')
      return
    }
    if (command.action === 'insert-citation') {
      setSubTab('library')
      if (selectedEntries.length > 0) {
        openCitationComposer(selectedEntries)
      } else {
        setNotice({ tone: 'warn', text: t('selectEntryFirst') })
      }
      return
    }
    if (command.action === 'insert-bibliography') {
      void handleInsertBibliography()
      return
    }
    if (command.action === 'refresh-bibliography') {
      void handleRefreshBibliography()
    }
  }, [
    command,
    handleInsertBibliography,
    handleRefreshBibliography,
    openCitationComposer,
    selectedEntries,
    t,
  ])

  const handleVerifyEntry = async (entry: BibEntry) => {
    if (!api?.bibVerify || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.bibVerify(entry.id)
      if (res.ok) {
        setLocalEntries(res.entries)
        setNotice({ tone: 'info', text: t('noticeVerified') })
      } else {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRequestDelete = async (entry: BibEntry) => {
    if (busy) return
    setBusy(true)
    let citedCount = 0
    try {
      const listed = await bridge.listCitationMarks(entries)
      if (listed?.ok) {
        for (const mark of listed.marks) {
          if (mark.keys.some((key) => entryHasKey(entry, key))) {
            citedCount += 1
          }
        }
      }
    } catch {
      citedCount = 0
    } finally {
      setBusy(false)
    }
    setDeleteConfirm({ entry, citedCount })
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirm || !api?.bibDelete || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.bibDelete(deleteConfirm.entry.id)
      if (res.ok) {
        setLocalEntries(res.entries)
        setDeleteConfirm(null)
        setNotice({ tone: 'info', text: t('noticeDeleted') })
      } else {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleSaveForm = async (event: FormEvent) => {
    event.preventDefault()
    if (!formState || busy) return
    const trimmedTitle = formState.title.trim()
    if (!trimmedTitle) {
      setFormError(t('validationTitleRequired'))
      return
    }
    const trimmedKey = formState.key.trim()
    if (trimmedKey) {
      const sanitized = sanitizeCitationKey(trimmedKey)
      if (!sanitized) {
        setFormError(t('validationKeyInvalid'))
        return
      }
      const conflict = entries.some(
        (entry) =>
          entry.id !== formState.editingId && entry.key.toLowerCase() === sanitized.toLowerCase(),
      )
      if (conflict) {
        setFormError(t('validationKeyDuplicate'))
        return
      }
    }

    setFormError(null)
    setBusy(true)
    setNotice(null)
    try {
      const input = buildInputFromForm(formState)
      if (formState.editingId) {
        if (!api?.bibUpdate) return
        const res = await api.bibUpdate(formState.editingId, input)
        if (res.ok) {
          setLocalEntries(res.entries)
          setFormState(null)
          setNotice({ tone: 'info', text: t('noticeSaved') })
        } else if (res.reason === 'duplicate_key') {
          setFormError(t('validationKeyDuplicate'))
        } else if (res.reason === 'invalid_key') {
          setFormError(t('validationKeyInvalid'))
        } else {
          setFormError(res.error)
        }
      } else {
        if (!api?.bibAdd) return
        const res = await api.bibAdd(input)
        if (res.ok) {
          setLocalEntries(res.entries)
          setFormState(null)
          setNotice({ tone: 'info', text: t('noticeSaved') })
        } else {
          setFormError(res.error)
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleImportFile = async () => {
    setImportMenuOpen(false)
    if (!api?.bibPickImportFile || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.bibPickImportFile()
      if (!res.ok) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
        return
      }
      if (res.canceled) return
      setFormState(null)
      setComposer(null)
      setImportPreview({
        source: 'import',
        fileName: res.fileName,
        plan: res.preview,
        unparsed: [],
        checkedUnparsed: {},
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleImportFromDocument = async () => {
    setImportMenuOpen(false)
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const legacy = await bridge.detectUnmarkedBibliography()
      if (!legacy.found) {
        setNotice({ tone: 'warn', text: t('errorNoUnmarkedFound') })
        return
      }
      await bridge.highlightBibliographyRange(legacy.range).catch(() => {})
      await openDocumentLinesPreview(legacy)
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleCommitImport = async () => {
    if (!importPreview || !api?.bibCommitImport || busy) return
    if (importPreview.plan.toAdd.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.bibCommitImport(importPreview.plan.toAdd, {
        source: importPreview.source,
        skipDuplicates: true,
      })
      if (res.ok) {
        setLocalEntries(res.entries)
        setImportPreview(null)
        setNotice({ tone: 'info', text: t('noticeImported', { count: res.added.length }) })
      } else {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (format: BibliographyFormat) => {
    setExportMenuOpen(false)
    if (!api?.bibExportFile || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.bibExportFile(format, activeTag ? { tag: activeTag } : undefined)
      if (!res.ok) {
        setNotice({ tone: 'error', text: t('errorActionFailed', { error: res.error }) })
      } else if (!res.canceled) {
        setNotice({ tone: 'info', text: t('noticeExported', { count: res.count }) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleApplyKeyRename = async () => {
    if (!pendingKeyRename || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await bridge.rewriteCitationKeys(
        { [pendingKeyRename.oldKey]: pendingKeyRename.newKey },
        entries,
        { foreign: true },
      )
      if (res.ok) {
        onDocumentChanged?.()
        onDismissKeyRename?.()
        setNotice({ tone: 'info', text: t('keyRenameDone', { count: res.updated }) })
      } else {
        setNotice({ tone: 'error', text: describeWriteFailure(res.reason) })
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: t('errorActionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleJumpToIssue = async (issue: AuditIssue) => {
    const match: FindMatch = {
      index: 0,
      kind: issue.kind,
      sec: issue.sec,
      para: issue.para,
      ...(issue.path ? { path: [...issue.path] } : {}),
      ...(issue.noteControl !== undefined ? { noteControl: issue.noteControl } : {}),
      ...(issue.notePara !== undefined ? { notePara: issue.notePara } : {}),
      offset: issue.offset,
      length: issue.length,
      matchText: issue.text,
      beforeText: '',
      afterText: '',
      page: 0,
    }
    try {
      const res = await bridge.revealFindMatch(match)
      if (res?.ok) return
    } catch {
      // Fall back to direct body/range reveal.
    }
    try {
      if (issue.kind === 'body' || issue.kind === 'table' || issue.kind === 'textbox') {
        await bridge.reveal({
          sec: issue.sec,
          para: issue.para,
          ...(issue.path ? { path: [...issue.path] } : {}),
          offset: issue.offset,
          length: issue.length,
        })
      } else {
        await bridge.highlightBibliographyRange({
          sec: issue.sec,
          startPara: issue.para,
          endPara: issue.para,
        })
      }
    } catch {
      // Best-effort navigation.
    }
  }

  const toggleSelectEntry = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const checkedUnparsedLines = useMemo(() => {
    if (!importPreview) return []
    return importPreview.unparsed
      .filter((line) => importPreview.checkedUnparsed[line.lineIndex] === true)
      .map((line) => line.rawLine)
  }, [importPreview])

  const composerEntries = useMemo(() => {
    if (!composer) return []
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    return composer.entryIds
      .map((id) => byId.get(id))
      .filter((entry): entry is BibEntry => entry !== undefined)
  }, [composer, entries])

  const composerHasUnverified = composerEntries.some((entry) => entry.verified === false)

  return (
    <div className="bib-tab" data-testid="bib-tab">
      {/* Top document-level citation controls */}
      <div className="bib-doc-controls">
        <div className="bib-style-row">
          <label className="bib-style-label" htmlFor={styleSelectId}>
            {t('styleLabel')}
          </label>
          <select
            id={styleSelectId}
            className="bib-select"
            data-testid="bib-style-select"
            value={docStyle}
            disabled={busy}
            onChange={(e) => handleStyleChange(e.target.value as CitationStyle)}
          >
            {CITATION_STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </div>
        <div className="bib-doc-actions">
          <button
            type="button"
            className="bib-btn bib-btn-primary bib-btn-grow"
            data-testid="bib-insert-citation-btn"
            disabled={busy}
            onClick={() => openCitationComposer(selectedEntries)}
          >
            {t('insertCitationBtn')}
          </button>
          <button
            type="button"
            className="bib-btn bib-btn-grow"
            data-testid="bib-insert-list-btn"
            disabled={busy}
            onClick={() => void handleInsertBibliography()}
          >
            {t('insertListBtn')}
          </button>
          <button
            type="button"
            className="bib-btn bib-btn-grow"
            data-testid="bib-refresh-list-btn"
            disabled={busy}
            onClick={() => void handleRefreshBibliography()}
          >
            {t('refreshListBtn')}
          </button>
        </div>
      </div>

      {/* Sub-tabs: Library | Audit */}
      <div className="bib-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'library'}
          className={`bib-subtab${subTab === 'library' ? ' active' : ''}`}
          data-testid="bib-library-tab"
          onClick={() => setSubTab('library')}
        >
          {t('tabLibrary')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'audit'}
          className={`bib-subtab${subTab === 'audit' ? ' active' : ''}`}
          data-testid="bib-audit-tab"
          onClick={() => setSubTab('audit')}
        >
          <span>{t('tabAudit')}</span>
          {auditIssues && auditIssues.length > 0 && (
            <span className="bib-subtab-badge">{auditIssues.length}</span>
          )}
        </button>
      </div>

      {/* Key-rename sync banner */}
      {pendingKeyRename && (
        <div className="bib-banner" role="region" data-testid="bib-key-rename-banner">
          <p className="bib-banner-body">
            {t('keyRenameBanner', {
              oldKey: pendingKeyRename.oldKey,
              newKey: pendingKeyRename.newKey,
            })}
          </p>
          <div className="bib-banner-actions">
            <button
              type="button"
              className="bib-btn bib-btn-primary bib-btn-compact"
              data-testid="bib-key-rename-apply-btn"
              disabled={busy}
              onClick={() => void handleApplyKeyRename()}
            >
              {t('keyRenameApplyBtn')}
            </button>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              disabled={busy}
              onClick={() => onDismissKeyRename?.()}
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Unmarked legacy bibliography confirmation */}
      {legacyConfirm && (
        <div className="bib-banner" role="alertdialog" data-testid="bib-legacy-confirm">
          <h4 className="bib-banner-title">{t('legacyFoundTitle')}</h4>
          <p className="bib-banner-body">
            {t('legacyFoundBody', { count: legacyConfirm.lines.length })}
          </p>
          <div className="bib-banner-actions">
            <button
              type="button"
              className="bib-btn bib-btn-primary bib-btn-compact"
              data-testid="bib-legacy-replace-btn"
              disabled={busy}
              onClick={() => void executeInsertBibliography({ replaceLegacy: true })}
            >
              {t('legacyReplaceBtn')}
            </button>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              data-testid="bib-legacy-import-btn"
              disabled={busy}
              onClick={() => void openDocumentLinesPreview(legacyConfirm)}
            >
              {t('legacyImportLinesBtn')}
            </button>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              disabled={busy}
              onClick={() => setLegacyConfirm(null)}
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Manual-edits overwrite confirmation */}
      {manualConfirm && (
        <div className="bib-banner" role="alertdialog" data-testid="bib-manual-confirm">
          <h4 className="bib-banner-title">{t('manualOverwriteTitle')}</h4>
          <p className="bib-banner-body">
            {t('manualOverwriteBody', { count: manualConfirm.count })}
          </p>
          <div className="bib-banner-actions">
            <button
              type="button"
              className="bib-btn bib-btn-primary bib-btn-compact"
              data-testid="bib-manual-overwrite-btn"
              disabled={busy}
              onClick={() => {
                if (manualConfirm.kind === 'style' && manualConfirm.nextStyle) {
                  void executeStyleSwitch(manualConfirm.nextStyle, true)
                } else if (manualConfirm.kind === 'refresh') {
                  void executeRefreshBibliography(true)
                } else {
                  void executeInsertBibliography({ allowOverwriteManual: true })
                }
              }}
            >
              {t('manualOverwriteConfirmBtn')}
            </button>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              disabled={busy}
              onClick={() => setManualConfirm(null)}
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation (with cited-in-document warning when applicable) */}
      {deleteConfirm && (
        <div className="bib-banner" role="alertdialog" data-testid="bib-delete-confirm">
          <h4 className="bib-banner-title">{t('deleteConfirmTitle')}</h4>
          <p className="bib-banner-body">
            {deleteConfirm.citedCount > 0
              ? t('deleteConfirmCited', {
                  title: deleteConfirm.entry.title,
                  count: deleteConfirm.citedCount,
                })
              : t('deleteConfirmPlain', { title: deleteConfirm.entry.title })}
          </p>
          <div className="bib-banner-actions">
            <button
              type="button"
              className="bib-btn bib-btn-danger bib-btn-compact"
              data-testid="bib-delete-confirm-btn"
              disabled={busy}
              onClick={() => void handleConfirmDelete()}
            >
              {t('deleteConfirmBtn')}
            </button>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              disabled={busy}
              onClick={() => setDeleteConfirm(null)}
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Status / error notice */}
      {notice && (
        <div
          className={`bib-notice is-${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="bib-notice"
        >
          <span className="bib-notice-text">{notice.text}</span>
          <button
            type="button"
            className="bib-notice-close"
            aria-label={t('closeLabel')}
            onClick={() => setNotice(null)}
          >
            <IconClose size={12} />
          </button>
        </div>
      )}

      {subTab === 'library' ? (
        <>
          {/* Search, actions, and tag chips */}
          <div className="bib-library-controls">
            <input
              type="search"
              className="bib-input"
              data-testid="bib-search-input"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="bib-toolbar-row">
              <button
                type="button"
                className="bib-btn bib-btn-primary bib-btn-compact"
                data-testid="bib-add-btn"
                disabled={busy}
                onClick={() => {
                  setImportMenuOpen(false)
                  setExportMenuOpen(false)
                  setComposer(null)
                  setImportPreview(null)
                  setFormError(null)
                  setFormState(emptyFormState())
                }}
              >
                + {t('addBtn')}
              </button>

              <div className="bib-menu-wrap">
                <button
                  type="button"
                  className="bib-btn bib-btn-compact"
                  data-testid="bib-import-btn"
                  aria-expanded={importMenuOpen}
                  disabled={busy}
                  onClick={() => {
                    setExportMenuOpen(false)
                    setImportMenuOpen((open) => !open)
                  }}
                >
                  {t('importBtn')}
                </button>
                {importMenuOpen && (
                  <div className="bib-popover-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="bib-popover-item"
                      data-testid="bib-import-file-btn"
                      onClick={() => void handleImportFile()}
                    >
                      {t('importFileBtn')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="bib-popover-item"
                      data-testid="bib-import-doc-btn"
                      onClick={() => void handleImportFromDocument()}
                    >
                      {t('importDocumentBtn')}
                    </button>
                  </div>
                )}
              </div>

              <div className="bib-menu-wrap">
                <button
                  type="button"
                  className="bib-btn bib-btn-compact"
                  data-testid="bib-export-btn"
                  aria-expanded={exportMenuOpen}
                  disabled={busy || entries.length === 0}
                  onClick={() => {
                    setImportMenuOpen(false)
                    setExportMenuOpen((open) => !open)
                  }}
                >
                  {t('exportBtn')}
                </button>
                {exportMenuOpen && (
                  <div className="bib-popover-menu" role="menu">
                    <div className="bib-popover-scope">
                      {activeTag ? t('exportTagScope', { tag: activeTag }) : t('exportAllScope')}
                    </div>
                    {BIBLIOGRAPHY_FORMATS.map((format) => (
                      <button
                        key={format}
                        type="button"
                        role="menuitem"
                        className="bib-popover-item"
                        data-testid={`bib-export-${format}-btn`}
                        onClick={() => void handleExport(format)}
                      >
                        {EXPORT_FORMAT_LABELS[format]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {tags.length > 0 && (
              <div className="bib-tag-bar" role="group">
                <button
                  type="button"
                  className={`bib-tag-chip${activeTag === null ? ' active' : ''}`}
                  data-testid="bib-tag-all"
                  onClick={() => setActiveTag(null)}
                >
                  {t('tagAll')}
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`bib-tag-chip${activeTag === tag ? ' active' : ''}`}
                    data-testid={`bib-tag-${tag}`}
                    onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inline citation composer */}
          {composer && (
            <form
              className="bib-drawer"
              data-testid="bib-citation-composer"
              onSubmit={(e) => void handleConfirmInsertCitation(e)}
            >
              <div className="bib-drawer-head">
                <h4 className="bib-drawer-title">{t('composerTitle')}</h4>
                <button
                  type="button"
                  className="bib-notice-close"
                  aria-label={t('closeLabel')}
                  onClick={() => setComposer(null)}
                >
                  <IconClose size={12} />
                </button>
              </div>
              <div className="bib-field">
                <span className="bib-field-label">{t('composerModeLabel')}</span>
                <div className="bib-composer-mode">
                  <button
                    type="button"
                    className={`bib-subtab${composer.mode === 'parenthetical' ? ' active' : ''}`}
                    data-testid="bib-mode-parenthetical"
                    onClick={() =>
                      setComposer((cur) => (cur ? { ...cur, mode: 'parenthetical' } : cur))
                    }
                  >
                    {t('modeParenthetical')}
                  </button>
                  <button
                    type="button"
                    className={`bib-subtab${composer.mode === 'narrative' ? ' active' : ''}`}
                    data-testid="bib-mode-narrative"
                    onClick={() =>
                      setComposer((cur) => (cur ? { ...cur, mode: 'narrative' } : cur))
                    }
                  >
                    {t('modeNarrative')}
                  </button>
                </div>
              </div>
              {composerEntries.map((entry) => (
                <div key={entry.id} className="bib-composer-item">
                  <span className="bib-composer-item-title">
                    {entry.key} · {entry.title}
                  </span>
                  <input
                    type="text"
                    className="bib-input"
                    data-testid={`bib-locator-input-${entry.key}`}
                    placeholder={t('locatorPlaceholder')}
                    value={composer.locators[entry.id] ?? ''}
                    onChange={(e) =>
                      setComposer((cur) =>
                        cur
                          ? {
                              ...cur,
                              locators: { ...cur.locators, [entry.id]: e.target.value },
                            }
                          : cur,
                      )
                    }
                  />
                </div>
              ))}
              {composerHasUnverified && (
                <div className="bib-form-error" role="alert">
                  {t('unverifiedBlockError')}
                </div>
              )}
              <div className="bib-drawer-actions">
                <button
                  type="button"
                  className="bib-btn bib-btn-compact"
                  onClick={() => setComposer(null)}
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  className="bib-btn bib-btn-primary bib-btn-compact"
                  data-testid="bib-composer-submit-btn"
                  disabled={busy || composerHasUnverified || composerEntries.length === 0}
                >
                  {t('composerConfirmBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Add / Edit entry drawer */}
          {formState && (
            <form
              className="bib-drawer"
              data-testid="bib-entry-form"
              onSubmit={(e) => void handleSaveForm(e)}
            >
              <div className="bib-drawer-head">
                <h4 className="bib-drawer-title">
                  {formState.editingId ? t('formEditTitle') : t('formAddTitle')}
                </h4>
                <button
                  type="button"
                  className="bib-notice-close"
                  aria-label={t('closeLabel')}
                  onClick={() => {
                    setFormState(null)
                    setFormError(null)
                  }}
                >
                  <IconClose size={12} />
                </button>
              </div>

              <div className="bib-field-row">
                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldType')}</span>
                  <select
                    className="bib-select"
                    data-testid="bib-type-select"
                    value={formState.type}
                    onChange={(e) =>
                      setFormState((cur) =>
                        cur ? { ...cur, type: e.target.value as BibEntryType } : cur,
                      )
                    }
                  >
                    {ENTRY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(ENTRY_TYPE_LABEL_KEYS[type])}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldLanguage')}</span>
                  <select
                    className="bib-select"
                    data-testid="bib-language-select"
                    value={formState.language}
                    onChange={(e) =>
                      setFormState((cur) =>
                        cur ? { ...cur, language: e.target.value as 'auto' | EntryLanguage } : cur,
                      )
                    }
                  >
                    <option value="auto">{t('langAuto')}</option>
                    <option value="ko">{t('langKo')}</option>
                    <option value="en">{t('langEn')}</option>
                  </select>
                </label>
              </div>

              <label className="bib-field">
                <span className="bib-field-label">{t('fieldTitle')}</span>
                <input
                  type="text"
                  className="bib-input"
                  data-testid="bib-title-input"
                  value={formState.title}
                  onChange={(e) =>
                    setFormState((cur) => (cur ? { ...cur, title: e.target.value } : cur))
                  }
                />
              </label>

              <label className="bib-field">
                <span className="bib-field-label">{t('fieldAuthors')}</span>
                <input
                  type="text"
                  className="bib-input"
                  data-testid="bib-author-input"
                  value={formState.authors}
                  onChange={(e) =>
                    setFormState((cur) => (cur ? { ...cur, authors: e.target.value } : cur))
                  }
                />
                <span className="bib-field-hint">{t('fieldAuthorsHint')}</span>
              </label>

              <div className="bib-field-row">
                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldYear')}</span>
                  <input
                    type="text"
                    className="bib-input"
                    data-testid="bib-year-input"
                    value={formState.year}
                    onChange={(e) =>
                      setFormState((cur) => (cur ? { ...cur, year: e.target.value } : cur))
                    }
                  />
                </label>

                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldKey')}</span>
                  <input
                    type="text"
                    className="bib-input"
                    data-testid="bib-key-input"
                    placeholder={t('fieldKeyHint')}
                    value={formState.key}
                    onChange={(e) =>
                      setFormState((cur) => (cur ? { ...cur, key: e.target.value } : cur))
                    }
                  />
                </label>
              </div>

              <label className="bib-field">
                <span className="bib-field-label">{t('fieldContainer')}</span>
                <input
                  type="text"
                  className="bib-input"
                  data-testid="bib-container-input"
                  value={formState.containerTitle}
                  onChange={(e) =>
                    setFormState((cur) => (cur ? { ...cur, containerTitle: e.target.value } : cur))
                  }
                />
              </label>

              <div className="bib-field-row">
                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldPages')}</span>
                  <input
                    type="text"
                    className="bib-input"
                    value={formState.pages}
                    onChange={(e) =>
                      setFormState((cur) => (cur ? { ...cur, pages: e.target.value } : cur))
                    }
                  />
                </label>

                <label className="bib-field">
                  <span className="bib-field-label">{t('fieldTags')}</span>
                  <input
                    type="text"
                    className="bib-input"
                    data-testid="bib-tags-input"
                    placeholder={t('fieldTagsHint')}
                    value={formState.tags}
                    onChange={(e) =>
                      setFormState((cur) => (cur ? { ...cur, tags: e.target.value } : cur))
                    }
                  />
                </label>
              </div>

              <button
                type="button"
                className="bib-link-btn"
                data-testid="bib-more-fields-btn"
                onClick={() =>
                  setFormState((cur) => (cur ? { ...cur, showMore: !cur.showMore } : cur))
                }
              >
                {formState.showMore ? t('lessFieldsToggle') : t('moreFieldsToggle')}
              </button>

              {formState.showMore && (
                <>
                  <div className="bib-field-row">
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldVolume')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.volume}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, volume: e.target.value } : cur))
                        }
                      />
                    </label>
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldIssue')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.issue}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, issue: e.target.value } : cur))
                        }
                      />
                    </label>
                  </div>
                  <div className="bib-field-row">
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldPublisher')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.publisher}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, publisher: e.target.value } : cur))
                        }
                      />
                    </label>
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldPlace')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.place}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, place: e.target.value } : cur))
                        }
                      />
                    </label>
                  </div>
                  <div className="bib-field-row">
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldEdition')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.edition}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, edition: e.target.value } : cur))
                        }
                      />
                    </label>
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldEditors')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.editors}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, editors: e.target.value } : cur))
                        }
                      />
                    </label>
                  </div>
                  <div className="bib-field-row">
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldDegree')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.degree}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, degree: e.target.value } : cur))
                        }
                      />
                    </label>
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldInstitution')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.institution}
                        onChange={(e) =>
                          setFormState((cur) =>
                            cur ? { ...cur, institution: e.target.value } : cur,
                          )
                        }
                      />
                    </label>
                  </div>
                  <label className="bib-field">
                    <span className="bib-field-label">{t('fieldDoi')}</span>
                    <input
                      type="text"
                      className="bib-input"
                      value={formState.doi}
                      onChange={(e) =>
                        setFormState((cur) => (cur ? { ...cur, doi: e.target.value } : cur))
                      }
                    />
                  </label>
                  <div className="bib-field-row">
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldUrl')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.url}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, url: e.target.value } : cur))
                        }
                      />
                    </label>
                    <label className="bib-field">
                      <span className="bib-field-label">{t('fieldAccessed')}</span>
                      <input
                        type="text"
                        className="bib-input"
                        value={formState.accessed}
                        onChange={(e) =>
                          setFormState((cur) => (cur ? { ...cur, accessed: e.target.value } : cur))
                        }
                      />
                    </label>
                  </div>
                  <label className="bib-field">
                    <span className="bib-field-label">{t('fieldMemo')}</span>
                    <textarea
                      className="bib-textarea"
                      value={formState.memo}
                      onChange={(e) =>
                        setFormState((cur) => (cur ? { ...cur, memo: e.target.value } : cur))
                      }
                    />
                  </label>
                </>
              )}

              {formError && (
                <div className="bib-form-error" role="alert" data-testid="bib-form-error">
                  {formError}
                </div>
              )}

              <div className="bib-drawer-actions">
                <button
                  type="button"
                  className="bib-btn bib-btn-compact"
                  data-testid="bib-cancel-btn"
                  disabled={busy}
                  onClick={() => {
                    setFormState(null)
                    setFormError(null)
                  }}
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  className="bib-btn bib-btn-primary bib-btn-compact"
                  data-testid="bib-save-btn"
                  disabled={busy}
                >
                  {t('saveBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Two-step import preview panel */}
          {importPreview && (
            <div className="bib-drawer" data-testid="bib-import-preview">
              <div className="bib-drawer-head">
                <h4 className="bib-drawer-title">
                  {importPreview.fileName
                    ? `${t('importPreviewTitle')} · ${importPreview.fileName}`
                    : t('importPreviewTitle')}
                </h4>
                <button
                  type="button"
                  className="bib-notice-close"
                  aria-label={t('closeLabel')}
                  onClick={() => setImportPreview(null)}
                >
                  <IconClose size={12} />
                </button>
              </div>

              <div className="bib-field-label">
                {t('importPreviewSummary', {
                  add: importPreview.plan.toAdd.length,
                  dup: importPreview.plan.duplicates.length,
                })}
              </div>

              {importPreview.plan.toAdd.length > 0 && (
                <div className="bib-preview-section">
                  <p className="bib-preview-section-title">
                    {t('importPreviewToAdd', { count: importPreview.plan.toAdd.length })}
                  </p>
                  <div className="bib-preview-list">
                    {importPreview.plan.toAdd.map((entry) => (
                      <div key={entry.id} className="bib-preview-row">
                        <span className="bib-key-badge">{entry.key}</span>
                        <span className="bib-preview-row-text">{entry.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importPreview.plan.duplicates.length > 0 && (
                <div className="bib-preview-section">
                  <p className="bib-preview-section-title">
                    {t('importPreviewDuplicates', { count: importPreview.plan.duplicates.length })}
                  </p>
                  <div className="bib-preview-list">
                    {importPreview.plan.duplicates.map((dup, index) => (
                      <div key={`${dup.existingKey}-${index}`} className="bib-preview-row">
                        <span className="bib-unverified-badge">{dupReasonText(dup, t)}</span>
                        <span className="bib-preview-row-text">
                          {dup.candidate.title || dup.existingKey}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importPreview.unparsed.length > 0 && (
                <div className="bib-preview-section" data-testid="bib-unparsed-section">
                  <p className="bib-preview-section-title">
                    {t('importUnparsedTitle', { count: importPreview.unparsed.length })}
                  </p>
                  <div className="bib-preview-list">
                    {importPreview.unparsed.map((line) => {
                      const checked = importPreview.checkedUnparsed[line.lineIndex] === true
                      return (
                        <label key={line.lineIndex} className="bib-preview-row">
                          <input
                            type="checkbox"
                            data-testid={`bib-unparsed-check-${line.lineIndex}`}
                            checked={checked}
                            onChange={(e) =>
                              setImportPreview((cur) =>
                                cur
                                  ? {
                                      ...cur,
                                      checkedUnparsed: {
                                        ...cur.checkedUnparsed,
                                        [line.lineIndex]: e.target.checked,
                                      },
                                    }
                                  : cur,
                              )
                            }
                          />
                          <span className="bib-preview-row-text">{line.rawLine}</span>
                        </label>
                      )
                    })}
                  </div>
                  {aiEnabled && onRequestAiParseLines && (
                    <button
                      type="button"
                      className="bib-btn bib-btn-compact"
                      data-testid="bib-unparsed-ai-btn"
                      disabled={busy || checkedUnparsedLines.length === 0}
                      onClick={() => onRequestAiParseLines(checkedUnparsedLines)}
                    >
                      {t('importUnparsedAiBtn', { count: checkedUnparsedLines.length })}
                    </button>
                  )}
                </div>
              )}

              <div className="bib-drawer-actions">
                <button
                  type="button"
                  className="bib-btn bib-btn-compact"
                  data-testid="bib-import-cancel-btn"
                  disabled={busy}
                  onClick={() => setImportPreview(null)}
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="button"
                  className="bib-btn bib-btn-primary bib-btn-compact"
                  data-testid="bib-import-confirm-btn"
                  disabled={busy || importPreview.plan.toAdd.length === 0}
                  onClick={() => void handleCommitImport()}
                >
                  {t('importConfirmBtn')}
                </button>
              </div>
            </div>
          )}

          {/* Selection summary */}
          {selectedIds.length > 0 && (
            <div className="bib-selection-bar">
              <span>{t('selectedCount', { count: selectedIds.length })}</span>
              <button type="button" className="bib-link-btn" onClick={() => setSelectedIds([])}>
                {t('cancelBtn')}
              </button>
            </div>
          )}

          {/* Entry list */}
          <div className="bib-scroll-area" data-testid="bib-entry-list">
            {entries.length === 0 ? (
              <p className="bib-empty-state">{t('emptyLibrary')}</p>
            ) : filteredEntries.length === 0 ? (
              <p className="bib-empty-state">{t('emptyFiltered')}</p>
            ) : (
              filteredEntries.map((entry) => {
                const isSelected = selectedIds.includes(entry.id)
                const isUnverified = entry.verified === false
                const authorSummary = formatEntryAuthorsSummary(entry, t('noAuthor'))
                const yearText = entry.year || t('noYear')
                return (
                  <div
                    key={entry.id}
                    className={`bib-entry-card${isSelected ? ' selected' : ''}`}
                    data-testid="bib-entry-row"
                    data-entry-key={entry.key}
                  >
                    <input
                      type="checkbox"
                      className="bib-entry-check"
                      aria-label={entry.title}
                      checked={isSelected}
                      onChange={() => toggleSelectEntry(entry.id)}
                    />
                    <div className="bib-entry-body">
                      <div className="bib-entry-top">
                        <span className="bib-key-badge">{entry.key}</span>
                        {isUnverified && (
                          <span className="bib-unverified-badge" data-testid="bib-unverified-badge">
                            {t('unverifiedBadge')}
                          </span>
                        )}
                      </div>
                      <div className="bib-entry-title">{entry.title}</div>
                      <div className="bib-entry-meta">
                        {authorSummary} · {yearText}
                      </div>
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="bib-entry-tags">
                          {entry.tags.map((tag) => (
                            <span key={tag} className="bib-entry-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="bib-entry-actions">
                        {isUnverified && (
                          <button
                            type="button"
                            className="bib-btn bib-btn-primary bib-btn-compact"
                            data-testid="bib-verify-btn"
                            disabled={busy}
                            onClick={() => void handleVerifyEntry(entry)}
                          >
                            {t('verifyBtn')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="bib-btn bib-btn-compact"
                          data-testid="bib-row-cite-btn"
                          disabled={busy || isUnverified}
                          title={isUnverified ? t('unverifiedBlockError') : undefined}
                          onClick={() => openCitationComposer([entry])}
                        >
                          {t('citeRowBtn')}
                        </button>
                        <button
                          type="button"
                          className="bib-btn bib-btn-compact"
                          data-testid="bib-row-edit-btn"
                          disabled={busy}
                          onClick={() => {
                            setComposer(null)
                            setImportPreview(null)
                            setFormError(null)
                            setFormState(formStateFromEntry(entry))
                          }}
                        >
                          {t('editBtn')}
                        </button>
                        <button
                          type="button"
                          className="bib-btn bib-btn-danger bib-btn-compact"
                          data-testid="bib-row-delete-btn"
                          disabled={busy}
                          onClick={() => void handleRequestDelete(entry)}
                        >
                          {t('deleteBtn')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      ) : (
        /* Audit view */
        <>
          <div className="bib-audit-header">
            <span className="bib-audit-summary">
              {auditIssues && auditIssues.length > 0
                ? t('auditSummary', { count: auditIssues.length })
                : t('auditEmpty')}
            </span>
            <button
              type="button"
              className="bib-btn bib-btn-compact"
              data-testid="bib-audit-run-btn"
              disabled={auditLoading}
              onClick={() => void runAudit()}
            >
              {t('auditRunBtn')}
            </button>
          </div>
          <div className="bib-scroll-area" data-testid="bib-audit-panel">
            {!auditIssues || auditIssues.length === 0 ? (
              <p className="bib-empty-state">{t('auditEmpty')}</p>
            ) : (
              auditIssues.map((issue, index) => (
                <button
                  key={`${issue.type}-${issue.sec}-${issue.para}-${issue.offset}-${index}`}
                  type="button"
                  className="bib-audit-row"
                  data-testid="bib-audit-issue"
                  data-issue-type={issue.type}
                  onClick={() => void handleJumpToIssue(issue)}
                >
                  <span className="bib-audit-kind">{t(AUDIT_KIND_LABEL_KEYS[issue.type])}</span>
                  <span className="bib-audit-text">
                    {issue.key ? `[${issue.key}] ` : ''}
                    {issue.text}
                  </span>
                  <span className="bib-audit-hint">{t('auditJumpHint')}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
