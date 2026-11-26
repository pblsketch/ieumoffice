// Build settings of track T1 sheets. Owned by that track.
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { TrackBuild } from './types'

/**
 * The phone's stand-ins for the Node modules the spreadsheet save code imports.
 * `__dirname`, not `import.meta.url`: Vite's config bundle and Vitest both set
 * it to this folder, while a jsdom test sees a non-file `import.meta.url`.
 */
const SHIM_DIR = `${resolve(__dirname, '../../src/renderer/editors/sheets/node-shims').replace(/\\/g, '/')}/`

const NODE_SHIMS: Readonly<Record<string, string>> = {
  'node:fs': 'fs.ts',
  fs: 'fs.ts',
  'node:fs/promises': 'fs-promises.ts',
  'fs/promises': 'fs-promises.ts',
  'node:os': 'os.ts',
  os: 'os.ts',
  'node:path': 'path.ts',
  path: 'path.ts',
  'node:crypto': 'crypto.ts',
  crypto: 'crypto.ts',
}

/**
 * The modules the stand-ins apply to: the gateway's save and import files
 * (`saveWorkbookViaSidecar`, CSV and HTML imports) and the desktop's legacy
 * `.xls` open conversion the phone reuses. Every other importer, in this track
 * or another, keeps whatever `node:*` resolves to normally.
 */
const SAVE_SCOPE: readonly RegExp[] = [
  /\/packages\/xlsx-gateway\/src\/gateway\/[^/]+\.ts$/,
  /\/apps\/sheets\/src\/main\/legacy-import\.ts$/,
]

/** Gateway modules whose JSZip builds new workbooks as Node buffers. */
const JSZIP_SCOPE = /\/packages\/xlsx-gateway\/src\/gateway\/[^/]+\.ts$/

function moduleId(id: string | undefined): string {
  return (id ?? '').replace(/\\/g, '/').replace(/\?.*$/, '')
}

export function inSheetsSaveScope(importer: string | undefined): boolean {
  const id = moduleId(importer)
  return SAVE_SCOPE.some((pattern) => pattern.test(id))
}

const USES_BUFFER = /\bBuffer\.(?:allocUnsafe|alloc|from|concat|isBuffer|byteLength)\b/
const IMPORTS_BUFFER = /^\s*import\s[^;]*\bBuffer\b[^;]*from\s+['"](?:node:)?buffer['"]/m

/**
 * Resolves `node:fs`, `node:fs/promises`, `node:os`, `node:path`,
 * `node:crypto` (and `jszip` for the gateway) to the phone's stand-ins for
 * the importers in `SAVE_SCOPE` only, and gives those modules the phone's
 * `Buffer` where they use the Node global.
 */
export function sheetsNodeShimsPlugin(): Plugin {
  return {
    name: 'ieum-sheets-node-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!inSheetsSaveScope(importer)) return null
      const shim = NODE_SHIMS[source]
      if (shim) return `${SHIM_DIR}${shim}`
      if (source === 'jszip' && JSZIP_SCOPE.test(moduleId(importer))) {
        return `${SHIM_DIR}jszip.ts`
      }
      return null
    },
    transform(code, id) {
      if (!inSheetsSaveScope(id)) return null
      if (!USES_BUFFER.test(code) || IMPORTS_BUFFER.test(code)) return null
      return {
        code: `import { Buffer } from ${JSON.stringify(`${SHIM_DIR}buffer.ts`)};\n${code}`,
        map: null,
      }
    },
  }
}

export const sheetsBuild: TrackBuild = {
  plugins: [sheetsNodeShimsPlugin()],
}
