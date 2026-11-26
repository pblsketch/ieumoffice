// Build settings of track T7 ai. Owned by that track.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { TrackBuild } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Vite module ids use forward slashes; Windows paths compare without case. */
function normalized(path: string): string {
  const clean = path.replace(/[?#].*$/, '').replace(/\\/g, '/')
  return process.platform === 'win32' ? clean.toLowerCase() : clean
}

const AI_PROVIDER_SRC = normalized(resolve(HERE, '../../../../packages/ai-provider/src'))
const PC_FETCH = `${AI_PROVIDER_SRC}/fetch.ts`
const MOBILE_FETCH = resolve(HERE, '../../src/renderer/ai/net/providerFetch.ts').replace(/\\/g, '/')

/**
 * Hands PC's AI protocol code the mobile `aiFetch` (src/renderer/ai/net/providerFetch.ts),
 * which sends through Rust's sealed relay. Only an import made from inside
 * `packages/ai-provider/src/` that resolves to that package's `fetch.ts` is
 * swapped; every other module (the mobile stand-in itself among them) gets the
 * PC file. Applies to the bundle and to Vitest.
 */
export function mobileAiFetchPlugin(): Plugin {
  return {
    name: 'ieum-mobile-ai-fetch',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !/(^|[\\/])fetch(\.[cm]?[jt]s)?$/.test(source)) return null
      if (!normalized(importer).startsWith(`${AI_PROVIDER_SRC}/`)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || normalized(resolved.id) !== PC_FETCH) return null
      return MOBILE_FETCH
    },
  }
}

export const aiBuild: TrackBuild = {
  plugins: [mobileAiFetchPlugin()],
}
