/**
 * Local whiteboard document session backed by the Rust WASM engine (`@genoffice/whiteboard-engine`).
 * Owns live `WhiteboardArchiveHandle`, undo/redo history, dirty tracking, Excalidraw import
 * metadata, non-destructive AI highlight overlays, and implements `WhiteboardAiHost`.
 */
import {
  applyTemplate as wasmApplyTemplate,
  createNewArchive,
  createNewBoard,
  openWhiteboardArchive,
  orderBetween,
  planBoardEdit,
  readBoardTable,
  type BoardDocument,
  type BoardObject,
  type BoardTableView,
  type ConnectorEnd,
  type ConnectorProps,
  type EditError,
  type EditPlanResult,
  type ExcalidrawImportSummary,
  type Page,
  type PageBackground,
  type PageFormat,
  type Point,
  type TemplateApplyResult,
  type WhiteboardArchiveHandle,
} from '@genoffice/whiteboard-engine'
import type {
  CapturedPagePng,
  InsertImageInput,
  InsertImageResult,
  WhiteboardAiHost,
} from '../../shared/ai-host'
import {
  renderPageToSvg,
  renderSvgToPngBytes,
  uint8ToBase64,
  uint8ToDataUrl,
} from '../export/render-svg'
import type { RenderedPdfPage } from '../export/pdf-import'

const MAX_UNDO_STEPS = 100

interface UndoEntry {
  snapshot: BoardDocument
  activePageId: string
  revisionBefore: number
  revisionAfter: number
  isAiStep?: boolean
}

export class WhiteboardSession implements WhiteboardAiHost {
  private archive: WhiteboardArchiveHandle
  private doc: BoardDocument
  private activePageId: string
  private selectedIds: string[] = []
  private highlightIds: string[] = []
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private revision = 0
  private nextRevision = 0
  private savedRevision = 0
  private filePath: string | null = null
  private importSourcePath: string | null = null
  private importSummary: ExcalidrawImportSummary | null = null
  private listeners = new Set<() => void>()
  private dataUrlCache = new Map<string, string>()

  constructor(
    archive: WhiteboardArchiveHandle,
    options: {
      filePath?: string | null
      importSourcePath?: string | null
      importSummary?: ExcalidrawImportSummary | null
      initiallyDirty?: boolean
    } = {},
  ) {
    this.archive = archive
    this.doc = archive.getDocument()
    this.activePageId = this.doc.pages[0]?.id ?? ''
    this.filePath = options.filePath ?? null
    this.importSourcePath = options.importSourcePath ?? null
    this.importSummary = options.importSummary ?? null
    this.savedRevision = options.initiallyDirty ? -1 : 0
  }

  static createBlank(title = ''): WhiteboardSession {
    const id = crypto.randomUUID()
    const pageId = `page-${crypto.randomUUID().slice(0, 8)}`
    const doc = createNewBoard(id, pageId, title)
    return new WhiteboardSession(createNewArchive(doc))
  }

  static fromBytes(
    bytes: Uint8Array,
    options: {
      filePath?: string | null
      importSourcePath?: string | null
      importSummary?: ExcalidrawImportSummary | null
      initiallyDirty?: boolean
    } = {},
  ): WhiteboardSession {
    const archive = openWhiteboardArchive(bytes)
    return new WhiteboardSession(archive, options)
  }

