// The PC AI tools' capability surface (apps/pdf/src/renderer/ai/tools.ts `PdfAiDeps`)
// over the mobile PDF model and edit session, the way the PC App.tsx `aiApi` builds it.
// Every write is one batch through the session's dispatch (the PC op registry). What the
// phone does not offer (text editing, images, stamps, file-level page operations, new
// documents) refuses: its tools are never handed to the model (MOBILE_PDF_TOOLS).
import { MARKUP_COLORS, type PageGeom } from '../../../../../../pdf/src/renderer/annotations'
import {
  createSavedAnnotCountsLoader,
  loadSavedAnnots,
  type PageSavedAnnots,
  type SavedAnnotCounts,
} from '../../../../../../pdf/src/renderer/annotation-catalog'
import type { OutlineNode } from '../../../../../../pdf/src/renderer/OutlinePanel'
import { pendingNoteKey } from '../../../../../../pdf/src/renderer/note-threads'
import { renderStaticFormMark } from '../../../../../../pdf/src/renderer/static-form-fill'
import type { PdfAiDeps } from '../../../../../../pdf/src/renderer/ai/tools'
import type { MetadataInput } from '../../../../../../pdf/src/shared/ipc'
import type { EditSnapshot, Op, PlanResult } from '../edit/types'
import { visiblePageList } from '../edit/saveRequest'
import {
  newNoteOp,
  noteDeleteOps,
  noteEditOps,
  pageThreads,
  replyOp,
} from '../features/annot/noteOps'
import { loadHighlightPens, loadLineMarkupColors } from '../features/annot/prefs'
import {
  liveFormCatalog,
  loadFormCatalog,
  markOp,
  pageBoxShapes,
  type FormCatalog,
  type FormMarkPainter,
} from '../features/form/formModel'
import { pageDisplaySize } from '../features/pages/pageOps'
import { pdfPageGeom, type PdfOpenedDocument } from '../view'
import type { PdfAiEnv } from './createAiRun'

/** Author of everything the AI writes into notes (PC `aiApi`). */
export const AI_NOTE_AUTHOR = 'AI Assistant'

/** What one PDF.js document gives the tools, read once (outline, properties, form fields, annotations). */
interface ModelFacts {
  outline: OutlineNode[] | null
  docInfo: MetadataInput
  catalog: FormCatalog | null
  readonly saved: Map<number, Promise<PageSavedAnnots>>
  counts: SavedAnnotCounts | null
  countsLoad: (() => Promise<SavedAnnotCounts>) | null
}

const facts = new WeakMap<PdfOpenedDocument, ModelFacts>()

function factsOf(model: PdfOpenedDocument): ModelFacts {
  let entry = facts.get(model)
  if (!entry) {
    entry = {
      outline: null,
      docInfo: {},
      catalog: null,
      saved: new Map(),
      counts: null,
      countsLoad: null,
    }
    facts.set(model, entry)
  }
  return entry
}

/**
 * Reads what the synchronous parts of the tools need before a run (PC App state that is
 * loaded at open), and starts the whole-document annotation count once (PC
 * `startAiAnnotCountScan`, which also runs only while the AI is in use).
 */
export async function prepareModelFacts(model: PdfOpenedDocument): Promise<void> {
  const entry = factsOf(model)
  if (!entry.countsLoad) {
    entry.countsLoad = createSavedAnnotCountsLoader(model.proxy, loadSavedAnnots)
    void entry.countsLoad().then(
      (counts) => {
        entry.counts = counts
      },
      () => {},
    )
  }
  const [outline, info, catalog] = await Promise.all([
    entry.outline ?? model.proxy.getOutline().catch(() => null),
    model.proxy.getMetadata().then(
      (meta) =>
        meta.info as { Title?: string; Author?: string; Subject?: string; Keywords?: string },
      () => ({}) as { Title?: string; Author?: string; Subject?: string; Keywords?: string },
    ),
    entry.catalog ?? loadFormCatalog(model.proxy),
  ])
  entry.outline = (outline as OutlineNode[] | null) ?? null
  entry.docInfo = {
    title: info.Title ?? '',
    author: info.Author ?? '',
    subject: info.Subject ?? '',
    keywords: info.Keywords ?? '',
  }
  entry.catalog = catalog
}

