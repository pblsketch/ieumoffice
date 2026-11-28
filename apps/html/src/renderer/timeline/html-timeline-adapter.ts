/**
 * Persistent Version Timeline adapter for the HTML editor (T13).
 * Snapshots are stored strictly via `<userData>/version-timeline/` IPC — never
 * inside user folders or the HTML file itself. Restores return a single atomic
 * `Patch` so Ctrl+Z undoes a restore in one step.
 */
import type {
  VersionEntry,
  VersionSource,
  VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'
import type { Patch } from '../document/patch'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export interface HtmlTimelineTarget {
  docKey: string
  getHtml(): string
  applyRestorePatch(patch: Patch): void
}

export class HtmlTimelineAdapter {
  constructor(
    private readonly bridge: VersionTimelineBridge | undefined,
    private readonly target: HtmlTimelineTarget,
  ) {}

  async list(): Promise<VersionEntry[]> {
    if (!this.bridge) return []
    return this.bridge.list(this.target.docKey)
  }

  async record(
    source: VersionSource,
    meta: { promptSummary?: string; label?: string; changeSummary?: string } = {},
  ): Promise<VersionEntry | null> {
    if (!this.bridge) return null
    const bytes = encoder.encode(this.target.getHtml())
    const res = await this.bridge.record({
      docKey: this.target.docKey,
      editorKind: 'html',
      source,
      content: bytes,
      ext: '.html',
      ...meta,
    })
    return res.ok && res.entry ? res.entry : null
  }

  async preview(entryId: string): Promise<string | null> {
    if (!this.bridge) return null
    const raw = await this.bridge.readSnapshot(this.target.docKey, entryId)
    if (!raw) return null
    return typeof raw === 'string' ? raw : decoder.decode(raw)
  }

  async restore(entryId: string): Promise<boolean> {
    if (!this.bridge) return false
    const snapshot = await this.bridge.readSnapshot(this.target.docKey, entryId)
    if (!snapshot) return false
    const currentHtml = this.target.getHtml()
    // Record safety point right before restoring
    await this.bridge.record({
      docKey: this.target.docKey,
      editorKind: 'html',
      source: 'restore',
      content: encoder.encode(currentHtml),
      ext: '.html',
      changeSummary: 'Before restore',
    })
    const restoredHtml = typeof snapshot === 'string' ? snapshot : decoder.decode(snapshot)
    const patch: Patch = { from: 0, to: currentHtml.length, text: restoredHtml }
    this.target.applyRestorePatch(patch)
    return true
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    if (!this.bridge) return false
    return this.bridge.deleteEntry(this.target.docKey, entryId)
  }
}
