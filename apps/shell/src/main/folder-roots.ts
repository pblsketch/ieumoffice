import { accessSync, constants, statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import type { FolderRoot, FolderRootKind } from '../shared/home-api'

/** app-settings.json key: folders the user added to the home tree beside the default save folder */
export const FOLDER_ROOTS_KEY = 'folderRoots'

export function readExtraRoots(settings: Record<string, unknown>, defaultDir: string): string[] {
  const raw = settings[FOLDER_ROOTS_KEY]
  if (!Array.isArray(raw)) return []
  const seen = new Set([resolve(defaultDir)])
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || !isAbsolute(entry)) continue
    const key = resolve(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/** the list with `path` appended, or null when it already is a root */
export function withExtraRoot(
  extras: readonly string[],
  defaultDir: string,
  path: string,
): string[] | null {
  const key = resolve(path)
  if (key === resolve(defaultDir) || extras.some((e) => resolve(e) === key)) return null
  return [...extras, path]
}

export function withoutExtraRoot(extras: readonly string[], path: string): string[] {
  const key = resolve(path)
  return extras.filter((e) => resolve(e) !== key)
}

/** an added folder is shown as it is: never created, read-only ones list but refuse edits */
export function describeExtraRoot(path: string): FolderRoot {
  let readable = false
  let usable = false
  try {
    readable = statSync(path).isDirectory()
    if (readable) {
      accessSync(path, constants.R_OK)
      accessSync(path, constants.W_OK)
      usable = true
    }
  } catch {
    // a missing, unplugged or unwritable folder keeps whatever was established above
  }
  return { path, name: basename(path) || path, usable, readable, removable: true }
}

/** a pinned OS location or drive root: non-removable, carries its Explorer icon role */
export function describeSystemRoot(
  path: string,
  kind: FolderRootKind,
  label?: string,
): FolderRoot | null {
  try {
    if (!statSync(path).isDirectory()) return null
    accessSync(path, constants.R_OK)
    let usable = false
    try {
      accessSync(path, constants.W_OK)
      usable = true
    } catch {
      usable = false
    }
    const fallbackName = basename(path) || path.replace(/[\\/]+$/, '') || path
    return {
      path,
      name: label ?? fallbackName,
      usable,
      readable: true,
      removable: false,
      kind,
    }
  } catch {
    return null
  }
}

/** Mounted Windows drive roots (`C:\\`, `D:\\`, ...) that exist and can be read. */
export function discoverLocalDriveRoots(
  platform: NodeJS.Platform = process.platform,
): FolderRoot[] {
  if (platform !== 'win32') return []
  const drives: FolderRoot[] = []
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const drivePath = `${letter}:\\`
    const root = describeSystemRoot(drivePath, 'drive', `${letter}:\\`)
    if (root) drives.push(root)
  }
  return drives
}
