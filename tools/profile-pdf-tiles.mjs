/** Compare full-page and viewport raster work on the same immutable PDF input. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => args[args.indexOf(key) + 1]
if (!args.includes('--file') || !args.includes('--out'))
  throw new Error('Use --file <pdf> --out <json>')
const file = resolve(option('--file')),
  out = resolve(option('--out'))
const before = await stat(file)
const userData = await mkdtemp(join(tmpdir(), 'ieum-pdf-tiles-profile-'))
await writeFile(join(userData, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
await writeFile(
  join(userData, 'ai-settings.json'),
  JSON.stringify({ providers: {}, subscriptionNoticeSeen: true, subscriptionNoticeVersion: 2 }),
)
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
const require = createRequire(join(root, 'package.json'))
let app
const result = { userData, completed: false }
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [`--user-data-dir=${userData}`, join(root, 'apps/shell'), file],
    env: { ...env, GENOFFICE_LANG: 'en', GENOFFICE_USER_DATA: userData },
    timeout: 60000,
  })
  let page
  const deadline = Date.now() + 90000
  while (!page && Date.now() < deadline) {
    page = app.windows().find((candidate) => candidate.url().includes('://pdf/'))
    if (!page) await new Promise((done) => setTimeout(done, 100))
  }
  if (!page) throw new Error('PDF editor not created')
  await page.locator('.pdf-page-content canvas').first().waitFor({ timeout: 60000 })
  result.rasters = await page.evaluate(async (path) => {
    const api = globalThis.window.pdfApi
    const source = await api.openViewSource(path)
    let serial = 0
    const release = (bitmap) => bitmap.rgba.transfer?.(0)
    try {
      const element = globalThis.document.querySelector('.pdf-page')
      const width = Math.floor(parseFloat(element.style.width) * 4)
      const height = Math.floor(parseFloat(element.style.height) * 4)
      const total = globalThis.document.querySelectorAll('.pdf-page').length
      const pages = [...new Set([1, Math.ceil(total / 2), total])]
      const rows = []
      for (const page of pages) {
        const request = { sourceId: source.id, page, width, height, rotation: 0 }
        const start = performance.now()
        const full = await api.renderViewPage({ ...request, requestId: `diagnostic-${++serial}` })
        const fullMs = performance.now() - start
        const original = new Uint8Array(full.rgba)
        const tiles = []
        const originY = Math.min(height - 1024, Math.floor(height / 1024) * 512)
        for (let y = originY; y < originY + 1024; y += 512)
          for (let x = 0; x < Math.min(width, 1536); x += 512)
            tiles.push({ x, y, width: Math.min(512, width - x), height: Math.min(512, height - y) })
        let maxError = 0,
          sumError = 0,
          channels = 0,
          tileBytes = 0,
          nativeMs = 0
        const batchStart = performance.now()
        for (const tile of tiles) {
          const tick = performance.now()
          const bitmap = await api.renderViewPage({
            ...request,
            tile,
            requestId: `diagnostic-${++serial}`,
          })
          nativeMs += performance.now() - tick
          tileBytes += bitmap.rgba.byteLength
          const pixels = new Uint8Array(bitmap.rgba)
          for (let y = 0; y < tile.height; y++)
            for (let x = 0; x < tile.width * 4; x++) {
              const error = Math.abs(
                pixels[y * tile.width * 4 + x] - original[((tile.y + y) * width + tile.x) * 4 + x],
              )
              maxError = Math.max(maxError, error)
              sumError += error
              channels++
            }
          release(bitmap)
        }
        rows.push({
          page,
          width,
          height,
          fullMs,
          tileNativeMs: nativeMs,
          tileBatchIncludingComparisonMs: performance.now() - batchStart,
          fullBytes: full.rgba.byteLength,
          tileBytes,
          tiles: tiles.length,
          maxChannelError: maxError,
          meanChannelError: sumError / channels,
          note: 'Native IPC timings; tile batch covers a viewport region, not the entire page',
        })
        release(full)
      }
      return rows
    } finally {
      await api.closeViewSource(source.id)
    }
  }, file)
  result.completed = true
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  await writeFile(out, JSON.stringify(result, null, 2))
}
