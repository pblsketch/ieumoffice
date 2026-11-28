import { useSyncExternalStore } from 'react'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'

export type ResolvedMobileTheme = 'light' | 'dark' | 'system'

const SYSTEM_DARK_EVENT = 'ieum:system-dark'

/** Reads the Android native dark-mode flag pushed by IeumFilePlugin, if available. */
export function readNativeSystemDark(): boolean | undefined {
  if (typeof window === 'undefined') return undefined
  const value = (window as { __ieumSystemDark?: unknown }).__ieumSystemDark
  return typeof value === 'boolean' ? value : undefined
}

/** Subscribes to native OS dark-mode changes pushed by IeumFilePlugin. */
export function subscribeNativeSystemDark(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(SYSTEM_DARK_EVENT, listener)
  return () => window.removeEventListener(SYSTEM_DARK_EVENT, listener)
}

/** React hook returning the native OS dark-mode flag, or undefined when not provided natively. */
export function useNativeSystemDark(): boolean | undefined {
  return useSyncExternalStore(subscribeNativeSystemDark, readNativeSystemDark, () => undefined)
}

/**
 * Resolves the user's theme preference against the native OS dark-mode signal.
 * Explicit 'light' and 'dark' always win; 'system' resolves to the native OS mode when known,
 * otherwise 'system' so CSS prefers-color-scheme handles it.
 */
export function resolveMobileTheme(
  theme: MobileTheme,
  nativeSystemDark?: boolean,
): ResolvedMobileTheme {
  if (theme === 'light' || theme === 'dark') return theme
  if (typeof nativeSystemDark === 'boolean') return nativeSystemDark ? 'dark' : 'light'
  return 'system'
}

/** Returns whether the effective theme is dark, checking explicit theme, native flag, DOM attr, then media query. */
export function isResolvedThemeDark(theme: MobileTheme, nativeSystemDark?: boolean): boolean {
  const resolved = resolveMobileTheme(theme, nativeSystemDark)
  if (resolved === 'dark') return true
  if (resolved === 'light') return false
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark') return true
    if (attr === 'light') return false
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

/**
 * Applies the resolved theme to `<html data-theme>` and `<meta name="color-scheme">`
 * so explicit light/dark choices stay locked regardless of the device's OS night mode.
 */
export function applyDocumentTheme(
  doc: Document,
  theme: MobileTheme,
  nativeSystemDark?: boolean,
): ResolvedMobileTheme {
  const resolved = resolveMobileTheme(theme, nativeSystemDark)
  if (resolved === 'system') {
    doc.documentElement.removeAttribute('data-theme')
  } else {
    doc.documentElement.setAttribute('data-theme', resolved)
  }
  const meta = doc.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'system' ? 'light dark' : resolved)
  }
  return resolved
}
