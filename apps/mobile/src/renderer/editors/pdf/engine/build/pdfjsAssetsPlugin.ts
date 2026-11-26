/**
 * Track T2 (pdf): PDF.js reads CMaps, standard fonts and its wasm decoders from
 * `pdfjs/` next to the page (apps/pdf/src/renderer/view-config.ts), as in the PC
 * PDF editor. Copy them into `<outDir>/pdfjs` on build and serve them in dev.
 */
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

const SUBDIRS = ['cmaps', 'standard_fonts', 'wasm']

export function pdfjsAssetsPlugin(): Plugin {
  const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  let outDir: string | null = null
  return {
    name: 'ieum-pdfjs-assets',
    configResolved(config) {
      // only a real bundle copies: Vitest resolves a config too (with a placeholder outDir)
      outDir =
        config.command === 'build' && !process.env.VITEST
          ? resolve(config.root, config.build.outDir)
          : null
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '')
        const [sub] = rel.split('/')
        const file = resolve(pdfjsRoot, rel)
        if (!sub || !SUBDIRS.includes(sub) || !file.startsWith(pdfjsRoot) || !existsSync(file)) {
          next()
          return
        }
        res.end(readFileSync(file))
      })
    },
    closeBundle() {
      if (!outDir) return
      for (const sub of SUBDIRS) {
        cpSync(resolve(pdfjsRoot, sub), resolve(outDir, 'pdfjs', sub), { recursive: true })
      }
    },
  }
}
