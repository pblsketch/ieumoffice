/**
 * Build rule (Vite, Vitest, and the Vite worker bundle) that lets the mobile
 * app import the PC PDF save code without editing it: Node built-in and
 * Electron imports are redirected to the stand-ins in ../node-shims, and the
 * `Buffer`/`process` globals those files use are injected as imports.
 *
 * The rule applies ONLY to modules under apps/pdf/src/main/,
 * packages/font-metrics/ and packages/electron-utils/. Every other module
 * (HWP, Markdown, other tracks, the app itself) resolves exactly as before.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHIM_DIR = resolve(HERE, '../node-shims')
const REPO_ROOT = resolve(HERE, '../../../../../../../..')

/** Folders whose imports get the stand-ins */
export const NODE_SHIM_SCOPES: readonly string[] = [
  resolve(REPO_ROOT, 'apps/pdf/src/main'),
  resolve(REPO_ROOT, 'packages/font-metrics'),
  resolve(REPO_ROOT, 'packages/electron-utils'),
]

const SHIM_FILES: Readonly<Record<string, string>> = {
  fs: 'fs.ts',
  'fs/promises': 'fs-promises.ts',
  crypto: 'crypto.ts',
  zlib: 'zlib.ts',
  module: 'module.ts',
  path: 'path.ts',
  os: 'os.ts',
  process: 'process.ts',
  buffer: 'buffer.ts',
  electron: 'electron.ts',
}

/** A path in Vite's id form (forward slashes), without loading vite (jsdom tests import this file) */
const viteId = (path: string): string => path.replace(/\\/g, '/')

/**
 * Stand-in file for a specifier, or null when the specifier is not one we replace.
 * The id is in Vite's form (forward slashes), the same id the engine's own
 * relative imports of a stand-in get: on Windows a backslash id would be a
 * second copy of the module in the Rollup bundle, so state set through one
 * copy (the brotli decoder engine/fonts.ts registers) is missing in the other.
 */
export function shimFileFor(specifier: string): string | null {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  const file = SHIM_FILES[bare]
  return file ? viteId(resolve(SHIM_DIR, file)) : null
}

const comparable = (id: string): string => {
  const clean = id.split('?')[0]!.replace(/\\/g, '/')
  // Windows ids differ in drive-letter case between Vite and Node
  return process.platform === 'win32' ? clean.toLowerCase() : clean
}

const SCOPE_PREFIXES = NODE_SHIM_SCOPES.map((dir) => `${comparable(dir)}/`)

/** Whether a module id lies in one of the folders the stand-ins apply to */
export function inNodeShimScope(id: string | undefined): boolean {
  if (!id) return false
  const path = comparable(id)
  return SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/

/** Global name → stand-in import injected when a scoped module uses it */
const INJECTED_GLOBALS: readonly { name: string; pattern: RegExp; line: string }[] = [
  {
    name: 'Buffer',
    pattern: /\bBuffer\b/,
    line: `import { Buffer } from ${JSON.stringify(resolve(SHIM_DIR, 'buffer.ts').replace(/\\/g, '/'))};`,
  },
  {
    name: 'process',
    pattern: /\bprocess\b/,
    line: `import process from ${JSON.stringify(resolve(SHIM_DIR, 'process.ts').replace(/\\/g, '/'))};`,
  },
]

/** The module binds the name itself (an import or a top-level declaration) */
const declares = (code: string, name: string): boolean =>
  new RegExp(
    `^import\\s+(?:${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})|` +
      `^(?:export\\s+)?(?:const|let|var|function|class)\\s+${name}\\b`,
    'm',
  ).test(code)

export function pdfEngineNodeShims(): Plugin {
  return {
    name: 'ieum-pdf-engine-node-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!inNodeShimScope(importer)) return null
      return shimFileFor(source)
    },
    transform(code, id) {
      if (!inNodeShimScope(id) || !SOURCE_FILE.test(id.split('?')[0]!)) return null
      // Prepended on the first line so every original line keeps its number
      const lines = INJECTED_GLOBALS.filter(
        (g) => g.pattern.test(code) && !declares(code, g.name),
      ).map((g) => g.line)
      if (lines.length === 0) return null
      return { code: `${lines.join('')}${code}`, map: null }
    },
  }
}
