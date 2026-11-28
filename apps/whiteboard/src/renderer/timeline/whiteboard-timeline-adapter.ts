/**
 * Persistent Version Timeline adapter for Whiteboard (T13).
 * Stores UTF-8 JSON snapshots of `BoardDocument` in `<userData>/version-timeline/`,
 * restores via `session.commitDocument` as a single undoable step, and renders
 * read-only SVG previews through `renderPageToSvg`.
 */
import type {
  VersionEntry,
  VersionSource,
  VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import { renderPageToSvg } from '../export/render-svg'
import type { WhiteboardSession } from '../document/session'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export class WhiteboardTimelineAdapter {
  constructor(
    private readonly bridge: VersionTimelineBridge | undefined,
    private readonly docKey: string,
    private readonly getSession: () => WhiteboardSession | null,
  ) {}

  async list(): Promise<VersionEntry[]> {
    if (!this.bridge) return []
    return this.bridge.list(this.docKey)
  }

  async record(
    source: VersionSource,
    meta: { promptSummary?: string; label?: string; changeSummary?: string } = {},
  ): Promise<VersionEntry | null> {
    const session = this.getSession()
    if (!this.bridge || !session) return null
    const doc = session.getDocument()
    const bytes = encoder.encode(JSON.stringify(doc))
    const summary = meta.changeSummary ?? `${doc.pages.length}p · ${doc.objects.length} obj`
    const res = await this.bridge.record({
      docKey: this.docKey,
      editorKind: 'whiteboard',
      source,
      content: bytes,
      ext: '.json',
      changeSummary: summary,
      ...(meta.promptSummary ? { promptSummary: meta.promptSummary } : {}),
      ...(meta.label ? { label: meta.label } : {}),
    })
    return res.ok && res.entry ? res.entry : null
  }

  async previewSvg(entryId: string): Promise<string | null> {
    const session = this.getSession()
    if (!this.bridge || !session) return null
    const raw = await this.bridge.readSnapshot(this.docKey, entryId)
    if (!raw) return null
    try {
      const jsonText = typeof raw === 'string' ? raw : decoder.decode(raw)
      const doc = JSON.parse(jsonText) as BoardDocument
      const page = doc.pages[0]
      if (!page) return null
      const rendered = renderPageToSvg(doc, page.id, session.getAllResourceDataUrls())
      return rendered?.svg ?? null
    } catch {
      return null
    }
  }

  async restore(entryId: string): Promise<boolean> {
    const session = this.getSession()
    if (!this.bridge || !session) return false
    const raw = await this.bridge.readSnapshot(this.docKey, entryId)
    if (!raw) return false
    let restored: BoardDocument
    try {
      const jsonText = typeof raw === 'string' ? raw : decoder.decode(raw)
      restored = JSON.parse(jsonText) as BoardDocument
    } catch {
      return false
    }
    await this.record('restore', { changeSummary: 'Before restore' })
    session.commitDocument(restored)
    return true
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    if (!this.bridge) return false
    return this.bridge.deleteEntry(this.docKey, entryId)
  }
}
