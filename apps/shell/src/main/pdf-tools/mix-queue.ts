/**
 * Background conversion queue for mixed-file PDF merge (PDF tools v2, spec 4.2 L).
 *
 * When a user adds images or non-PDF documents to the Merge tool, each non-PDF
 * item is converted in the background to a temporary PDF under
 * `<tmpdir>/ieumoffice-pdf-tools-mix/` so the UI can show its page count, first
 * thumbnail, and enable per-file page-range selection before the user clicks Run.
 *
 * Lifecycle guarantee: temporary PDFs are removed immediately when an item is
 * removed, when the user leaves the tool or closes the window, and any orphaned
 * files older than 24 hours are swept when the window starts.
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePdfAtomically } from '../../../../pdf/src/main/atomic-write'
import type { PdfMixStatusEvent } from '../../shared/pdf-tools-api'

export const MIX_TEMP_DIR_NAME = 'ieumoffice-pdf-tools-mix'
export const MIX_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function mixTempRoot(baseTmpDir = tmpdir()): string {
  return join(baseTmpDir, MIX_TEMP_DIR_NAME)
}

/** Delete temp files in `<baseTmpDir>/ieumoffice-pdf-tools-mix` older than `maxAgeMs` (24h default). */
export async function sweepOrphanMixFiles(
  baseTmpDir = tmpdir(),
  now = Date.now(),
  maxAgeMs = MIX_ORPHAN_MAX_AGE_MS,
): Promise<number> {
  const root = mixTempRoot(baseTmpDir)
  let removed = 0
  try {
    const entries = await readdir(root)
    for (const name of entries) {
      const full = join(root, name)
      try {
        const info = await stat(full)
        if (now - info.mtimeMs > maxAgeMs) {
          await rm(full, { recursive: true, force: true })
          removed++
        }
      } catch {
        // ignore race with concurrent cleanup
      }
    }
  } catch {
    // directory does not exist yet
  }
  return removed
}

export interface MixQueueEntry {
  inputId: string
  kind: 'image' | 'document'
  sourcePath: string
  state: 'pending' | 'converting' | 'ready' | 'error'
  pdfPath: string
  pages?: number
  thumb?: string | null
  error?: string
}

export interface MixQueueDeps {
  tempRoot?: string
  convertDocument(
    inputPath: string,
    outPath: string,
    signal: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  convertImage(inputPath: string, signal: AbortSignal): Promise<Uint8Array>
  inspectPdfPages(pdfPath: string): Promise<number>
  renderFirstThumb?: (pdfPath: string) => Promise<string | null>
  onStatus(ev: PdfMixStatusEvent): void
}

export interface MixQueue {
  enqueue(inputId: string, kind: 'image' | 'document', sourcePath: string): void
  get(inputId: string): MixQueueEntry | undefined
  hasActive(): boolean
  remove(inputId: string): Promise<void>
  clearAll(): Promise<void>
  /** resolves when all currently queued items have finished (for tests) */
  whenIdle(): Promise<void>
}

export function createMixQueue(deps: MixQueueDeps): MixQueue {
  const root = deps.tempRoot ?? mixTempRoot()
  const entries = new Map<string, MixQueueEntry>()
  const pendingIds: string[] = []
  let activeId: string | null = null
  let activeAbort: AbortController | null = null
  let draining = false
  let idleWaiters: Array<() => void> = []

  const notifyIdle = (): void => {
    if (draining || pendingIds.length > 0) return
    const list = idleWaiters
    idleWaiters = []
    for (const fn of list) fn()
  }

  async function processOne(entry: MixQueueEntry): Promise<void> {
    const controller = new AbortController()
    activeId = entry.inputId
    activeAbort = controller
    entry.state = 'converting'
    deps.onStatus({ inputId: entry.inputId, state: 'converting' })

    try {
      await mkdir(root, { recursive: true })
      if (controller.signal.aborted) return

      if (entry.kind === 'image') {
        const pdfBytes = await deps.convertImage(entry.sourcePath, controller.signal)
        if (controller.signal.aborted) return
        await writePdfAtomically(entry.pdfPath, pdfBytes)
      } else {
        const res = await deps.convertDocument(entry.sourcePath, entry.pdfPath, controller.signal)
        if (controller.signal.aborted) return
        if (!res.ok) throw new Error(res.error)
      }

      if (controller.signal.aborted || !entries.has(entry.inputId)) {
        await rm(entry.pdfPath, { force: true }).catch(() => {})
        return
      }

      const pages = await deps.inspectPdfPages(entry.pdfPath)
      const thumb = deps.renderFirstThumb
        ? await deps.renderFirstThumb(entry.pdfPath).catch(() => null)
        : null

      if (controller.signal.aborted || !entries.has(entry.inputId)) {
        await rm(entry.pdfPath, { force: true }).catch(() => {})
        return
      }

      entry.state = 'ready'
      entry.pages = pages
      entry.thumb = thumb
      deps.onStatus({ inputId: entry.inputId, state: 'ready', pages, thumb })
    } catch (err) {
      await rm(entry.pdfPath, { force: true }).catch(() => {})
      if (controller.signal.aborted || !entries.has(entry.inputId)) return
      const message = err instanceof Error ? err.message : String(err)
      entry.state = 'error'
      entry.error = message
      deps.onStatus({ inputId: entry.inputId, state: 'error', error: message })
    } finally {
      if (activeId === entry.inputId) {
        activeId = null
        activeAbort = null
      }
    }
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (pendingIds.length > 0) {
        const nextId = pendingIds.shift()!
        const entry = entries.get(nextId)
        if (!entry || entry.state !== 'pending') continue
        await processOne(entry)
      }
    } finally {
      draining = false
      notifyIdle()
    }
  }

  return {
    enqueue(inputId, kind, sourcePath) {
      const safeId = inputId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const entry: MixQueueEntry = {
        inputId,
        kind,
        sourcePath,
        state: 'pending',
        pdfPath: join(root, `${safeId}.pdf`),
      }
      entries.set(inputId, entry)
      pendingIds.push(inputId)
      deps.onStatus({ inputId, state: 'pending' })
      void drain()
    },

    get(inputId) {
      return entries.get(inputId)
    },

    hasActive() {
      for (const entry of entries.values()) {
        if (entry.state === 'pending' || entry.state === 'converting') return true
      }
      return false
    },

    async remove(inputId) {
      const entry = entries.get(inputId)
      entries.delete(inputId)
      const idx = pendingIds.indexOf(inputId)
      if (idx >= 0) pendingIds.splice(idx, 1)
      if (activeId === inputId) activeAbort?.abort()
      if (entry) await rm(entry.pdfPath, { force: true }).catch(() => {})
    },

    async clearAll() {
      pendingIds.length = 0
      activeAbort?.abort()
      const paths = [...entries.values()].map((e) => e.pdfPath)
      entries.clear()
      await Promise.all(paths.map((p) => rm(p, { force: true }).catch(() => {})))
    },

    whenIdle() {
      if (!draining && pendingIds.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
      })
    },
  }
}
