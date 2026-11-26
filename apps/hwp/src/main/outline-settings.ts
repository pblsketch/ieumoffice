/**
 * App-wide Hangul outline style-to-level mapping persisted in `userData/app-settings.json`.
 *
 * Preserves all unrelated settings keys on write and writes atomically via `atomicWriteFile`.
 * Explicit empty maps (`{}`) are stored verbatim so removed defaults stay removed; passing
 * `null` removes the key to restore `DEFAULT_OUTLINE_STYLE_MAP`.
 */
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SettingsPathProvider } from '@genoffice/electron-utils'
import { atomicWriteFile } from './atomic-write'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  normalizeOutlineStyleMap,
} from '../../studio-plugin/outline.mjs'

export const HWP_OUTLINE_STYLE_MAP_KEY = 'hwpOutlineStyleMap'

export type OutlineStyleMap = Record<string, number>

export { DEFAULT_OUTLINE_STYLE_MAP, normalizeOutlineStyleMap }

function settingsPathOf(app: SettingsPathProvider): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

function readSettingsObject(path: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) }
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Read the app-wide outline style mapping from `userData/app-settings.json`.
 * Falls back to a fresh copy of `DEFAULT_OUTLINE_STYLE_MAP` when missing or invalid.
 */
export function readHwpOutlineStyleMap(app: SettingsPathProvider): OutlineStyleMap {
  const settings = readSettingsObject(settingsPathOf(app))
  const value = settings[HWP_OUTLINE_STYLE_MAP_KEY]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeOutlineStyleMap(value)
  }
  return { ...DEFAULT_OUTLINE_STYLE_MAP }
}

/**
 * Persist a normalized app-wide outline style mapping in `userData/app-settings.json`,
 * or reset to defaults when `map` is `null`. Always preserves unrelated settings keys.
 */
export async function writeHwpOutlineStyleMap(
  app: SettingsPathProvider,
  map: OutlineStyleMap | null,
): Promise<OutlineStyleMap> {
  const path = settingsPathOf(app)
  const settings = readSettingsObject(path)
  await mkdir(dirname(path), { recursive: true })
  if (map === null) {
    delete settings[HWP_OUTLINE_STYLE_MAP_KEY]
    await atomicWriteFile(path, Buffer.from(JSON.stringify(settings, null, 2), 'utf8'))
    return { ...DEFAULT_OUTLINE_STYLE_MAP }
  }
  const normalized = normalizeOutlineStyleMap(map)
  settings[HWP_OUTLINE_STYLE_MAP_KEY] = normalized
  await atomicWriteFile(path, Buffer.from(JSON.stringify(settings, null, 2), 'utf8'))
  return normalized
}