function savedAnnots(model: PdfOpenedDocument, pageIndex: number): Promise<PageSavedAnnots> {
  const entry = factsOf(model)
  let load = entry.saved.get(pageIndex)
  if (!load) {
    load = loadSavedAnnots(model.proxy, pageIndex)
    entry.saved.set(pageIndex, load)
  }
  return load
}

/** PC App.tsx `aiPendingSummary` (the phone has no watermark/header-footer stamps). */
export function pendingSummaryOf(s: EditSnapshot): string {
  const parts: string[] = []
  const add = (n: number, label: string) => {
    if (n > 0) parts.push(`${label}: ${n}`)
  }
  add(s.textEdits.length, 'text edits')
  add(s.textInserts.length, 'text inserts')
  add(s.imageEdits.length, 'image edits')
  add(s.markups.length, 'markups')
  add(s.annotDeletes.length, 'annotation deletions')
  add(s.noteEdits.length, 'note edits')
  add(s.drawings.length, 'drawings')
  add(s.formEdits.size, 'form field changes')
  add(s.formFields.length, 'new form fields (Form Design)')
  add(s.blankPages.length, 'blank pages added')
  add(s.formWidgetEdits.size, 'existing form field changes (Form Design)')
  add(s.rotations.size, 'page rotations')
  add(s.deleted.size, 'page deletions')
  if (s.order) parts.push('page order changed')
  if (s.metadata) parts.push('document properties changed')
  return parts.length > 0
    ? `Unsaved changes queued this session (pending until the user saves, not yet visible in the file): ${parts.join(', ')}.`
    : ''
}

/** PC App.tsx `aiAnnotationSummary` over the saved counts and the pending edits. */
function annotationSummaryOf(s: EditSnapshot, counts: SavedAnnotCounts | null): string {
  const pendingRoots = s.drawings.filter(
    (d) =>
      d.input.kind === 'note' &&
      !d.input.replyToSaved &&
      d.input.replyToLocalId === undefined &&
      !s.deleted.has(d.input.pageIndex),
  ).length
  let deletedThreads = 0
  let deletedMarkups = 0
  for (const d of s.annotDeletes) {
    if (s.deleted.has(d.annot.pageIndex)) continue
    if (d.annot.type === 'note') {
      if (d.annot.inReplyTo === null) deletedThreads++
    } else deletedMarkups++
  }
  if (!counts) {
    return 'Whether the file contains notes/markups has not been determined yet; use read_annotations to check when the user asks about review feedback.'
  }
  let savedThreads = 0
  let savedMarkups = 0
  counts.threads.forEach((n, i) => {
    if (!s.deleted.has(i)) savedThreads += n
  })
  counts.markups.forEach((n, i) => {
    if (!s.deleted.has(i)) savedMarkups += n
  })
  const threads = Math.max(0, savedThreads - deletedThreads) + pendingRoots
  const markupCount =
    Math.max(0, savedMarkups - deletedMarkups) +
    s.markups.filter((m) => !s.deleted.has(m.pageIndex)).length
  if (threads + markupCount === 0) return ''
  const bits: string[] = []
  if (threads > 0) bits.push(`${threads} note thread(s)`)
  if (markupCount > 0) bits.push(`${markupCount} text markup(s)`)
  return `The document has ${bits.join(' and ')}; use read_annotations to read them.`
}

const notOnMobile = (): never => {
  throw new Error('not available in the mobile PDF editor')
}

export interface MobilePdfDepsOptions {
  /** The run's write path: one batch, one undo step (the agent counts what it applied). */
  readonly dispatch: (ops: Op[]) => PlanResult
}

