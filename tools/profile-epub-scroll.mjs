/** Profile the real EPUB reader with a fresh profile and without editing or AI requests. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, stat } from 'node:fs/promises'
import { tmpdir, freemem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback)
const file = option('--file')
const out = option('--out')
const steps = Number(option('--steps', '60'))
const fullSweeps = Number(option('--full-sweeps', '0'))
const shell = args.includes('--shell')
const cpuProfile = option('--cpu-profile')
if (
  !file ||
  !out ||
  !Number.isInteger(steps) ||
  steps < 2 ||
  steps % 2 ||
  !Number.isInteger(fullSweeps) ||
  fullSweeps < 0 ||
  fullSweeps > 4
) {
  throw new Error('Use --file <epub> --out <json> [--shell] [--steps <even number>]')
}
const before = await stat(file)
const require = createRequire(join(root, 'package.json'))
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
const userData = await mkdtemp(join(tmpdir(), 'ieum-epub-profile-'))
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
const result = {
  fileBytes: before.size,
  shell,
  steps,
  fullSweeps,
  startedUtc: new Date().toISOString(),
  userData,
  samples: [],
  visited: [],
  errors: [],
  startupStages: [],
}
const started = performance.now()
let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      `--user-data-dir=${userData}`,
      join(root, shell ? 'apps/shell' : 'apps/epub/out/main/index.js'),
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
  await app.firstWindow({ timeout: 30000 })
  result.startupStages.push({
    stage: 'first-window',
    elapsedMs: Math.round(performance.now() - started),
  })
  if (cpuProfile) {
    await app.evaluate(async () => {
      const { Session } = process.getBuiltinModule('inspector')
      const session = new Session()
      session.connect()
      globalThis.__epubMainProfile = session
      await new Promise((done, reject) =>
        session.post('Profiler.enable', (error) => (error ? reject(error) : done())),
      )
      await new Promise((done, reject) =>
        session.post('Profiler.start', (error) => (error ? reject(error) : done())),
      )
    })
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 960),
  )
  let page
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const href =
        candidate.url() ||
        (await candidate.evaluate(() => globalThis.location.href).catch(() => ''))
      if (href.includes('://epub/')) {
        page = candidate
        break
      }
    }
    if (page) break
    await new Promise((done) => setTimeout(done, 100))
  }
  if (!page) throw new Error('EPUB view was not created')
  result.startupStages.push({
    stage: 'epub-view-attached',
    elapsedMs: Math.round(performance.now() - started),
  })
  page.on('pageerror', (error) => {
    if (result.errors.length < 20) result.errors.push(error.message)
  })
  await page.evaluate(() => {
    globalThis.window.__epubProfileLongTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        globalThis.window.__epubProfileLongTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
  const frameReady = () =>
    page.waitForFunction(
      () => {
        const doc = globalThis.document.querySelector('iframe.epub-frame')?.contentDocument
        return doc?.getElementById('genoffice-epub-view') && doc.readyState === 'complete'
      },
      undefined,
      { timeout: 120000 },
    )
  await frameReady()
  result.readyMs = Math.round(performance.now() - started)
  result.readyCriterion = 'first chapter iframe loaded, including its initial assets'
  const openTiming = await app.evaluate(() => {
    const timing = process.getBuiltinModule('perf_hooks').performance
    const stages = timing
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('ieum.epub.open.'))
      .map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
        detail: entry.detail,
      }))
    return { timeOrigin: timing.timeOrigin, stages }
  })
  result.openStages = openTiming.stages
  result.mainTimeOrigin = openTiming.timeOrigin
  result.firstChapterTiming = await page.locator('iframe.epub-frame').evaluate((frame) => {
    const timing = frame.contentWindow?.performance
    const navigation = timing?.getEntriesByType('navigation')[0]
    return {
      observedEpochMs: Date.now(),
      frameTimeOrigin: timing?.timeOrigin,
      frameLoadEventEnd: navigation?.loadEventEnd,
      legacyLoadEpochMs: timing?.timing?.loadEventEnd,
      parentTimeOrigin: performance.timeOrigin,
    }
  })
  result.display = await page.evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    dpr: globalThis.devicePixelRatio,
  }))
  const entries = page.locator('.epub-toc-entry')
  const count = await entries.count()
  if (count < 2) throw new Error('The fixture must have navigable chapter entries')
  result.tocEntries = count
  if (fullSweeps) result.sweepEndpoints = []
  const sample = async (step) => {
    const samplingStarted = performance.now()
    const processes = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({ type: p.type, pid: p.pid, memory: p.memory })),
    )
    const view = await page.evaluate(() => {
      const doc = globalThis.document.querySelector('iframe.epub-frame')?.contentDocument
      return {
        chapter: globalThis.document.querySelector('.epub-status-chapter')?.textContent,
        chapterNodes: doc?.getElementsByTagName('*').length,
        images: doc?.images.length,
        incompleteImages: [...(doc?.images ?? [])].filter((img) => !img.complete).length,
        frameScrollTop: doc?.scrollingElement?.scrollTop,
        heapBytes: performance.memory?.usedJSHeapSize,
        longTasks: globalThis.window.__epubProfileLongTasks.splice(0),
      }
    })
    const row = {
      step,
      elapsedMs: Math.round(performance.now() - started),
      samplingMs: Math.round(performance.now() - samplingStarted),
      processes,
      ...view,
    }
    result.samples.push(row)
    const privateMiB = processes.reduce((sum, p) => sum + p.memory.privateBytes, 0) / 1024
    console.log(
      JSON.stringify({
        step,
        ms: row.elapsedMs,
        privateMiB: Math.round(privateMiB),
        chapter: view.chapter,
        samplingMs: row.samplingMs,
      }),
    )
    if (privateMiB > 3072 || freemem() < 768 * 1048576)
      throw new Error('Stopped at memory safety budget')
  }
  await sample(0)
  const visits = fullSweeps ? fullSweeps * count : steps
  for (let step = 1; step <= visits; step++) {
    const progress = step <= steps / 2 ? (step * 2) / steps : 2 - (step * 2) / steps
    const entry = fullSweeps ? (step - 1) % count : Math.round((count - 1) * progress)
    const navigationStarted = performance.now()
    // Use the real TOC handler. A browser click would add auto-scroll/stability waits to the measurement.
    await entries.nth(entry).evaluate((button) => button.click())
    await frameReady()
    const expectedTitle = await entries.nth(entry).getAttribute('title')
    await page.waitForFunction(
      (title) =>
        globalThis.document.querySelector('iframe.epub-frame')?.getAttribute('title') === title,
      expectedTitle,
      { timeout: 30000 },
    )
    await frameReady()
    await page.locator('iframe.epub-frame').evaluate((frame) => {
      const doc = frame.contentDocument
      doc?.defaultView?.scrollTo(0, (doc.scrollingElement?.scrollHeight ?? 0) / 2)
    })
    result.visited.push({
      step,
      entry,
      commandMs: Math.round(performance.now() - navigationStarted),
    })
    await page.waitForTimeout(200)
    if (step % 5 === 0 || (fullSweeps && step % count === 0)) await sample(step)
    if (fullSweeps && step % count === 0) {
      await page.waitForTimeout(3000)
      const sweep = step / count
      await sample(`sweep-${sweep}-settled`)
      result.sweepEndpoints.push({ sweep, entry, sampleIndex: result.samples.length - 1 })
    }
  }
  await page.waitForTimeout(3000)
  await sample('settled')
  const screenshot = option('--screenshot')
  if (screenshot) await page.screenshot({ path: resolve(screenshot) })
  result.completed = true
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
  console.error(result.failure)
} finally {
  if (app && cpuProfile) {
    try {
      const profile = await app.evaluate(async () => {
        const session = globalThis.__epubMainProfile
        const result = await new Promise((done, reject) =>
          session.post('Profiler.stop', (error, value) => (error ? reject(error) : done(value))),
        )
        session.disconnect()
        delete globalThis.__epubMainProfile
        return result.profile
      })
      await writeFile(resolve(cpuProfile), JSON.stringify(profile))
    } catch (error) {
      result.profileFailure = String(error)
    }
  }
  if (app) await app.close().catch(() => {})
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  await writeFile(resolve(out), JSON.stringify(result, null, 2))
}
