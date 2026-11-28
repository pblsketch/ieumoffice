/**
 * Preload-safe IPC bridge for the visual-editor Version Timeline.
 */
import { ipcRenderer } from 'electron'
import {
  VERSION_TIMELINE_CHANNELS,
  type RecordVersionInput,
  type RecordVersionResult,
  type VersionEntry,
  type VersionTimelineBridge,
  type VersionTimelineStats,
} from './version-timeline-channels'

const EMPTY_STATS: VersionTimelineStats = { totalBytes: 0, docCount: 0, entryCount: 0 }

export function versionTimelineBridge(): VersionTimelineBridge {
  return {
    list: (docKey: string) =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.list, docKey).then(
        (raw) => (Array.isArray(raw) ? (raw as VersionEntry[]) : []),
        () => [],
      ),
    record: (input: RecordVersionInput) =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.record, input).then(
        (raw): RecordVersionResult =>
          raw && typeof raw === 'object' && typeof (raw as { ok?: unknown }).ok === 'boolean'
            ? (raw as RecordVersionResult)
            : { ok: false, skipped: true, reason: 'invalid' },
        (): RecordVersionResult => ({ ok: false, skipped: true, reason: 'invalid' }),
      ),
    readSnapshot: (docKey: string, id: string) =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.readSnapshot, docKey, id).catch(() => null),
    deleteEntry: (docKey: string, id: string) =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.deleteEntry, docKey, id).then(
        (v) => v === true,
        () => false,
      ),
    clearAll: () =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.clearAll).then(
        (v) => v === true,
        () => false,
      ),
    getStats: () =>
      ipcRenderer.invoke(VERSION_TIMELINE_CHANNELS.getStats).then(
        (raw): VersionTimelineStats =>
          raw &&
          typeof raw === 'object' &&
          typeof (raw as VersionTimelineStats).totalBytes === 'number'
            ? (raw as VersionTimelineStats)
            : EMPTY_STATS,
        () => EMPTY_STATS,
      ),
  }
}