export function createMobilePdfAiDeps(env: PdfAiEnv, options: MobilePdfDepsOptions): PdfAiDeps {
  const { editSession } = env
  const store = editSession.store
  const model = () => editSession.getModel()
  const edits = () => store.getSnapshot()
  const dispatch = options.dispatch
  const paint: FormMarkPainter = env.paintMark ?? renderStaticFormMark

  /** PC `pageGeom` with the pending rotation; a pending blank page has its own size. */
  const pageGeomOf = (pageIndex: number): PageGeom | null => {
    const current = model()
    const s = edits()
    const rotation = s.rotations.get(pageIndex) ?? 0
    if (pageIndex >= 0 && pageIndex < current.pages.length) {
      return pdfPageGeom(current, pageIndex, rotation)
    }
    const blank = s.blankPages.find((b) => b.input.pageIndex === pageIndex)
    if (!blank) return null
    return {
      pw: blank.input.width,
      ph: blank.input.height,
      rot: rotation,
      x0: 0,
      y0: 0,
      userUnit: 1,
    }
  }
  const geomOrDefault = (pageIndex: number) => pageGeomOf(pageIndex) ?? pdfPageGeom(model(), 0)

  const threadsOn = async (pageIndex: number) => {
    const current = model()
    const notes =
      pageIndex < current.pages.length ? (await savedAnnots(current, pageIndex)).notes : []
    return pageThreads(edits(), pageIndex, notes)
  }

  return {
    doc: () => model().proxy,
    fileName: () => editSession.getSession().name,
    pageCount: () => model().pages.length + edits().blankPages.length,
    currentPage: () => (env.viewer()?.getCurrentPage() ?? env.keptView.get().anchorPage) + 1,
    // PC `readOnly`: a damaged file, or an encrypted one this session may not modify
    readOnly: () => {
      const reason = model().readOnlyReason
      return reason === 'encrypted' || reason === 'damaged'
    },
    ocrText: () => null,
    // the text selection of the highlighter stays in its feature; questions name the passage
    selection: () => null,
    pendingSummary: () => pendingSummaryOf(edits()),
    annotationSummary: () => annotationSummaryOf(edits(), factsOf(model()).counts),
    outline: () => factsOf(model()).outline,
    searchIndex: () => model().searchIndex.get(model().proxy),
    isDeleted: (i) => edits().deleted.has(i),
    gotoPage: (page) => {
      const index = page - 1
      if (edits().deleted.has(index)) return false
      // pending blank pages are not drawn by the viewer yet; they are still valid targets
      if (index < model().pages.length) env.viewer()?.scrollToPage(index)
      return true
    },
    addMarkup: (type, pageIndex, rects, color) => {
      const quads = rects.map((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]])
      const fallback =
        type === 'highlight'
          ? (loadHighlightPens()[0] ?? MARKUP_COLORS.highlight)
          : loadLineMarkupColors()[type]
      dispatch([
        {
          op: 'addMarkup',
          markup: { pageIndex, type, color: color ?? [...fallback], quads },
        },
      ])
    },
    annotationsOn: async (pageIndex) => {
      const current = model()
      const saved =
        pageIndex < current.pages.length
          ? await savedAnnots(current, pageIndex)
          : { markups: [], notes: [] }
      const s = edits()
      const pendingDeleted = new Set(s.annotDeletes.map((d) => d.annot.objNum))
      return {
        threads: pageThreads(s, pageIndex, saved.notes),
        markups: [
          ...saved.markups
            .filter((a) => !pendingDeleted.has(a.objNum))
            .map((a) => ({ key: `S${a.objNum}`, type: a.type, quads: a.quads, saved: true })),
          ...s.markups
            .filter((m) => m.pageIndex === pageIndex)
            .map((m) => ({ key: `P${m.id}`, type: m.type, quads: m.quads, saved: false })),
        ],
      }
    },
    deleteMarkups: async (pageIndex, keys) => {
      const pendingIds = new Set(keys.filter((k) => k[0] === 'P').map((k) => k.slice(1)))
      const savedNums = new Set(keys.filter((k) => k[0] === 'S').map((k) => Number(k.slice(1))))
      const current = model()
      const savedList =
        pageIndex < current.pages.length ? (await savedAnnots(current, pageIndex)).markups : []
      const s = edits()
      const pendingDeleted = new Set(s.annotDeletes.map((d) => d.annot.objNum))
      const saved = savedList.filter(
        (a) => savedNums.has(a.objNum) && !pendingDeleted.has(a.objNum),
      )
      if (pendingIds.size === 0 && saved.length === 0) return
      dispatch([
        ...s.markups
          .filter((m) => m.pageIndex === pageIndex && pendingIds.has(m.id))
          .map((m): Op => ({ op: 'removeMarkup', id: m.id })),
        ...saved.map((annot): Op => ({ op: 'deleteSavedAnnot', annot })),
      ])
    },
    deleteNoteThread: (_pageIndex, root) => {
      dispatch(noteDeleteOps(root))
    },
    addNote: (pageIndex, at, contents, color) => {
      const id = editSession.services.newId()
      const plan = dispatch([
        newNoteOp({
          id,
          pageIndex,
          at,
          contents,
          author: AI_NOTE_AUTHOR,
          now: Date.now(),
          ...(color ? { color } : {}),
        }),
      ])
      if (plan.failures.length > 0) return { error: plan.failures[0]!.error }
      return { key: pendingNoteKey(id) }
    },
    findNoteRoot: async (pageIndex, rootKey) =>
      (await threadsOn(pageIndex)).find((r) => r.key === rootKey) ?? null,
    replyToThread: (pageIndex, root, contents) => {
      dispatch([replyOp({ pageIndex, root, contents, author: AI_NOTE_AUTHOR, now: Date.now() })])
    },
    editNote: (_pageIndex, item, contents) => {
      const ops = noteEditOps(item, contents)
      if (ops) dispatch(ops)
    },
    addFormMark: (pageIndex, kind, rect) => {
      const image = paint(kind, Math.max(rect[2] - rect[0], rect[3] - rect[1]))
      if (!image) return
      dispatch([
        markOp(
          editSession.services.newId(),
          kind,
          pageIndex,
          geomOrDefault(pageIndex),
          image.image,
          rect,
        ),
      ])
    },
    formWidgets: (pageIndex) =>
      liveFormCatalog(factsOf(model()).catalog, edits().formWidgetEdits)?.byPage.get(pageIndex) ??
      [],
    pageBoxes: (pageIndex) =>
      pageIndex < model().pages.length
        ? pageBoxShapes(model().proxy, pageIndex)
        : Promise.resolve([]),
    formEdits: () => edits().formEdits,
    applyOps: (ops, opts) => (opts?.dryRun ? store.plan(ops) : dispatch(ops)),
    metadata: () => edits().metadata ?? factsOf(model()).docInfo,
    pageOrder: () => visiblePageList(edits(), model().pages.length),
    pageGeom: pageGeomOf,
    // PC App.tsx `insertBlankPage`: sized like its neighbor, the next free original index
    insertBlankPage: (afterOrigIdx) => {
      const s = edits()
      const documentPages = model().pages.length
      const after = afterOrigIdx !== null && afterOrigIdx >= 0 ? afterOrigIdx : null
      const neighbor = after ?? visiblePageList(s, documentPages)[0]
      const size =
        neighbor !== undefined && pageGeomOf(neighbor)
          ? pageDisplaySize(s, documentPages, geomOrDefault, neighbor)
          : { width: 595.28, height: 841.89 }
      const pageIndex = documentPages + s.blankPages.length
      const plan = dispatch([
        { op: 'insertBlankPage', after, pageIndex, width: size.width, height: size.height },
      ])
      if (plan.failures.length > 0) return { ok: false, error: plan.failures[0]!.error }
      return { ok: true, pageIndex }
    },
    imageGenAvailable: () => false,

    // not offered on the phone (spec 3.12): their tools never reach the model
    editText: notOnMobile,
    moveTextBlock: notOnMobile,
    insertText: notOnMobile,
    textInserts: () => [],
    updateTextInsert: notOnMobile,
    moveTextInsert: notOnMobile,
    deleteTextInsert: notOnMobile,
    editFonts: () => [],
    listImages: notOnMobile,
    isImageClaimed: notOnMobile,
    insertImage: notOnMobile,
    transformImage: notOnMobile,
    replaceImage: notOnMobile,
    bakeImage: notOnMobile,
    deleteImage: notOnMobile,
    searchImages: notOnMobile,
    generateImage: notOnMobile,
    fetchImage: notOnMobile,
    stamps: () => null,
    setStamps: notOnMobile,
    createDocument: notOnMobile,
    confirmFileOp: async () => false,
    setPageSize: notOnMobile,
    cropPages: notOnMobile,
    replacePages: notOnMobile,
    extractPages: notOnMobile,
    splitPdf: notOnMobile,
    splitPages: notOnMobile,
    mergePages: notOnMobile,
  }
}
