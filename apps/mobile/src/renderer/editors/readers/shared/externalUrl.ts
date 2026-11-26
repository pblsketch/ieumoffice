// Outside links in books: the scheme check, the system-browser opener from track T6 when present, and copy.
// T6's bridge module exports `openExternalUrl(client, url)`; until it lands the module namespace has no such
// function and `readerExternalUrlOpener` is null, so the confirmation sheet offers only "copy address".
import * as homeBridge from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'

export type ExternalUrlOpener = (client: MobileClient, url: string) => Promise<void>

// Same allowlist idea as packages/electron-utils/src/safe-external-url.ts, plus mailto: for book links.
const OPENABLE_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:']

/** True only for an absolute http:, https: or mailto: URL (surrounding whitespace ignored). */
export function isOpenableExternalUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return false
  }
  return OPENABLE_PROTOCOLS.includes(parsed.protocol)
}

/**
 * Returns an opener built on the namespace's `openExternalUrl`, or null when the function is missing.
 * The opener refuses URLs that fail `isOpenableExternalUrl` and passes the trimmed URL on.
 */
export function pickExternalUrlOpener(ns: unknown): ExternalUrlOpener | null {
  if (!ns || typeof ns !== 'object') return null
  const open = (ns as { readonly openExternalUrl?: unknown }).openExternalUrl
  if (typeof open !== 'function') return null
  const call = open as (client: MobileClient, url: string) => Promise<unknown>
  return async (client, url) => {
    if (!isOpenableExternalUrl(url))
      throw new Error('This address cannot be opened outside the app.')
    await call(client, url.trim())
  }
}

export const readerExternalUrlOpener: ExternalUrlOpener | null = pickExternalUrlOpener(homeBridge)

/** Copies text to the clipboard; resolves false when neither the clipboard API nor the fallback worked. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // permission refused or not focused: try the textarea fallback
    }
  }
  return copyWithTextarea(text)
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  document.body.appendChild(area)
  try {
    area.select()
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previous?.focus()
  }
}
