// Build settings of track T4 html and markdown. Owned by that track.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { TrackBuild } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const PC_HTML_RENDERER = resolve(here, '../../../html/src/renderer')
const PC_HTML_LOCALE = resolve(PC_HTML_RENDERER, 'i18n/locale')
const HTML_AI_LOCALE = resolve(here, '../../src/renderer/editors/html/htmlAiLocale.ts')

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

export const webBuild: TrackBuild = {
  plugins: [htmlAiLocalePlugin()],
}
