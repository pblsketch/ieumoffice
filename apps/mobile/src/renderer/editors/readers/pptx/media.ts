/**
 * Deck media as `blob:` URLs, grouped by the slides that use them.
 *
 * Each media part gets one URL per deck. A slide that resolves it becomes one of its
 * holders; releasing a slide drops that hold, and the URL is revoked only when its last
 * holder lets go (two slides sharing a picture keep one URL alive between them).
 *
 * Display-only conversions follow the PC slides app's `readSlideMedia`
 * (apps/slides/src/main/session-state.ts) where they are pure: the JPEG EXIF orientation
 * is neutralized (PowerPoint ignores it). Themed SVGs are served as stored (the PC re-tint
 * lives in a main-process module), TIFF is served as stored (the PC converts it in main),
 * and EMF/WMF are not converted: their URL carries a mark so the image loader skips them.
 * The archive bytes are never changed; the Blob is a display copy.
 */
import type { MediaResolver } from '@genoffice/pptx-render'
import { neutralizeJpegOrientation } from '../../../../../../slides/src/main/jpeg-orientation'
import { displayMime, isMetafileMime } from './mime'

/** Fragment on a metafile URL: blob lookups ignore it, the image loader reads it */
const METAFILE_MARK = '#ieum-metafile'

/** Whether a media URL is an EMF/WMF the mobile reader does not decode */
export function isMetafileUrl(url: string): boolean {
  return url.endsWith(METAFILE_MARK)
}

/** What the store reads media from: the engine archive's `readBytes` */
export interface MediaSource {
  readBytes(path: string): Uint8Array | null
}

interface MediaEntry {
  /** The URL handed to the renderer (with the metafile mark when there is one) */
  url: string
  /** The URL as created, the one to revoke */
  blobUrl: string
  holders: Set<number>
}

export interface SlideMediaStore {
  /** Resolver for one slide's render: every URL it returns is held by that slide */
  resolverFor(slideIndex: number): MediaResolver
  /** Drops the slide's holds; URLs no other slide holds are revoked */
  release(slideIndex: number): void
  /** Revokes every URL */
  dispose(): void
  /** URLs currently alive (for tests and leak checks) */
  liveUrls(): string[]
}

export function createSlideMediaStore(source: MediaSource): SlideMediaStore {
  const byRef = new Map<string, MediaEntry>()
  const bySlide = new Map<number, Set<string>>()
  let disposed = false

  const entryFor = (mediaRef: string): MediaEntry | null => {
    const known = byRef.get(mediaRef)
    if (known) return known
    const bytes = source.readBytes(mediaRef)
    if (!bytes) return null
    const mime = displayMime(mediaRef, bytes)
    const body = mime === 'image/jpeg' ? neutralizeJpegOrientation(bytes) : bytes
    const blobUrl = URL.createObjectURL(new Blob([body as Uint8Array<ArrayBuffer>], { type: mime }))
    const entry: MediaEntry = {
      url: isMetafileMime(mime) ? `${blobUrl}${METAFILE_MARK}` : blobUrl,
      blobUrl,
      holders: new Set(),
    }
    byRef.set(mediaRef, entry)
    return entry
  }

  return {
    resolverFor(slideIndex) {
      return (mediaRef) => {
        if (disposed || !mediaRef) return undefined
        const entry = entryFor(mediaRef)
        if (!entry) return undefined
        entry.holders.add(slideIndex)
        let refs = bySlide.get(slideIndex)
        if (!refs) bySlide.set(slideIndex, (refs = new Set()))
        refs.add(mediaRef)
        return entry.url
      }
    },
    release(slideIndex) {
      const refs = bySlide.get(slideIndex)
      if (!refs) return
      bySlide.delete(slideIndex)
      for (const ref of refs) {
        const entry = byRef.get(ref)
        if (!entry) continue
        entry.holders.delete(slideIndex)
        if (entry.holders.size === 0) {
          URL.revokeObjectURL(entry.blobUrl)
          byRef.delete(ref)
        }
      }
    },
    dispose() {
      disposed = true
      for (const entry of byRef.values()) URL.revokeObjectURL(entry.blobUrl)
      byRef.clear()
      bySlide.clear()
    },
    liveUrls() {
      return [...byRef.values()].map((e) => e.url)
    },
  }
}
