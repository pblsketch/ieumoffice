// Build settings of track T4 html and markdown. Owned by that track.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { TrackBuild } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const PC_HTML_RENDERER = resolve(here, '../../../html/src/renderer')
const PC_HTML_LOCALE = resolve(PC_HTML_RENDERER, 'i18n/locale')
const HTML_AI_LOCALE = resolve(here, '../../src/renderer/editors/html/htmlAiLocale.ts')
const HTML2DOCX_SRC = resolve(here, '../../../../packages/html2docx/src')
const HTML2DOCX_NODE_SHIM = resolve(here, '../../src/renderer/editors/html/html2docxNode.ts')
const HTML2DOCX_PACKER_SHIM = resolve(here, '../../src/renderer/editors/html/html2docxPacker.ts')

/** One spelling of a path for comparing: forward slashes, no query, no case on Windows. */
function samePathKey(path: string): string {
  const plain = path.replace(/[?#].*$/, '').replace(/\\/g, '/')
  return process.platform === 'win32' ? plain.toLowerCase() : plain
}

const RENDERER_KEY = `${samePathKey(PC_HTML_RENDERER)}/`
const LOCALE_KEYS = new Set(
  ['', '.ts', '.tsx'].map((ext) => samePathKey(`${PC_HTML_LOCALE}${ext}`)),
)

/**
 * The desktop HTML editor's AI tools (apps/html/src/renderer/ai/tools.ts) take their summaries
 * from that editor's locale module, whose language only its React provider sets. Only for imports
 * made by the desktop HTML renderer's own files, that module is the mobile stand-in, which takes
 * the language from the AI run. No other module's import of a locale file is touched.
 */
function htmlAiLocalePlugin(): Plugin {
  return {
    name: 'web-html-ai-locale',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !/\/locale(?:\.tsx?)?$/.test(source)) return null
      const from = samePathKey(importer)
      if (!from.startsWith(RENDERER_KEY)) return null
      const target = samePathKey(resolve(dirname(importer.replace(/[?#].*$/, '')), source))
      return LOCALE_KEYS.has(target) ? HTML_AI_LOCALE : null
    },
  }
}

const PAGE_SETTINGS_KEY = samePathKey(resolve(HTML2DOCX_SRC, 'generate/page-settings.ts'))
const GENERATE_KEY = samePathKey(resolve(HTML2DOCX_SRC, 'generate.ts'))

/**
 * html2docx's Word generator was written for Node (the desktop runs it in the main process). In
 * the phone's web view two of its files need browser stand-ins, and only those two files get them
 * (the package itself is not changed):
 * - generate/page-settings.ts paints a plain page color as a PNG with `Buffer` and `node:zlib`:
 *   it gets editors/html/html2docxNode.ts for both.
 * - generate.ts packs with `Packer.toBuffer` (Node buffers only): it gets
 *   editors/html/html2docxPacker.ts, the same packing as bytes.
 * If either file stops matching what the stand-in expects, the build fails instead of the export.
 */
function html2docxBrowserPlugin(): Plugin {
  return {
    name: 'web-html2docx-browser',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      const from = samePathKey(importer)
      if (from === PAGE_SETTINGS_KEY && source === 'node:zlib') return HTML2DOCX_NODE_SHIM
      if (from === GENERATE_KEY && source === 'docx') return HTML2DOCX_PACKER_SHIM
      return null
    },
    transform(code, id) {
      if (samePathKey(id) !== PAGE_SETTINGS_KEY) return null
      if (!code.includes("import zlib from 'node:zlib'")) {
        throw new Error('html2docx page-settings.ts no longer imports node:zlib as expected')
      }
      // its free `Buffer` becomes the stand-in's, imported at the top of the module
      const shim = JSON.stringify(HTML2DOCX_NODE_SHIM.replace(/\\/g, '/'))
      return { code: `import { Buffer } from ${shim};\n${code}`, map: null }
    },
  }
}

export const webBuild: TrackBuild = {
  plugins: [htmlAiLocalePlugin(), html2docxBrowserPlugin()],
  // html2docx's KPI table debug switch reads process.env, which a web view does not have
  define: { 'process.env.H2D_DEBUG_KPI': 'undefined' },
}
