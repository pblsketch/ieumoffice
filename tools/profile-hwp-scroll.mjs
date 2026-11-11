/** Profile HWP viewing against an isolated copy, without editing or AI requests. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { copyFile, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir, freemem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback)
const file = option('--file')
const out = option('--out')
const steps = Number(option('--steps', 60))
const cpuProfile = option('--cpu-profile')
if (!file || !out || !Number.isInteger(steps) || steps < 2 || steps % 2)
  throw new Error('Use --file <hwp> --out <json> [--steps 60]')
const before = await stat(file)
const userData = await mkdtemp(join(tmpdir(), 'ieum-hwp-profile-'))
const copy = join(userData, basename(file))
await copyFile(resolve(file), copy)
const copyBefore = await stat(copy)
await writeFile(join(userData, 'app-settings.json'), JSON.stringify({ onboardingSeen: true }))
await writeFile(
  join(userData, 'ai-settings.json'),
  JSON.stringify({ providers: {}, subscriptionNoticeSeen: true, subscriptionNoticeVersion: 2 }),
)
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
const require = createRequire(join(root, 'package.json'))
const result = { fileBytes: before.size, steps, userData, samples: [], errors: [], visited: [] }
const started = performance.now()
let app
let profileSession
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [`--user-data-dir=${userData}`, join(root, 'apps/shell'), copy],
    env: { ...env, GENOFFICE_LANG: 'en', GENOFFICE_USER_DATA: userData },
    timeout: 60000,
  })
  console.log(JSON.stringify({ phase: 'launched', format: 'hwp' }))
  await app.firstWindow({ timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 960),
  )
  let page
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const href =
        candidate.url() ||
        (await candidate.evaluate(() => globalThis.location.href).catch(() => ''))
      if (href.includes('://hwp/')) {
        page = candidate
        break
      }
    }
    if (page) break
    await new Promise((done) => setTimeout(done, 100))
  }
  if (!page) throw new Error('HWP view was not created')
  page.on('pageerror', (error) => {
    if (result.errors.length < 20) result.errors.push(error.message)
  })
  await page.locator('.hwp-app[data-phase="ready"]').waitFor({ timeout: 120000 })
  const studio = page.frames().find((frame) => frame.url().includes('/studio/'))
  if (!studio) throw new Error('Studio frame not found')
  await studio.locator('#scroll-container').waitFor({ timeout: 30000 })
  result.readyMs = Math.round(performance.now() - started)
  result.readyCriterion = 'host reports file loaded and studio scroll container exists'
  if (cpuProfile) {
    profileSession = await page.context().newCDPSession(page)
    await profileSession.send('Profiler.enable')
    await profileSession.send('Profiler.start')
  }
  await studio.evaluate(() => {
    globalThis.__hwpProfileLongTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__hwpProfileLongTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
  const sample = async (step) => {
    const processes = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({ type: p.type, pid: p.pid, memory: p.memory })),
    )
    const view = await studio.evaluate(() => {
      const scroll = globalThis.document.querySelector('#scroll-container')
      const canvases = [...globalThis.document.querySelectorAll('canvas')]
      return {
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        canvasPixels: canvases.reduce((n, c) => n + c.width * c.height, 0),
        canvases: canvases.length,
        domNodes: globalThis.document.getElementsByTagName('*').length,
        heapBytes: performance.memory?.usedJSHeapSize,
        longTasks: globalThis.__hwpProfileLongTasks.splice(0),
      }
    })
    const row = { step, elapsedMs: Math.round(performance.now() - started), processes, ...view }
    result.samples.push(row)
    const privateMiB = processes.reduce((n, p) => n + p.memory.privateBytes, 0) / 1024
    console.log(
      JSON.stringify({
        step,
        ms: row.elapsedMs,
        privateMiB: Math.round(privateMiB),
        canvasMiB: Math.round((view.canvasPixels * 4) / 1048576),
      }),
    )
    if (privateMiB > 3072 || freemem() < 768 * 1048576) throw new Error('Stopped at memory budget')
  }
  await sample(0)
  for (let step = 1; step <= steps; step++) {
    const progress = step <= steps / 2 ? (step * 2) / steps : 2 - (step * 2) / steps
    const tick = performance.now()
    await studio.locator('#scroll-container').evaluate((el, p) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * p
    }, progress)
    result.visited.push({ step, commandMs: Math.round(performance.now() - tick) })
    await page.waitForTimeout(200)
    if (step % 5 === 0 || step === steps) await sample(step)
  }
  await page.waitForTimeout(3000)
  await sample('settled')
  if (args.includes('--wasm-memory')) {
    const session = await page.context().newCDPSession(page)
    const contexts = []
    session.on('Runtime.executionContextCreated', (event) => contexts.push(event.context))
    try {
      await session.send('Runtime.enable')
      const { frameTree } = await session.send('Page.getFrameTree')
      const findStudio = (tree) =>
        tree.frame.url.includes('/studio/')
          ? tree.frame
          : tree.childFrames?.map(findStudio).find(Boolean)
      const frame = findStudio(frameTree)
      const context = contexts.find(
        (context) => context.auxData?.frameId === frame?.id && context.auxData?.isDefault,
      )
      if (!context) throw new Error('Studio execution context not found')
      const proto = await session.send('Runtime.evaluate', {
        expression: 'WebAssembly.Memory.prototype',
        contextId: context.id,
        objectGroup: 'hwp-memory-profile',
      })
      const memories = await session.send('Runtime.queryObjects', {
        prototypeObjectId: proto.result.objectId,
        objectGroup: 'hwp-memory-profile',
      })
      const sizes = await session.send('Runtime.callFunctionOn', {
        objectId: memories.objects.objectId,
        functionDeclaration: 'function() { return this.map(memory => memory.buffer.byteLength) }',
        returnByValue: true,
      })
      result.frameWasmMemoryBytes = sizes.result.value
      result.memoryProbeNote =
        'Studio-frame memories only; queryObjects can trigger GC after the timed samples'
      await session.send('Runtime.releaseObjectGroup', { objectGroup: 'hwp-memory-profile' })
    } catch (error) {
      result.memoryProbeFailure = String(error)
    } finally {
      await session.detach()
    }
  }
  result.completed = true
} catch (error) {
  result.failure = String(error)
  console.error(result.failure)
  process.exitCode = 1
} finally {
  if (profileSession) {
    const { profile } = await profileSession.send('Profiler.stop')
    await writeFile(resolve(cpuProfile), JSON.stringify(profile))
    await profileSession.detach()
  }
  if (app) await app.close().catch(() => {})
  const after = await stat(file)
  const copyAfter = await stat(copy)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  result.copyUnchanged =
    copyBefore.size === copyAfter.size && copyBefore.mtimeMs === copyAfter.mtimeMs
  await writeFile(resolve(out), JSON.stringify(result, null, 2))
}
