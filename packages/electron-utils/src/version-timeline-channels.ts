/**
 * Preload-safe IPC channel constants and plain-data types for the persistent
 * visual-editor Version Timeline (`html`, `slides`, `whiteboard`).
 * Zero Node/Electron imports here so preloads can bundle it safely.
 */

export const VERSION_TIMELINE_BRIDGE_KEY = 'aiOfficeVersionTimeline'

export const VERSION_TIMELINE_CHANNELS = {
  list: 'version-timeline:list',
  record: 'version-timeline:record',
  readSnapshot: 'version-timeline:read-snapshot',
  deleteEntry: 'version-timeline:delete-entry',
  clearAll: 'version-timeline:clear-all',
  getStats: 'version-timeline:get-stats',
} as const

export type VersionSource = 'ai' | 'save' | 'checkpoint' | 'restore'
export type TimelineEditorKind = 'html' | 'slides' | 'whiteboard'

export interface VersionEntry {
  readonly id: string
  readonly docKey: string
  readonly source: VersionSource
  readonly createdAt: string
  readonly contentHash: string
  readonly byteSize: number
  readonly promptSummary?: string | undefined
  readonly label?: string | undefined
  readonly changeSummary?: string | undefined
  readonly snapshotFile?: string | undefined
}

export interface VersionTimelineStats {
  readonly totalBytes: number
  readonly docCount: number
  readonly entryCount: number
}

export interface RecordVersionInput {
  readonly docKey: string
  readonly editorKind: TimelineEditorKind
  readonly source: VersionSource
  readonly content: string | Uint8Array
  readonly ext: string
  readonly promptSummary?: string | undefined
  readonly label?: string | undefined
  readonly changeSummary?: string | undefined
  /** Encrypted documents (e.g. password-protected `.pptx`) are never written to disk */
  readonly encrypted?: boolean | undefined
}

export type RecordVersionResult =
  | { readonly ok: true; readonly entry: VersionEntry }
  | {
      readonly ok: false
      readonly skipped: true
      readonly reason: 'unchanged' | 'encrypted' | 'too-large' | 'invalid'
      readonly entry?: VersionEntry | undefined
    }

export interface VersionTimelineBridge {
  list(docKey: string): Promise<VersionEntry[]>
  record(input: RecordVersionInput): Promise<RecordVersionResult>
  readSnapshot(docKey: string, id: string): Promise<Uint8Array | string | null>
  deleteEntry(docKey: string, id: string): Promise<boolean>
  clearAll(): Promise<boolean>
  getStats(): Promise<VersionTimelineStats>
}
