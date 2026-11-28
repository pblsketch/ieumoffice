import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALLOWED_CRAFT_SLUGS } from '@genoffice/ai-provider'
import { builtinCraftDirFor, readCraftFragments } from '../src/main/user-skills/builtin-craft-dir'

const SHELL_ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('builtin craft fragments', () => {
  it('resolves dev and packaged directories and loads all 6 offline craft fragments', async () => {
    const devDir = builtinCraftDirFor({
      isPackaged: false,
      resourcesPath: '/res',
      appPath: SHELL_ROOT,
    })
    expect(devDir).toBe(join(SHELL_ROOT, 'resources', 'builtin-craft'))
    expect(
      builtinCraftDirFor({ isPackaged: true, resourcesPath: '/res', appPath: SHELL_ROOT }),
    ).toBe(join('/res', 'builtin-craft'))

    const frags = await readCraftFragments(devDir, [...ALLOWED_CRAFT_SLUGS, 'unknown-slug'])
    expect(frags.map((f) => f.slug)).toEqual([...ALLOWED_CRAFT_SLUGS])
    for (const f of frags) {
      expect(f.body.length).toBeGreaterThan(40)
      expect(f.body).not.toMatch(/https?:\/\//i)
    }
  })
})