  dispose(): void {
    this.archive.dispose()
    this.dataUrlCache.clear()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onDocumentChange(listener: () => void): () => void {
    return this.subscribe(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  getDocument(): BoardDocument {
    return this.doc
  }

  getActivePageId(): string {
    return this.activePageId
  }

  getActivePage(): Page | undefined {
    return this.doc.pages.find((p) => p.id === this.activePageId) ?? this.doc.pages[0]
  }

  setActivePageId(pageId: string): void {
    if (this.doc.pages.some((p) => p.id === pageId) && this.activePageId !== pageId) {
      this.activePageId = pageId
      this.selectedIds = []
      this.emit()
    }
  }

  getSelection(): string[] {
    return [...this.selectedIds]
  }

  setSelection(ids: readonly string[]): void {
    this.selectedIds = [...new Set(ids)]
    this.emit()
  }

  getHighlights(): string[] {
    return [...this.highlightIds]
  }

  setHighlights(objectIds: readonly string[]): void {
    this.highlightIds = [...new Set(objectIds)]
    this.emit()
  }

  getFilePath(): string | null {
    return this.filePath
  }

  setFilePath(filePath: string | null): void {
    this.filePath = filePath
    if (filePath) this.importSourcePath = null
    this.emit()
  }

  getImportSourcePath(): string | null {
    return this.importSourcePath
  }

  getImportSummary(): ExcalidrawImportSummary | null {
    return this.importSummary
  }

  dismissImportBanner(): void {
    this.importSummary = null
    this.emit()
  }

  getRevision(): number {
    return this.revision
  }

  isDirty(): boolean {
    return this.revision !== this.savedRevision
  }

  markSaved(newFilePath?: string): void {
    if (newFilePath) {
      this.filePath = newFilePath
      this.importSourcePath = null
    }
    this.savedRevision = this.revision
    this.emit()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Commits a new validated BoardDocument as one undo step. */
  commitDocument(
    nextDoc: BoardDocument,
    options: { isAiStep?: boolean; nextPageId?: string } = {},
  ): void {
    const prevSnapshot = structuredClone(this.doc)
    const prevPageId = this.activePageId
    const revBefore = this.revision

    this.archive.setDocument(nextDoc)
    this.doc = this.archive.getDocument()
    if (options.nextPageId && this.doc.pages.some((p) => p.id === options.nextPageId)) {
      this.activePageId = options.nextPageId
    } else if (!this.doc.pages.some((p) => p.id === this.activePageId)) {
      this.activePageId = this.doc.pages[0]?.id ?? ''
    }
    this.selectedIds = this.selectedIds.filter((id) =>
      this.doc.objects.some((o) => o.id === id && o.pageId === this.activePageId),
    )
    this.nextRevision += 1
    this.revision = this.nextRevision
    this.undoStack.push({
      snapshot: prevSnapshot,
      activePageId: prevPageId,
      revisionBefore: revBefore,
      revisionAfter: this.revision,
      isAiStep: options.isAiStep,
    })
    if (this.undoStack.length > MAX_UNDO_STEPS) {
      this.undoStack.shift()
    }
    this.redoStack = []
    this.emit()
  }

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false
    const currentSnapshot = structuredClone(this.doc)
    const currentPageId = this.activePageId
    this.archive.setDocument(entry.snapshot)
    this.doc = this.archive.getDocument()
    this.activePageId = entry.activePageId
    this.selectedIds = []
    this.revision = entry.revisionBefore
    this.redoStack.push({
      snapshot: currentSnapshot,
      activePageId: currentPageId,
      revisionBefore: entry.revisionBefore,
      revisionAfter: entry.revisionAfter,
      isAiStep: entry.isAiStep,
    })
    this.emit()
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    const currentSnapshot = structuredClone(this.doc)
    const currentPageId = this.activePageId
    this.archive.setDocument(entry.snapshot)
    this.doc = this.archive.getDocument()
    this.activePageId = entry.activePageId
    this.selectedIds = []
    this.revision = entry.revisionAfter
    this.undoStack.push({
      snapshot: currentSnapshot,
      activePageId: currentPageId,
      revisionBefore: entry.revisionBefore,
      revisionAfter: entry.revisionAfter,
      isAiStep: entry.isAiStep,
    })
    this.emit()
    return true
  }

  /**
   * Undoes the last `count` AI steps only if no user edit occurred after them.
   * Returns false without modifying the board if the user edited after the AI turn.
   */
  async undoBatches(count: number): Promise<boolean> {
    if (count <= 0 || this.undoStack.length < count) return false
    const tail = this.undoStack.slice(this.undoStack.length - count)
    if (!tail.every((e) => e.isAiStep)) return false
    for (let i = 0; i < count; i++) {
      if (!this.undo()) return false
    }
    this.highlightIds = []
    this.emit()
    return true
  }

  /** Adds a validated raster image into `.whiteboard` resources and returns its resourceId & metadata. */
  addImageResource(bytes: Uint8Array, preferredId?: string) {
    const id = preferredId || `res-${crypto.randomUUID().slice(0, 8)}`
    const meta = this.archive.addImageResource(id, bytes)
    this.doc = this.archive.getDocument()
    this.dataUrlCache.set(id, uint8ToDataUrl(bytes, meta.mime))
    return { resourceId: id, meta }
  }

  getResourceDataUrl(resourceId: string): string | null {
    const cached = this.dataUrlCache.get(resourceId)
    if (cached) return cached
    const bytes = this.archive.getResource(resourceId)
    const meta = this.doc.resources[resourceId]
    if (!bytes || !meta) return null
    const url = uint8ToDataUrl(bytes, meta.mime)
    this.dataUrlCache.set(resourceId, url)
    return url
  }

  getAllResourceDataUrls(): Map<string, string> {
    for (const id of Object.keys(this.doc.resources)) {
      this.getResourceDataUrl(id)
    }
    return new Map(this.dataUrlCache)
  }

  /** Imports rendered PDF pages as locked background custom pages in a single undo step. */
  importPdfPages(pages: readonly RenderedPdfPage[], baseTitle: string): Page[] {
    if (pages.length === 0) return []
    const nextDoc = structuredClone(this.doc)
    let lastKey = nextDoc.pages.at(-1)?.orderKey ?? null
    const created: Page[] = []

    for (const rp of pages) {
      const { resourceId } = this.addImageResource(rp.pngBytes)
      // Pull newly registered resource meta into our working doc clone.
      nextDoc.resources[resourceId] = this.doc.resources[resourceId]!
      const key = orderBetween(lastKey, null)
      lastKey = key
      const page: Page = {
        id: `page-${crypto.randomUUID().slice(0, 8)}`,
        title: `${baseTitle} (${rp.pageNumber})`,
        orderKey: key,
        format: 'custom',
        width: rp.width,
        height: rp.height,
        background: {
          kind: 'image',
          resourceId,
          width: rp.width,
          height: rp.height,
        },
      }
      nextDoc.pages.push(page)
      created.push(page)
    }

    this.commitDocument(nextDoc, { nextPageId: created[0]!.id })
    return created
  }

  /** Serializes `.whiteboard` bytes (byte-identical if unchanged since open or last save). */
  async serializeForSave(options: { updateThumbnail?: boolean } = {}): Promise<{
    bytes: Uint8Array
    unchanged: boolean
  }> {
    if (!this.isDirty() && this.filePath !== null) {
      return { bytes: this.archive.save(), unchanged: true }
    }
    if (options.updateThumbnail && this.doc.pages[0]) {
      const rendered = renderPageToSvg(
        this.doc,
        this.doc.pages[0].id,
        this.getAllResourceDataUrls(),
      )
      if (rendered) {
        const png = await renderSvgToPngBytes(rendered.svg, rendered.width, rendered.height, 480)
        if (png) {
          try {
            this.archive.setThumbnail(png.bytes)
          } catch {
            // Thumbnail generation is optional; never fail save over it.
          }
        }
      }
    }
    return { bytes: this.archive.save(), unchanged: false }
  }

  // ---- WhiteboardAiHost implementation ----

  async readBoard(): Promise<BoardTableView> {
    return (
      readBoardTable(this.doc, undefined, this.selectedIds) ?? {
        id: this.doc.id,
        title: this.doc.title,
        pages: [],
        text: '',
      }
    )
  }

  async readPage(pageRef?: string): Promise<BoardTableView | null> {
    return readBoardTable(this.doc, pageRef ?? this.activePageId, this.selectedIds)
  }

  async captureCurrentPagePng(maxEdge = 1600): Promise<CapturedPagePng | null> {
    const rendered = renderPageToSvg(this.doc, this.activePageId, this.getAllResourceDataUrls(), 48)
    if (!rendered) return null
    const png = await renderSvgToPngBytes(rendered.svg, rendered.width, rendered.height, maxEdge)
    if (!png) return null
    return {
      base64: uint8ToBase64(png.bytes),
      mime: 'image/png',
      width: png.width,
      height: png.height,
    }
  }

  async applyOps(
    ops: readonly Record<string, unknown>[],
    options: { defaultPageId?: string } = {},
  ): Promise<EditPlanResult> {
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: options.defaultPageId ?? this.activePageId,
      mode: 'all_or_nothing',
    })
    if (res.ok && res.changed) {
      this.commitDocument(res.doc, { isAiStep: true })
    }
    return res
  }

  async applyTemplate(
    template: Record<string, unknown>,
  ): Promise<{ ok: true; result: TemplateApplyResult } | { ok: false; error: EditError }> {
    const res = wasmApplyTemplate(this.doc, template, this.activePageId)
    if (res.ok) {
      const nextPageId = res.result.createdPageIds[0] ?? this.activePageId
      this.commitDocument(res.result.doc, { isAiStep: true, nextPageId })
    }
    return res
  }

  async insertImage(input: InsertImageInput): Promise<InsertImageResult> {
    try {
      const { resourceId, meta } = this.addImageResource(input.bytes)
      const maxW = 480
      const scale = meta.width > maxW ? maxW / meta.width : 1
      const width = input.width ?? Math.max(80, Math.round(meta.width * scale))
      const height = input.height ?? Math.max(60, Math.round(meta.height * scale))
      const op: Record<string, unknown> = {
        op: 'add',
        kind: 'image',
        resourceId,
        width,
        height,
        ...(input.alt ? { alt: input.alt } : {}),
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
      }
      const res = planBoardEdit(this.doc, [op], {
        defaultPageId: this.activePageId,
        mode: 'all_or_nothing',
      })
      if (!res.ok) {
        return { ok: false, error: res.failures?.[0]?.error?.message ?? 'failed to insert image' }
      }
      this.commitDocument(res.doc, { isAiStep: true })
      return { ok: true, objectId: res.created[0]!, resourceId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---- Convenience editor mutations (each = 1 undo step) ----

  addObject(op: Record<string, unknown>): BoardObject | null {
    const res = planBoardEdit(this.doc, [{ op: 'add', ...op }], {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok) return null
    this.commitDocument(res.doc)
    const createdId = res.created[0]
    if (createdId) this.selectedIds = [createdId]
    this.emit()
    return this.doc.objects.find((o) => o.id === createdId) ?? null
  }

  updateObject(id: string, patch: Record<string, unknown>): boolean {
    const res = planBoardEdit(this.doc, [{ op: 'update', id, ...patch }], {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return false
    this.commitDocument(res.doc)
    return true
  }

  deleteSelected(): boolean {
    if (this.selectedIds.length === 0) return false
    const ops = this.selectedIds.map((id) => ({ op: 'delete', id }))
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return false
    this.commitDocument(res.doc)
    return true
  }

  addPage(format: PageFormat = 'freeform', title = ''): Page | null {
    const res = planBoardEdit(
      this.doc,
      [{ op: 'add_page', format, title, afterPageId: this.activePageId }],
      { defaultPageId: this.activePageId, mode: 'all_or_nothing' },
    )
    if (!res.ok) return null
    const pid = res.created[0]
    this.commitDocument(res.doc, { nextPageId: pid })
    return this.doc.pages.find((p) => p.id === pid) ?? null
  }

  deletePage(pageId: string): boolean {
    const res = planBoardEdit(this.doc, [{ op: 'delete_page', pageId }], {
      mode: 'all_or_nothing',
    })
    if (!res.ok) return false
    this.commitDocument(res.doc)
    return true
  }

  setPageFormat(pageId: string, format: PageFormat): boolean {
    const res = planBoardEdit(this.doc, [{ op: 'set_page_format', pageId, format }], {
      mode: 'all_or_nothing',
    })
    if (!res.ok) return false
    this.commitDocument(res.doc)
    return true
  }

  renamePage(pageId: string, title: string): boolean {
    const res = planBoardEdit(this.doc, [{ op: 'rename_page', pageId, title }], {
      mode: 'all_or_nothing',
    })
    if (!res.ok) return false
    this.commitDocument(res.doc)
    return true
  }

  /** Executes a batch of editor operations as a single user undo step. */
  applyUserOps(
    ops: readonly Record<string, unknown>[],
    options: { defaultPageId?: string; selectIds?: readonly string[] } = {},
  ): EditPlanResult {
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: options.defaultPageId ?? this.activePageId,
      mode: 'all_or_nothing',
    })
    if (res.ok && res.changed) {
      this.commitDocument(res.doc)
      if (options.selectIds) {
        this.selectedIds = [...new Set(options.selectIds)]
        this.emit()
      }
    }
    return res
  }

  /** Applies a declarative template as a single user undo step (never marked as an AI step). */
  applyUserTemplate(
    template: Record<string, unknown>,
  ): { ok: true; result: TemplateApplyResult } | { ok: false; error: EditError } {
    const res = wasmApplyTemplate(this.doc, template, this.activePageId)
    if (res.ok) {
      const nextPageId = res.result.createdPageIds[0] ?? this.activePageId
      this.commitDocument(res.result.doc, { nextPageId })
    }
    return res
  }

  /** Inserts a user-supplied raster image (file pick / drop / clipboard paste) as a user undo step. */
  async insertUserImage(input: InsertImageInput): Promise<InsertImageResult> {
    try {
      const { resourceId, meta } = this.addImageResource(input.bytes)
      const maxW = 480
      const scale = meta.width > maxW ? maxW / meta.width : 1
      const width = input.width ?? Math.max(80, Math.round(meta.width * scale))
      const height = input.height ?? Math.max(60, Math.round(meta.height * scale))
      const op: Record<string, unknown> = {
        op: 'add',
        kind: 'image',
        resourceId,
        width,
        height,
        ...(input.alt ? { alt: input.alt } : {}),
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
      }
      const res = planBoardEdit(this.doc, [op], {
        defaultPageId: this.activePageId,
        mode: 'all_or_nothing',
      })
      if (!res.ok) {
        return { ok: false, error: res.failures?.[0]?.error?.message ?? 'failed to insert image' }
      }
      this.commitDocument(res.doc)
      if (res.created[0]) {
        this.selectedIds = [res.created[0]]
        this.emit()
      }
      return { ok: true, objectId: res.created[0]!, resourceId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Updates the board document title in a single undo step. */
  setTitle(title: string): boolean {
    const trimmed = title.trim()
    if (trimmed === this.doc.title) return false
    const nextDoc = structuredClone(this.doc)
    nextDoc.title = trimmed
    this.commitDocument(nextDoc)
    return true
  }

  /** Updates multiple objects atomically in a single user undo step. */
  updateObjectsBatch(
    updates: ReadonlyArray<{ id: string; patch: Record<string, unknown> }>,
  ): boolean {
    if (updates.length === 0) return false
    const ops = updates.map(({ id, patch }) => ({ op: 'update', id, ...patch }))
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return false
    this.commitDocument(res.doc)
    return true
  }

  /** Deletes an explicit list of object IDs in a single user undo step. */
  deleteObjects(ids: readonly string[]): boolean {
    const unique = [...new Set(ids)].filter((id) => this.doc.objects.some((o) => o.id === id))
    if (unique.length === 0) return false
    const ops = unique.map((id) => ({ op: 'delete', id }))
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return false
    this.commitDocument(res.doc)
    return true
  }

  /** Updates a table object via the engine's `tablePatch` in a single undo step. */
  updateTable(
    id: string,
    tablePatch: {
      rows?: number
      cols?: number
      headerRow?: boolean
      fontSize?: number
      cells?: Array<{ row: number; col: number; text: string }>
    },
  ): boolean {
    return this.updateObject(id, { tablePatch })
  }

  /** Toggles or sets `locked` extra metadata on the given object IDs in a single undo step. */
  toggleLock(ids: readonly string[], locked?: boolean): boolean {
    const idSet = new Set(ids)
    const targets = this.doc.objects.filter((o) => idSet.has(o.id))
    if (targets.length === 0) return false
    const nextLocked = locked ?? !targets.every((o) => o.locked === true)
    const nextDoc = structuredClone(this.doc)
    let changed = false
    for (const o of nextDoc.objects) {
      if (!idSet.has(o.id)) continue
      if (nextLocked) {
        if (o.locked !== true) {
          o.locked = true
          changed = true
        }
      } else if ('locked' in o) {
        delete o.locked
        changed = true
      }
    }
    if (!changed) return false
    this.commitDocument(nextDoc)
    return true
  }

  /** Assigns a fresh shared `groupId` to 2+ objects on the active page. */
  groupObjects(ids: readonly string[]): string | null {
    const unique = [...new Set(ids)].filter((id) =>
      this.doc.objects.some((o) => o.id === id && o.pageId === this.activePageId),
    )
    if (unique.length < 2) return null
    const groupId = `grp-${crypto.randomUUID().slice(0, 8)}`
    const ops = unique.map((id) => ({ op: 'update', id, groupId }))
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return null
    this.commitDocument(res.doc)
    this.selectedIds = unique
    this.emit()
    return groupId
  }

  /** Clears `groupId` from all given objects in a single undo step. */
  ungroupObjects(ids: readonly string[]): boolean {
    const unique = [...new Set(ids)].filter((id) => {
      const o = this.doc.objects.find((x) => x.id === id)
      return Boolean(o?.groupId)
    })
    if (unique.length === 0) return false
    const ops = unique.map((id) => ({ op: 'update', id, groupId: null }))
    const res = planBoardEdit(this.doc, ops, {
      defaultPageId: this.activePageId,
      mode: 'all_or_nothing',
    })
    if (!res.ok || !res.changed) return false
    this.commitDocument(res.doc)
    return true
  }

  /** Adjusts z-order for one or more objects on the active page in a single undo step. */
  stepLayerOrder(
    ids: readonly string[],
    direction: 'front' | 'forward' | 'backward' | 'back',
  ): boolean {
    const idSet = new Set(ids)
    const pageObjs = this.doc.objects
      .filter((o) => o.pageId === this.activePageId)
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
    const selected = pageObjs.filter((o) => idSet.has(o.id))
    if (selected.length === 0 || selected.length === pageObjs.length) return false

    let reordered: BoardObject[]
    if (direction === 'front') {
      const rest = pageObjs.filter((o) => !idSet.has(o.id))
      reordered = [...rest, ...selected]
    } else if (direction === 'back') {
      const rest = pageObjs.filter((o) => !idSet.has(o.id))
      reordered = [...selected, ...rest]
    } else if (direction === 'forward') {
      reordered = [...pageObjs]
      for (let i = reordered.length - 2; i >= 0; i -= 1) {
        if (idSet.has(reordered[i]!.id) && !idSet.has(reordered[i + 1]!.id)) {
          const tmp = reordered[i]!
          reordered[i] = reordered[i + 1]!
          reordered[i + 1] = tmp
        }
      }
    } else {
      reordered = [...pageObjs]
      for (let i = 1; i < reordered.length; i += 1) {
        if (idSet.has(reordered[i]!.id) && !idSet.has(reordered[i - 1]!.id)) {
          const tmp = reordered[i]!
          reordered[i] = reordered[i - 1]!
          reordered[i - 1] = tmp
        }
      }
    }

    const changedOrder = reordered.some((o, i) => o.id !== pageObjs[i]!.id)
    if (!changedOrder) return false

    const nextDoc = structuredClone(this.doc)
    const keyMap = new Map<string, string>()
    let prevKey: string | null = null
    for (const o of reordered) {
      const k = orderBetween(prevKey, null)
      keyMap.set(o.id, k)
      prevKey = k
    }
    for (const o of nextDoc.objects) {
      const k = keyMap.get(o.id)
      if (k) o.orderKey = k
    }
    this.commitDocument(nextDoc)
    return true
  }

  /** Clones a list of objects onto the active page with offset, remapping connector anchors & groups. */
  pasteObjects(
    sourceObjects: readonly BoardObject[],
    offset: Point = { x: 28, y: 28 },
  ): BoardObject[] {
    if (sourceObjects.length === 0) return []
    const nextDoc = structuredClone(this.doc)
    const idMap = new Map<string, string>()
    const groupMap = new Map<string, string>()

    const usedIds = new Set<string>([
      ...nextDoc.pages.map((p) => p.id),
      ...nextDoc.objects.map((o) => o.id),
    ])
    const makeId = (): string => {
      for (;;) {
        const candidate = `obj-${crypto.randomUUID().slice(0, 8)}`
        if (!usedIds.has(candidate)) {
          usedIds.add(candidate)
          return candidate
        }
      }
    }

    // Filter out images whose resource is missing from this document.
    const validSources = sourceObjects.filter((o) => {
      if (o.kind === 'image') {
        const rid = (o.props as { resourceId?: string }).resourceId
        return Boolean(rid && nextDoc.resources[rid])
      }
      return true
    })
    if (validSources.length === 0) return []

    for (const src of validSources) {
      idMap.set(src.id, makeId())
      if (src.groupId && !groupMap.has(src.groupId)) {
        groupMap.set(src.groupId, `grp-${crypto.randomUUID().slice(0, 8)}`)
      }
    }

    let lastKey =
      nextDoc.objects
        .filter((o) => o.pageId === this.activePageId)
        .map((o) => o.orderKey)
        .sort()
        .at(-1) ?? null

    const createdIds: string[] = []
    for (const src of validSources) {
      const clone = structuredClone(src)
      const newId = idMap.get(src.id)!
      lastKey = orderBetween(lastKey, null)
      clone.id = newId
      clone.pageId = this.activePageId
      clone.orderKey = lastKey
      if (clone.groupId) clone.groupId = groupMap.get(clone.groupId)
      delete clone.locked

      if (clone.kind === 'connector') {
        const cp = clone.props as unknown as ConnectorProps
        const remapEnd = (end: ConnectorEnd): ConnectorEnd => {
          if ('objectId' in end) {
            const mapped = idMap.get(end.objectId)
            if (mapped) return { ...end, objectId: mapped }
            // Keep attachment if target exists on active page, otherwise convert to shifted point.
            const existingTarget = this.doc.objects.find(
              (o) => o.id === end.objectId && o.pageId === this.activePageId,
            )
            if (existingTarget) {
              return {
                x: Math.round(
                  existingTarget.x + existingTarget.width * (end.anchorX ?? 0.5) + offset.x,
                ),
                y: Math.round(
                  existingTarget.y + existingTarget.height * (end.anchorY ?? 0.5) + offset.y,
                ),
              }
            }
            return { x: offset.x, y: offset.y }
          }
          return { x: end.x + offset.x, y: end.y + offset.y }
        }
        cp.start = remapEnd(cp.start)
        cp.end = remapEnd(cp.end)
        if (cp.waypoints) {
          cp.waypoints = cp.waypoints.map((pt) => ({ x: pt.x + offset.x, y: pt.y + offset.y }))
        }
      } else {
        clone.x = Math.round(clone.x + offset.x)
        clone.y = Math.round(clone.y + offset.y)
      }

      nextDoc.objects.push(clone)
      createdIds.push(newId)
    }

    this.commitDocument(nextDoc)
    this.selectedIds = createdIds
    this.emit()
    return this.doc.objects.filter((o) => createdIds.includes(o.id))
  }

  /** Duplicates the given object IDs on the active page in a single undo step. */
  duplicateObjects(ids: readonly string[], offset: Point = { x: 28, y: 28 }): BoardObject[] {
    const idSet = new Set(ids)
    const sources = this.doc.objects
      .filter((o) => o.pageId === this.activePageId && idSet.has(o.id))
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
    return this.pasteObjects(sources, offset)
  }

  /** Duplicates a page along with all of its objects (remapping IDs, connectors, and groups). */
  duplicatePage(pageId: string): Page | null {
    const pageIdx = this.doc.pages.findIndex((p) => p.id === pageId)
    if (pageIdx < 0) return null
    const srcPage = this.doc.pages[pageIdx]!
    const nextDoc = structuredClone(this.doc)
    const newPageId = `page-${crypto.randomUUID().slice(0, 8)}`
    const afterKey = nextDoc.pages[pageIdx + 1]?.orderKey ?? null
    const newOrderKey = orderBetween(srcPage.orderKey, afterKey)

    const newPage: Page = {
      ...structuredClone(srcPage),
      id: newPageId,
      title: srcPage.title ? `${srcPage.title} (2)` : '',
      orderKey: newOrderKey,
    }
    nextDoc.pages.splice(pageIdx + 1, 0, newPage)

    const pageObjs = nextDoc.objects.filter((o) => o.pageId === pageId)
    const idMap = new Map<string, string>()
    const groupMap = new Map<string, string>()
    for (const o of pageObjs) {
      idMap.set(o.id, `obj-${crypto.randomUUID().slice(0, 8)}`)
      if (o.groupId && !groupMap.has(o.groupId)) {
        groupMap.set(o.groupId, `grp-${crypto.randomUUID().slice(0, 8)}`)
      }
    }
    for (const o of pageObjs) {
      const clone = structuredClone(o)
      clone.id = idMap.get(o.id)!
      clone.pageId = newPageId
      if (clone.groupId) clone.groupId = groupMap.get(clone.groupId)
      if (clone.kind === 'connector') {
        const cp = clone.props as unknown as ConnectorProps
        if ('objectId' in cp.start && idMap.has(cp.start.objectId)) {
          cp.start = { ...cp.start, objectId: idMap.get(cp.start.objectId)! }
        }
        if ('objectId' in cp.end && idMap.has(cp.end.objectId)) {
          cp.end = { ...cp.end, objectId: idMap.get(cp.end.objectId)! }
        }
      }
      nextDoc.objects.push(clone)
    }

    this.commitDocument(nextDoc, { nextPageId: newPageId })
    return this.doc.pages.find((p) => p.id === newPageId) ?? null
  }

  /** Moves a page to a new index in the document in a single undo step. */
  reorderPage(pageId: string, toIndex: number): boolean {
    const fromIdx = this.doc.pages.findIndex((p) => p.id === pageId)
    if (fromIdx < 0) return false
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, toIndex))
    if (fromIdx === clamped) return false
    const nextDoc = structuredClone(this.doc)
    const [moved] = nextDoc.pages.splice(fromIdx, 1)
    nextDoc.pages.splice(clamped, 0, moved!)
    let prevKey: string | null = null
    for (const p of nextDoc.pages) {
      const k = orderBetween(prevKey, null)
      p.orderKey = k
      prevKey = k
    }
    this.commitDocument(nextDoc)
    return true
  }

  /** Sets a page's background grid mode (dot, line, or blank solid) while preserving image backgrounds. */
  setPageGridMode(pageId: string, mode: 'dot' | 'line' | 'blank'): boolean {
    const page = this.doc.pages.find((p) => p.id === pageId)
    if (!page || page.background.kind === 'image') return false
    const nextDoc = structuredClone(this.doc)
    const target = nextDoc.pages.find((p) => p.id === pageId)!
    const color =
      target.background.kind === 'solid' || target.background.kind === 'grid'
        ? target.background.color
        : '#FFFFFF'
    if (mode === 'blank') {
      target.background = { kind: 'solid', color } as PageBackground
      target.gridHidden = true
    } else {
      target.background = { kind: 'grid', color, pattern: mode } as PageBackground
      delete target.gridHidden
    }
    this.commitDocument(nextDoc)
    return true
  }
}
