/**
 * Lazy, concurrency-bounded document thumbnail loader for Home and Folder lists.
 *
 * Only requests thumbnails for rows that intersect the viewport (or immediately when
 * `IntersectionObserver` is unavailable). Downscales oversized image thumbnails via an
 * offscreen canvas when available and enforces both an entry-count cap (120) and a byte
 * budget (8 MiB) on the in-memory LRU cache to prevent OOM on low-RAM mobile devices.
 */
import { useEffect, useState, type RefObject } from 'react'
import {
  getHomeThumbnail,
  type FileRef,
  type ThumbnailPayload,
} from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'

const MAX_CONCURRENT = 3
const MAX_MEMORY_CACHE_ENTRIES = 120
const MAX_MEMORY_CACHE_BYTES = 8 * 1024 * 1024
const DOWNSCALE_THRESHOLD_CHARS = 180_000
const DEFAULT_THUMB_MAX_PX = 320

const NONE_THUMB: ThumbnailPayload = { kind: 'none' }

interface CacheEntry {
  readonly payload: ThumbnailPayload
  readonly approxBytes: number
}

const memoryCache = new Map<string, CacheEntry>()
let memoryCacheBytes = 0
const inFlight = new Map<string, Promise<ThumbnailPayload>>()
const queue: Array<() => void> = []
let activeCount = 0

function payloadByteSize(payload: ThumbnailPayload): number {
  if (payload.kind === 'image') return payload.dataBase64.length * 2
  if (payload.kind === 'text') return ((payload.title?.length ?? 0) + payload.snippet.length) * 2
  return 64
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()
    if (!next) break
    activeCount += 1
    next()
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1)
          pumpQueue()
        })
    })
    pumpQueue()
  })
}

function remember(key: string, payload: ThumbnailPayload): void {
  const existing = memoryCache.get(key)
  if (existing) {
    memoryCacheBytes = Math.max(0, memoryCacheBytes - existing.approxBytes)
    memoryCache.delete(key)
  }
  const approxBytes = payloadByteSize(payload)
  if (approxBytes > MAX_MEMORY_CACHE_BYTES / 2) {
    // Do not pin a single huge unscaled image in the JS LRU cache.
    return
  }
  memoryCache.set(key, { payload, approxBytes })
  memoryCacheBytes += approxBytes
  while (memoryCache.size > MAX_MEMORY_CACHE_ENTRIES || memoryCacheBytes > MAX_MEMORY_CACHE_BYTES) {
    const oldestKey = memoryCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = memoryCache.get(oldestKey)
    if (oldest) memoryCacheBytes = Math.max(0, memoryCacheBytes - oldest.approxBytes)
    memoryCache.delete(oldestKey)
  }
}

/** Downscales oversized incoming photos/covers to `<= DEFAULT_THUMB_MAX_PX` JPEG before caching. */
async function maybeDownscaleImagePayload(payload: ThumbnailPayload): Promise<ThumbnailPayload> {
  if (
    payload.kind !== 'image' ||
    payload.dataBase64.length <= DOWNSCALE_THRESHOLD_CHARS ||
    typeof document === 'undefined'
  ) {
    return payload
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return payload
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('thumbnail decode failed'))
      el.src = `data:${payload.mime};base64,${payload.dataBase64}`
    })
    const nw = Math.max(1, img.naturalWidth || DEFAULT_THUMB_MAX_PX)
    const nh = Math.max(1, img.naturalHeight || DEFAULT_THUMB_MAX_PX)
    const scale = Math.min(1, DEFAULT_THUMB_MAX_PX / Math.max(nw, nh))
    const outW = Math.max(1, Math.round(nw * scale))
    const outH = Math.max(1, Math.round(nh * scale))
    canvas.width = outW
    canvas.height = outH
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return payload
    return { kind: 'image', mime: 'image/jpeg', dataBase64: dataUrl.slice(comma + 1) }
  } catch {
    return payload
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Drops cached thumbnails from memory (used after file delete/rename or in tests). */
export function clearHomeThumbnailMemoryCache(): void {
  memoryCache.clear()
  memoryCacheBytes = 0
}

function fetchThumbnailDeduped(
  client: MobileClient,
  fileRef: FileRef,
  cacheKey: string,
): Promise<ThumbnailPayload> {
  const cached = memoryCache.get(cacheKey)
  if (cached) return Promise.resolve(cached.payload)

  const running = inFlight.get(cacheKey)
  if (running) return running

  const promise = enqueue(() =>
    getHomeThumbnail(client, fileRef, DEFAULT_THUMB_MAX_PX).catch(() => NONE_THUMB),
  )
    .then(maybeDownscaleImagePayload)
    .then((payload) => {
      remember(cacheKey, payload)
      return payload
    })
    .finally(() => {
      inFlight.delete(cacheKey)
    })

  inFlight.set(cacheKey, promise)
  return promise
}

export function useHomeThumbnail(
  client: MobileClient | null | undefined,
  fileRef: FileRef,
  cacheKey: string,
  targetRef: RefObject<HTMLElement | null>,
): ThumbnailPayload {
  const [thumb, setThumb] = useState<ThumbnailPayload>(
    () => (client ? memoryCache.get(cacheKey)?.payload : undefined) ?? NONE_THUMB,
  )
  const [visible, setVisible] = useState<boolean>(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (!client) {
      setThumb(NONE_THUMB)
      return
    }
    const cached = memoryCache.get(cacheKey)
    if (cached) {
      setThumb(cached.payload)
      return
    }
    setThumb(NONE_THUMB)
  }, [client, cacheKey])

  useEffect(() => {
    if (!client || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const el = targetRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [client, visible, targetRef])

  useEffect(() => {
    if (!client || !visible) return
    const cached = memoryCache.get(cacheKey)
    if (cached) {
      setThumb(cached.payload)
      return
    }
    let alive = true
    void fetchThumbnailDeduped(client, fileRef, cacheKey).then((payload) => {
      if (alive) setThumb(payload)
    })
    return () => {
      alive = false
    }
  }, [client, visible, cacheKey, fileRef])

  return thumb
}
