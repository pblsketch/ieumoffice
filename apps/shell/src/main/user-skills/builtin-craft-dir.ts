import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ALLOWED_CRAFT_SLUGS, type CraftSlug } from '@genoffice/ai-provider'

/**
 * The builtin craft quality fragments folder: next to the app's other
 * resources once packaged (`resources/builtin-craft`), or the shell package's
 * `resources/builtin-craft` directory in development.
 */
export function builtinCraftDirFor(options: {
  isPackaged: boolean
  resourcesPath: string
  /** `app.getAppPath()`: the shell package folder in a development run */
  appPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'builtin-craft')
    : join(options.appPath, 'resources', 'builtin-craft')
}

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_CRAFT_SLUGS)

/**
 * Reads the requested craft quality fragments from `craftDir`, deduplicated
 * and strictly restricted to `ALLOWED_CRAFT_SLUGS`. Missing or unknown slugs
 * are silently skipped for forward compatibility.
 */
export async function readCraftFragments(
  craftDir: string | undefined,
  slugs: readonly string[] | undefined,
): Promise<Array<{ slug: CraftSlug; body: string }>> {
  if (!craftDir || !slugs || slugs.length === 0) return []
  const out: Array<{ slug: CraftSlug; body: string }> = []
  const seen = new Set<string>()
  for (const raw of slugs) {
    const slug = raw.trim().toLowerCase()
    if (!ALLOWED_SET.has(slug) || seen.has(slug)) continue
    seen.add(slug)
    try {
      const body = (await readFile(join(craftDir, `${slug}.md`), 'utf8')).trim()
      if (body) out.push({ slug: slug as CraftSlug, body })
    } catch {
      // Missing craft file is skipped without failing the skill read
    }
  }
  return out
}
