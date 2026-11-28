/**
 * Persistent Version Timeline adapter for Slides (T13).
 * Security invariant: password-protected / encrypted `.pptx` decks
 * (`encrypted === true`) NEVER write plaintext snapshots to disk IPC — they
 * stay strictly in tab-local memory until the tab closes.
 */
import type {
  VersionEntry,
  VersionSource,
  VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'

const MAX_MEMORY_ENTRIES = 30

export interface SlidesTimelineSnapshot {
  /** Serialized JSON representation of deck summary/state or pptx bytes */
  bytes: Uint8Array
  slideCount: number
  titleSummary?: string
}

export interface SlidesTimelineTarget {
  docKey: string
  isEncrypted(): boolean
  captureSnapshot(): Promise<SlidesTimelineSnapshot> | SlidesTimelineSnapshot
  applySnapshot(bytes: Uint8Array): Promise<boolean> | boolean
  formatSlideCount?: (count: number) => string
  beforeRestoreLabel?: () => string
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Lightweight deterministic fallback in environments without WebCrypto
  let h = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export class SlidesTimelineAdapter {
  private readonly memoryEntries: VersionEntry[] = []
  private readonly memoryPayloads = new Map<string, Uint8Array>()

  constructor(
    private readonly bridge: VersionTimelineBridge | undefined,
    private readonly target: SlidesTimelineTarget,
  ) {}

  get isMemoryOnly(): boolean {
    return this.target.isEncrypted() || !this.bridge
  }

  async list(): Promise<VersionEntry[]> {
    if (this.target.isEncrypted() || !this.bridge) {
      return [...this.memoryEntries].reverse()
    }
    return this.bridge.list(this.target.docKey)
  }

  async record(
    source: VersionSource,
    meta: { promptSummary?: string; label?: string; changeSummary?: string } = {},
  ): Promise<VersionEntry | null> {
    const snap = await this.target.captureSnapshot()
    if (snap.bytes.byteLength === 0) return null
    const summary =
      meta.changeSummary ??
      (this.target.formatSlideCount
        ? this.target.formatSlideCount(snap.slideCount)
        : `${snap.slideCount} slides`)

    if (this.target.isEncrypted() || !this.bridge) {
      const contentHash = await sha256Hex(snap.bytes)
      const latest = this.memoryEntries.at(-1)
      if (source === 'save' && latest && latest.contentHash === contentHash) {
        return null
      }
      const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry: VersionEntry = {
        id,
        docKey: this.target.docKey,
        source,
        createdAt: new Date().toISOString(),
        contentHash,
        byteSize: snap.bytes.byteLength,
        ...(meta.promptSummary ? { promptSummary: meta.promptSummary.slice(0, 300) } : {}),
        ...(meta.label ? { label: meta.label } : {}),
        changeSummary: summary,
      }
      this.memoryEntries.push(entry)
      this.memoryPayloads.set(id, new Uint8Array(snap.bytes))
      while (this.memoryEntries.length > MAX_MEMORY_ENTRIES) {
        const evicted = this.memoryEntries.shift()
        if (evicted) this.memoryPayloads.delete(evicted.id)
      }
      return entry
    }

    const res = await this.bridge.record({
      docKey: this.target.docKey,
      editorKind: 'slides',
      source,
      content: snap.bytes,
      ext: '.pptx',
      encrypted: false,
      changeSummary: summary,
      ...(meta.promptSummary ? { promptSummary: meta.promptSummary } : {}),
      ...(meta.label ? { label: meta.label } : {}),
    })
    return res.ok && res.entry ? res.entry : null
  }

  async readSnapshot(entryId: string): Promise<Uint8Array | null> {
    if (this.target.isEncrypted() || !this.bridge) {
      return this.memoryPayloads.get(entryId) ?? null
    }
    const raw = await this.bridge.readSnapshot(this.target.docKey, entryId)
    if (!raw) return null
    return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
  }

  async restore(entryId: string): Promise<boolean> {
    const bytes = await this.readSnapshot(entryId)
    if (!bytes) return false
    await this.record('restore', {
      changeSummary: this.target.beforeRestoreLabel?.() ?? 'Before restore',
    })
    return this.target.applySnapshot(bytes)
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    if (this.target.isEncrypted() || !this.bridge) {
      const idx = this.memoryEntries.findIndex((e) => e.id === entryId)
      if (idx < 0) return false
      this.memoryEntries.splice(idx, 1)
      this.memoryPayloads.delete(entryId)
      return true
    }
    return this.bridge.deleteEntry(this.target.docKey, entryId)
  }
}
