/**
 * Build rule (Vite bundle and Vitest) that lets the mobile app import the PPTX engine
 * (`@genoffice/pptx-engine`) without editing it: the engine's `node:crypto`, `node:zlib`,
 * `node:fs` and `node:stream/promises` imports (static and dynamic) are redirected to the
 * stand-ins in ./node-shims, and the `Buffer` global it uses is injected as an import.
 *
 * The rule applies ONLY to modules under the engine's own src folder. Every other module
 * (other tracks, the HWP editor, the app itself) resolves exactly as before.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHIM_DIR = resolve(HERE, 'node-shims')
const ENGINE = '@genoffice/pptx-engine'

/** A path in Vite's id form (forward slashes) */
const viteId = (path: string): string => path.replace(/\\/g, '/')

const isEnginePackage = (dir: string): boolean => {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return false
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === ENGINE
  } catch {
    return false
  }
}

/**
 * The installed engine's package folder, symlinks resolved. Module ids point at the real
 * location, which is not next to this file when node_modules lives in a parent checkout
 * (linked worktrees), so it is found the way Node finds it, never by a relative path.
 */
function enginePackageDir(): string {
  const require = createRequire(import.meta.url)
  try {
    return dirname(realpathSync(require.resolve(`${ENGINE}/package.json`)))
  } catch {
    // the package's exports do not list package.json
  }
  try {
    for (let dir = dirname(realpathSync(require.resolve(ENGINE))); ; dir = dirname(dir)) {
      if (isEnginePackage(dir)) return dir
      if (dirname(dir) === dir) break
    }
  } catch {
    // fall through to the node_modules walk
  }
  for (let dir = HERE; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...ENGINE.split('/'))
    if (existsSync(candidate)) return realpathSync(candidate)
    if (dirname(dir) === dir) break
  }
  throw new Error(`${ENGINE} is not installed; the mobile PPTX stand-ins cannot find it`)
}

/** The engine's src folder in Vite's id form: the folder whose imports get the stand-ins */
export const PPTX_ENGINE_SRC: string = viteId(join(enginePackageDir(), 'src'))

const SHIM_FILES: Readonly<Record<string, string>> = {
  crypto: 'crypto.ts',
  zlib: 'zlib.ts',
  fs: 'fs.ts',
  'stream/promises': 'stream-promises.ts',
}

/**
 * Stand-in file for a specifier, or null when it is not one we replace. The id is in Vite's
 * form (forward slashes): on Windows a backslash id would be a second copy of the module.
 */
export function shimFileFor(specifier: string): string | null {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  const file = SHIM_FILES[bare]
  return file ? viteId(resolve(SHIM_DIR, file)) : null
}

const comparable = (id: string): string => {
  const clean = viteId(id.split('?')[0]!)
  // Windows ids differ in drive-letter case between Vite and Node
  return process.platform === 'win32' ? clean.toLowerCase() : clean
}

const SCOPE_PREFIX = `${comparable(PPTX_ENGINE_SRC)}/`

/** Whether a module id lies under the PPTX engine's src folder */
export function inPptxShimScope(id: string | undefined): boolean {
  return !!id && comparable(id).startsWith(SCOPE_PREFIX)
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const USES_BUFFER = /\bBuffer\b/
const BUFFER_IMPORT = `import { Buffer } from ${JSON.stringify(viteId(resolve(SHIM_DIR, 'buffer.ts')))};`

/** The module binds `Buffer` itself (an import or a top-level declaration) */
const declaresBuffer = (code: string): boolean =>
  /^import\s+(?:Buffer\b|\{[^}]*\bBuffer\b[^}]*\})|^(?:export\s+)?(?:const|let|var|function|class)\s+Buffer\b/m.test(
    code,
  )

export function pptxNodeShims(): Plugin {
  return {
    name: 'ieum-pptx-engine-node-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!inPptxShimScope(importer)) return null
      return shimFileFor(source)
    },
    transform(code, id) {
      if (!inPptxShimScope(id) || !SOURCE_FILE.test(id.split('?')[0]!)) return null
      if (!USES_BUFFER.test(code) || declaresBuffer(code)) return null
      // Prepended on the first line so every original line keeps its number
      return { code: `${BUFFER_IMPORT}${code}`, map: null }
    },
  }
}
