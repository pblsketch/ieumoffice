/** Profile the real PDF renderer without AI requests or writes to the input file. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, stat } from 'node:fs/promises'
import { tmpdir, freemem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { captureMemoryTrace } from './profile-memory-trace.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at < 0 ? fallback : args[at + 1]
}
const file = option('--file')
const out = option('--out')
if (!file || !out) throw new Error('Use --file <pdf> --out <json> [--steps 60]')
const steps = Number(option('--steps', '60'))
if (!Number.isInteger(steps) || steps < 2 || steps % 2)
  throw new Error('--steps must be even and >= 2')
const shell = args.includes('--shell')
const exactPages = args.includes('--exact-pages')
const fullSweeps = Number(option('--full-sweeps', '0'))
if (
  !Number.isInteger(fullSweeps) ||
  fullSweeps < 0 ||
  fullSweeps > 10 ||
  (fullSweeps && !exactPages)
)
  throw new Error('--full-sweeps must be 0..10 and requires --exact-pages')
const cpuProfile = option('--cpu-profile')
const softwareCanvas = args.includes('--software-canvas')
const memoryDiagnostic = args.includes('--memory-diagnostic')
const memoryTrace = option('--memory-trace')
const gpuCacheMiB = option('--gpu-cache-mib')
if (
  gpuCacheMiB !== undefined &&
  (!Number.isInteger(Number(gpuCacheMiB)) || Number(gpuCacheMiB) < 32 || Number(gpuCacheMiB) > 1024)
) {
  throw new Error('--gpu-cache-mib must be an integer in 32..1024')
}
const require = createRequire(join(root, 'package.json'))
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
const userData = await mkdtemp(join(tmpdir(), 'ieum-pdf-profile-'))
await writeFile(join(userData, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
await writeFile(
  join(userData, 'ai-settings.json'),
  JSON.stringify({
    providers: {},
    subscriptionNoticeSeen: true,
    subscriptionNoticeVersion: 2,
    pdfSendNoticeSeen: 1,
  }),
)
const started = performance.now()
const samples = []
const errors = []
const before = await stat(file)
const result = {
  fileBytes: before.size,
  steps,
  shell,
  exactPages,
  fullSweeps,
  softwareCanvas,
  gpuCacheMiB: gpuCacheMiB ? Number(gpuCacheMiB) : null,
  startedUtc: new Date().toISOString(),
  userData,
  samples,
  errors,
  visited: [],
  startupStages: [],
}
let app
let rendererProfiler
let page
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      `--user-data-dir=${userData}`,
      ...(softwareCanvas ? ['--disable-accelerated-2d-canvas'] : []),
      ...(gpuCacheMiB ? [`--force-gpu-mem-discardable-limit-mb=${gpuCacheMiB}`] : []),
      join(root, shell ? 'apps/shell' : 'apps/pdf/out/main/index.js'),
      resolve(file),
    ],
    env: { ...env, GENOFFICE_LANG: 'en', GENOFFICE_USER_DATA: userData },
    timeout: 60000,
  })
  result.startupStages.push({
    stage: 'electron-connected',
    elapsedMs: Math.round(performance.now() - started),
  })
  console.log(JSON.stringify({ phase: 'launched', shell }))
  result.gpuFeatureStatus = await app.evaluate(({ app }) => app.getGPUFeatureStatus())
  if (shell)
    console.log(
      JSON.stringify(
        await app.evaluate(({ app, webContents }) => ({
          phase: 'shell-startup',
          ready: app.isReady(),
          userData: app.getPath('userData'),
          views: webContents.getAllWebContents().map((wc) => ({ id: wc.id, url: wc.getURL() })),
        })),
      ),
    )
  page = await app.firstWindow({ timeout: 30000 })
  result.startupStages.push({
    stage: 'first-window',
    elapsedMs: Math.round(performance.now() - started),
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 960)
  })
  if (shell) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      let pdf
      for (const candidate of app.windows()) {
        const href =
          candidate.url() ||
          (await candidate.evaluate(() => globalThis.location.href).catch(() => ''))
        if (href.includes('://pdf/')) {
          pdf = candidate
          break
        }
      }
      if (pdf) {
        page = pdf
        break
      }
      await new Promise((done) => setTimeout(done, 100))
    }
    const href = page.url() || (await page.evaluate(() => globalThis.location.href))
    if (!href.includes('://pdf/')) throw new Error('The shell did not open its PDF view')
  }
  result.startupStages.push({
    stage: 'pdf-view-attached',
    elapsedMs: Math.round(performance.now() - started),
  })
  page.on('pageerror', (error) => {
    if (errors.length < 20) errors.push(error.message)
  })
  if (cpuProfile) {
    rendererProfiler = await page.context().newCDPSession(page)
    await rendererProfiler.send('Profiler.enable')
    await rendererProfiler.send('Profiler.setSamplingInterval', { interval: 1000 })
    await rendererProfiler.send('Profiler.start')
    await app.evaluate(async (_electron, inputPath) => {
      const fs = process.getBuiltinModule('fs')
      const original = fs.createReadStream
      globalThis.__pdfProfileOriginalCreateReadStream = original
      globalThis.__pdfProfileReads = []
      fs.createReadStream = function (...args) {
        const started = performance.now()
        const stream = Reflect.apply(original, this, args)
        const row = {
          input: String(args[0]).toLowerCase() === inputPath.toLowerCase(),
          highWaterMark: stream.readableHighWaterMark,
          stack: new Error().stack.split('\n').slice(2, 5),
        }
        globalThis.__pdfProfileReads.push(row)
        stream.once('close', () => {
          row.bytes = stream.bytesRead
          row.ms = Math.round(performance.now() - started)
        })
        return stream
      }
      const { Session } = process.getBuiltinModule('inspector')
      const session = new Session()
      session.connect()
      globalThis.__pdfProfileMainSession = session
      await new Promise((done, reject) =>
        session.post('Profiler.enable', (error) => (error ? reject(error) : done())),
      )
      await new Promise((done, reject) =>
        session.post('Profiler.start', (error) => (error ? reject(error) : done())),
      )
    }, resolve(file))
  }
  await page.evaluate(() => {
    globalThis.window.__pdfProfileLongTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        globalThis.window.__pdfProfileLongTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.locator('.pdf-page').first().waitFor({ timeout: 120000 })
  result.readyMs = Math.round(performance.now() - started)
  result.readyCriterion = 'document page placeholders available'
  await page
    .locator('.pdf-page[data-page="0"] .pdf-page-content canvas')
    .waitFor({ timeout: 30000 })
  result.firstCanvasMs = Math.round(performance.now() - started)
  if (exactPages) {
    for (let n = 0; n < 30; n++) {
      const zoom = Number((await page.locator('.tb-zoom').first().textContent())?.replace('%', ''))
      if (zoom === 100) break
      await page
        .getByRole('button', { name: zoom > 100 ? 'Zoom out' : 'Zoom in', exact: true })
        .first()
        .evaluate((button) => button.click())
      await page.waitForTimeout(30)
    }
    await page.waitForTimeout(200)
  }
  result.display = await page.evaluate(() => ({
    zoom: globalThis.document.querySelector('.tb-zoom')?.textContent,
    dpr: globalThis.devicePixelRatio,
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  }))
  const count = await page.locator('.pdf-page').count()
  result.pageCount = count
  result.ocrAvailable = await page.evaluate(() => globalThis.window.pdfApi.ocrAvailable?.() ?? null)
  const moves = fullSweeps ? count * fullSweeps : steps
  result.steps = moves
  if (fullSweeps) {
    result.sweepReadiness =
      'Target page canvas attached after render, then two animation frames; not physical display latency'
    result.sweepEndpoints = []
  }
  const sample = async (step) => {
    const samplingStarted = performance.now()
    const runtime = await app.evaluate(({ app }) => ({
      mainMemory: process.memoryUsage(),
      processes: app.getAppMetrics().map((p) => ({
        type: p.type,
        pid: p.pid,
        memory: p.memory,
        cpu: p.cpu.percentCPUUsage,
      })),
    }))
    const processes = runtime.processes
    const view = await page.evaluate(() => {
      const scroll = globalThis.document.querySelector('.pdf-scroll')
      const canvases = [...globalThis.document.querySelectorAll('canvas')]
      return {
        scrollTop: scroll?.scrollTop,
        scrollHeight: scroll?.scrollHeight,
        canvasPixels: canvases.reduce((sum, c) => sum + c.width * c.height, 0),
        canvases: canvases.length,
        nativeWasmBytes: Math.max(
          0,
          ...canvases.map((canvas) => Number(canvas.dataset.pdfViewWasmBytes) || 0),
        ),
        renderBackends: Object.fromEntries(
          ['file', 'pdfjs'].map((backend) => [
            backend,
            canvases.filter(
              (canvas) => canvas.width > 0 && canvas.dataset.pdfViewBackend === backend,
            ).length,
          ]),
        ),
        domNodes: globalThis.document.getElementsByTagName('*').length,
        heapBytes: performance.memory?.usedJSHeapSize,
        longTasks: globalThis.window.__pdfProfileLongTasks.splice(0),
      }
    })
    const entry = {
      mainMemory: runtime.mainMemory,
      step,
      elapsedMs: Math.round(performance.now() - started),
      freeBytes: freemem(),
      processes,
      ...view,
      samplingMs: Math.round(performance.now() - samplingStarted),
    }
    samples.push(entry)
    console.log(
      JSON.stringify({
        step,
        ms: entry.elapsedMs,
        heapMB: Math.round((view.heapBytes ?? 0) / 1048576),
        privateMB: Math.round(processes.reduce((sum, p) => sum + p.memory.privateBytes, 0) / 1024),
        canvasMB: Math.round((view.canvasPixels * 4) / 1048576),
      }),
    )
    if (entry.freeBytes < 768 * 1048576)
      throw new Error('Stopped: system free memory below 768 MiB')
    if (processes.reduce((sum, p) => sum + p.memory.privateBytes, 0) > 3 * 1048576)
      throw new Error('Stopped: app private memory above 3 GiB')
  }
  await sample(0)
  for (let i = 1; i <= moves; i++) {
    const progress = i <= steps / 2 ? (i * 2) / steps : 2 - (i * 2) / steps
    const pageNo = fullSweeps ? ((i - 1) % count) + 1 : 1 + Math.round((count - 1) * progress)
    const navigationStarted = performance.now()
    if (exactPages)
      await page
        .locator(`.pdf-page[data-page="${pageNo - 1}"]`)
        .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    else
      await page.locator('.pdf-scroll').evaluate((el, progress) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * progress
      }, progress)
    const visit = {
      step: i,
      page: pageNo,
      commandMs: Math.round(performance.now() - navigationStarted),
    }
    if (fullSweeps) {
      const canvas = page.locator(`.pdf-page[data-page="${pageNo - 1}"] .pdf-page-content canvas`)
      await canvas.waitFor({ state: 'attached', timeout: 30000 })
      visit.backend = await canvas.evaluate((el) => el.dataset.pdfViewBackend)
      await page.evaluate(
        () =>
          new Promise((done) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done)),
          ),
      )
      visit.canvasAndFramesMs = Math.round(performance.now() - navigationStarted)
    }
    result.visited.push(visit)
    await page.waitForTimeout(200)
    if (i % 5 === 0 || i === moves) await sample(i)
    if (fullSweeps && i % count === 0) {
      await page.waitForTimeout(3000)
      const sweep = i / count
      await sample(`sweep-${sweep}-settled`)
      result.sweepEndpoints.push({ sweep, page: pageNo, sampleIndex: samples.length - 1 })
    }
  }
  await page.waitForTimeout(3000)
  await sample('settled')
  const screenshot = option('--screenshot')
  if (screenshot) await page.screenshot({ path: resolve(screenshot) })
  result.completed = true
} catch (error) {
  result.failure = String(error)
  console.error(result.failure)
  process.exitCode = 1
} finally {
  if (rendererProfiler) {
    try {
      const profile = await rendererProfiler.send('Profiler.stop')
      await writeFile(`${resolve(cpuProfile)}-renderer.cpuprofile`, JSON.stringify(profile.profile))
    } catch (error) {
      result.profileFailure = String(error)
    }
    try {
      const profile = await app.evaluate(async () => {
        const session = globalThis.__pdfProfileMainSession
        const result = await new Promise((done, reject) =>
          session.post('Profiler.stop', (error, value) => (error ? reject(error) : done(value))),
        )
        session.disconnect()
        process.getBuiltinModule('fs').createReadStream =
          globalThis.__pdfProfileOriginalCreateReadStream
        delete globalThis.__pdfProfileOriginalCreateReadStream
        delete globalThis.__pdfProfileMainSession
        return { profile: result.profile, reads: globalThis.__pdfProfileReads }
      })
      await writeFile(`${resolve(cpuProfile)}-main.cpuprofile`, JSON.stringify(profile.profile))
      result.profileReads = profile.reads
    } catch (error) {
      result.mainProfileFailure = String(error)
    }
  }
  if (app) {
    if (page && memoryTrace) {
      try {
        result.nativeMemoryTrace = await captureMemoryTrace(page, memoryTrace)
      } catch (error) {
        result.nativeMemoryTraceFailure = String(error)
      }
    }
    if (memoryDiagnostic) {
      try {
        const renderer = await page.context().newCDPSession(page)
        await renderer.send('HeapProfiler.enable')
        await renderer.send('HeapProfiler.collectGarbage')
        await renderer.detach()
        result.memoryDiagnostic = await app.evaluate(async ({ app }) => {
          const before = process.memoryUsage()
          const { Session } = process.getBuiltinModule('inspector')
          const session = new Session()
          session.connect()
          await new Promise((done, reject) =>
            session.post('HeapProfiler.enable', (error) => (error ? reject(error) : done())),
          )
          await new Promise((done, reject) =>
            session.post('HeapProfiler.collectGarbage', (error) =>
              error ? reject(error) : done(),
            ),
          )
          session.disconnect()
          return {
            before,
            after: process.memoryUsage(),
            processes: app.getAppMetrics().map((p) => ({ type: p.type, memory: p.memory })),
          }
        })
      } catch (error) {
        result.memoryDiagnosticFailure = String(error)
      }
    }
    const closing = app.close().then(
      () => true,
      () => true,
    )
    let timer
    const closed = await Promise.race([
      closing,
      new Promise((done) => {
        timer = setTimeout(() => done(false), 15000)
      }),
    ])
    clearTimeout(timer)
    if (!closed) {
      result.closeTimeout = true
      // This PID belongs to the scratch application launched above, never a user's install.
      if (process.platform === 'win32')
        await new Promise((done) =>
          execFile(
            'taskkill.exe',
            ['/PID', String(app.process().pid), '/T', '/F'],
            { windowsHide: true },
            () => done(),
          ),
        )
      else app.process().kill()
      await closing
    }
  }
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  await writeFile(resolve(out), JSON.stringify(result, null, 2))
}
