/** Capture every printed page from the built app, retaining its real font preparation. */
import { createRequire } from 'node:module'
import { copyFile, mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const file = option('--file')
const output = option('--out-dir')
const dpi = Number(option('--dpi', '120'))
if (!file || !output || !Number.isInteger(dpi) || dpi < 72 || dpi > 300)
  throw new Error('Use --file <hwp/hwpx> --out-dir <private directory> [--dpi 120]')
const out = resolve(output)
await mkdir(out, { recursive: true })
const require = createRequire(join(root, 'package.json'))
const { _electron: electron } = require('playwright-core')
const scratch = await mkdtemp(join(tmpdir(), 'ieum-hwp-reference-'))
const copy = join(scratch, basename(file))
await copyFile(resolve(file), copy)
const before = await stat(file)
const sourceBytes = await readFile(copy)
const result = {
  dpi,
  profile: 'print',
  layoutGeneration: '2022',
  inputSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  userData: scratch,
  completed: false,
  pages: [],
  errors: [],
}
await writeFile(join(scratch, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
await writeFile(
  join(scratch, 'ai-settings.json'),
  JSON.stringify({ providers: {}, subscriptionNoticeSeen: true, subscriptionNoticeVersion: 2 }),
)
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [`--user-data-dir=${scratch}`, join(root, 'apps/shell'), copy],
    env: { ...env, GENOFFICE_LANG: 'en', GENOFFICE_USER_DATA: scratch },
    timeout: 60000,
  })
  await app.firstWindow({ timeout: 30000 })
  let page
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && !page) {
    for (const candidate of app.windows()) {
      const href =
        candidate.url() ||
        (await candidate.evaluate(() => globalThis.location.href).catch(() => ''))
      if (href.includes('://hwp/')) {
        page = candidate
        break
      }
    }
    if (!page) await new Promise((done) => setTimeout(done, 100))
  }
  if (!page) throw new Error('HWP view not found')
  page.on('pageerror', (error) => {
    if (result.errors.length < 20) result.errors.push(error.message)
  })
  await page.locator('.hwp-app[data-phase="ready"]').waitFor({ timeout: 120000 })
  const studio = page.frames().find((frame) => frame.url().includes('/studio/'))
  if (!studio) throw new Error('Studio frame not found')
  await studio.locator('#scroll-content canvas').first().waitFor({ timeout: 60000 })
  await studio.evaluate(() => globalThis.document.fonts.ready.then(() => undefined))
  const capture = await studio.evaluate(
    async ({ dpi }) => {
      const runtime = globalThis.rhwpStudio
      runtime.automation.registerCommand({
        id: 'ext:reference-capture',
        label: 'Reference capture',
        execute(services) {
          // The pinned studio exposes a WasmBridge to commands, not HwpDocument.
          // This diagnostic needs raw render trees; keep its private access here.
          const bridge = services.wasm
          const doc = bridge.doc
          if (!doc) throw new Error('Studio bridge has no loaded document')
          if (typeof doc.setHangul2024Compat !== 'function')
            throw new Error('Missing explicit layout-generation API')
          doc.setHangul2024Compat(false)
          bridge.withPortableMetrics(() => {
            const count = doc.pageCount()
            if (count > 100) throw new Error('Complete capture exceeds 100-page budget')
            const pages = []
            for (let index = 0; index < count; index++) {
              const info = JSON.parse(doc.getPageInfo(index))
              const canvas = globalThis.document.createElement('canvas')
              const size = info.printSize ?? info
              canvas.width = Math.ceil((size.width * dpi) / 96)
              canvas.height = Math.ceil((size.height * dpi) / 96)
              doc.renderPageToCanvasFilteredWithProfile(index, canvas, dpi / 96, 'all', 'print')
              pages.push({
                index,
                info,
                width: canvas.width,
                height: canvas.height,
                png: canvas.toDataURL('image/png').split(',')[1],
                tree: doc.getPageRenderTree(index),
                svg: doc.renderPageSvgWithProfile(index, 'print'),
              })
              canvas.width = canvas.height = 0
            }
            globalThis.__referenceCapture = {
              pages,
              fontPlan: JSON.parse(doc.getDocumentFontSelectionPlan()),
            }
          })
        },
      })
      const executed = await runtime.automation.execute('ext:reference-capture')
      if (!executed.ok)
        throw new Error(`Reference capture failed: ${executed.reason}: ${executed.message ?? ''}`)
      if (!globalThis.__referenceCapture)
        throw new Error('Reference command did not produce a capture')
      return globalThis.__referenceCapture
    },
    { dpi },
  )
  result.fontPlan = capture.fontPlan
  for (const pageData of capture.pages) {
    const name = `page-${String(pageData.index + 1).padStart(3, '0')}`
    await writeFile(join(out, `${name}.png`), Buffer.from(pageData.png, 'base64'))
    await writeFile(join(out, `${name}.svg`), pageData.svg)
    await writeFile(join(out, `${name}.tree.json`), pageData.tree)
    result.pages.push({
      index: pageData.index,
      info: pageData.info,
      width: pageData.width,
      height: pageData.height,
    })
  }
  result.completed = true
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  result.copyUnchanged =
    createHash('sha256')
      .update(await readFile(copy))
      .digest('hex') === result.inputSha256
  await writeFile(join(out, 'capture.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, fontPlan: undefined }))
}
