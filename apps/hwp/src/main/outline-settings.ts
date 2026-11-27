/**
 * App-wide Hangul outline style-to-level mapping persisted in `userData/app-settings.json`.
 *
 * Performs the read-modify-write synchronously (matching the shell's `writeAppSettings`)
 * via a temporary file and atomic rename so concurrent main-process writes to unrelated
 * settings keys (such as window bounds) can never interleave and be lost. Explicit empty
 * maps (`{}`) are stored verbatim so removed defaults stay removed; passing `null` removes
 * the key to restore `DEFAULT_OUTLINE_STYLE_MAP`.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SettingsPathProvider } from '@genoffice/electron-utils'
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

function writeSettingsObjectSync(path: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(settings, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
    })
    renameSync(tempPath, path)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // The write may have failed before the temporary file was created.
    }
    throw error
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
 * or reset to defaults when `map` is `null`. Always preserves unrelated settings keys
 * and completes synchronously without awaiting between read and write.
 */
export function writeHwpOutlineStyleMap(
  app: SettingsPathProvider,
  map: OutlineStyleMap | null,
): OutlineStyleMap {
  const path = settingsPathOf(app)
  const settings = readSettingsObject(path)
  if (map === null) {
    delete settings[HWP_OUTLINE_STYLE_MAP_KEY]
    writeSettingsObjectSync(path, settings)
    return { ...DEFAULT_OUTLINE_STYLE_MAP }
  }
  const normalized = normalizeOutlineStyleMap(map)
  settings[HWP_OUTLINE_STYLE_MAP_KEY] = normalized
  writeSettingsObjectSync(path, settings)
  return normalized
}
