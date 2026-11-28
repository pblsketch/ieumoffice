import { readFile } from 'node:fs/promises'
import type { ConnectorPickerItem } from '../../shared/connector-picker-api'
import {
  listVaultNotesForPicker,
  resolveVaultEmbeddedImages,
  type VaultEntryLike,
} from '../mcp-client/obsidian-vault'
import { comparablePath } from '../projects/paths'

/** Maximum number of notes that may be attached in one pick */
export const MAX_OBSIDIAN_PICKS = 20
/** Maximum total embedded vault images automatically attached alongside picked notes */
export const MAX_OBSIDIAN_ATTACHED_IMAGES = 20
const MAX_ID_LENGTH = 4096

/**
 * List `.md` notes across all registered Obsidian vaults (regardless of
 * per-vault AI toggle) and flag any note currently open with unsaved changes.
 */
export async function listObsidianPickerItems(
  vaults: readonly VaultEntryLike[],
  isUnsaved: (absPath: string) => Promise<boolean> | boolean,
  platform?: NodeJS.Platform,
): Promise<{ items: ConnectorPickerItem[] }> {
  const notes = await listVaultNotesForPicker(vaults, { platform })
  const items: ConnectorPickerItem[] = []
  for (const note of notes) {
    const unsaved = await isUnsaved(note.absPath)
    items.push({
      id: note.absPath,
      title: note.title,
      subtitle: note.relPath,
      vaultId: note.vaultId,
      vaultName: note.vaultName,
      tags: note.tags,
      mtimeMs: note.mtimeMs,
      ...(unsaved ? { disabledReason: 'unsaved' as const } : {}),
    })
  }
  return { items }
}

/**
 * Validate chosen IDs against the most recent listed items. Unknown, disabled,
 * or non-string IDs are dropped and counted in `skipped`. Capped at 20 paths.
 */
export function resolveObsidianSelection(
  rawIds: unknown,
  listedItems: readonly ConnectorPickerItem[] | null,
): { paths: string[]; skipped: number } {
  if (!Array.isArray(rawIds) || !listedItems) return { paths: [], skipped: 0 }
  const allowed = new Set<string>()
  for (const item of listedItems) {
    if (!item.disabledReason) allowed.add(item.id)
  }
  const paths: string[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const raw of rawIds) {
    if (typeof raw !== 'string' || raw.length > MAX_ID_LENGTH) {
      skipped += 1
      continue
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    if (!allowed.has(raw)) {
      skipped += 1
      continue
    }
    if (paths.length >= MAX_OBSIDIAN_PICKS) continue
    paths.push(raw)
  }
  return { paths, skipped }
}

/**
 * Resolve chosen Obsidian notes and automatically collect local vault images
 * referenced inside those notes (`![[img.png]]`, `![alt](assets/img.png)`,
 * `<img src="...">`) under full vault security invariants.
 */
export async function resolveObsidianSelectionWithImages(
  rawIds: unknown,
  listedItems: readonly ConnectorPickerItem[] | null,
  vaults: readonly VaultEntryLike[],
  options: { platform?: NodeJS.Platform; maxImages?: number } = {},
): Promise<{ paths: string[]; skipped: number }> {
  const base = resolveObsidianSelection(rawIds, listedItems)
  if (base.paths.length === 0 || !listedItems || vaults.length === 0) return base

  const platform = options.platform ?? process.platform
  const maxImages = options.maxImages ?? MAX_OBSIDIAN_ATTACHED_IMAGES
  const itemById = new Map<string, ConnectorPickerItem>()
  for (const item of listedItems) itemById.set(item.id, item)
  const vaultById = new Map<string, VaultEntryLike>()
  for (const v of vaults) vaultById.set(v.id, v)

  const imagePaths: string[] = []
  const seenImages = new Set<string>()

  for (const notePath of base.paths) {
    if (imagePaths.length >= maxImages) break
    const item = itemById.get(notePath)
    const vault = item?.vaultId ? vaultById.get(item.vaultId) : undefined
    if (!vault) continue
    let text: string
    try {
      text = await readFile(notePath, 'utf8')
    } catch {
      continue
    }
    const embedded = await resolveVaultEmbeddedImages(vault.path, notePath, text, {
      platform,
      maxImages: maxImages - imagePaths.length,
    })
    for (const img of embedded) {
      if (imagePaths.length >= maxImages) break
      const cmp = comparablePath(img.absPath, platform)
      if (seenImages.has(cmp)) continue
      seenImages.add(cmp)
      imagePaths.push(img.absPath)
    }
  }

  return { paths: [...base.paths, ...imagePaths], skipped: base.skipped }
}
