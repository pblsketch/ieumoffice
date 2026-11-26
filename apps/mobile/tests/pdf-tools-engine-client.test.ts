// @vitest-environment node
/**
 * The screen-side engine handle (tools/engine/client.ts) and the worker host
 * (host.ts) over a fake Worker: messages are passed with structuredClone and
 * their transfer lists, as postMessage does, so a buffer handed over is
 * detached on the sending side. The host runs the real core on PDFium wasm
 * from node_modules (Node has no module Worker to start worker.ts in).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ImageRecoder } from '@genoffice/pdf-ops'
import {
  PdfToolsEngineError,
  createPdfToolsEngine,
  type WorkerLike,
} from '../src/renderer/tools/engine/client'
import {
  createEngineCore,
  initPdfium,
  type CoreDeps,
  type EnginePdfium,
} from '../src/renderer/tools/engine/core'
import { serveEngine, type HostScope } from '../src/renderer/tools/engine/host'
import type { PictureOps } from '../src/renderer/tools/engine/picture'
import type { FromWorker, ToWorker } from '../src/renderer/tools/engine/protocol'
import type { ToolFile } from '../src/renderer/tools/engine/types'
import {
  blankCandidatesPdf,
  compressSample,
  jpeg,
  png,
  textPdf,
} from '../../shell/tests/helpers/pdf-tools-fixtures'

const require = createRequire(import.meta.url)

let pdfiumPromise: Promise<EnginePdfium> | null = null
function loadNodePdfium(): Promise<EnginePdfium> {
  pdfiumPromise ??= (async () => {
    const { init } = await import('@embedpdf/pdfium')
    const raw = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    return initPdfium(init as (o: object) => Promise<unknown>, { wasmBinary })
  })()
  return pdfiumPromise
}

const fakeRecoder: ImageRecoder = async (source, target) => {
  const scale = Math.min(1, target.longSide / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round((source.width * scale) / 2))
  const height = Math.max(1, Math.round((source.height * scale) / 2))
  return { jpeg: jpeg(width, height, target.quality * 10), width, height }
}

const pictures = (recode: ImageRecoder = fakeRecoder): PictureOps => ({
  decodable: async (bytes) => new TextDecoder().decode(bytes.slice(0, 4)) === 'HEIC',
  toJpeg: async () => jpeg(64, 48),
  recode,
})

const coreDeps =
  (overrides: Partial<CoreDeps> = {}) =>
  (picture: PictureOps) =>
    createEngineCore({
      loadPdfium: loadNodePdfium,
      loadQpdf: async () => {
        throw new Error('qpdf is not used here')
      },
      pictures: picture,
      randomBytes: (n) => new Uint8Array(n),
      ...overrides,
    })

type Listener = (event: { data: unknown }) => void

/** A Worker stand-in running the host in this process; postMessage clones and transfers */
class FakeWorker implements WorkerLike {
  terminated = false
  readonly toWorker: ToWorker[] = []
  readonly fromWorker: FromWorker[] = []
  private screen: Listener[] = []
  private errors: ((event: unknown) => void)[] = []
  private host: Listener[] = []

  constructor(start: (scope: HostScope) => void) {
    const scope: HostScope = {
      postMessage: (message, transfer) => {
        if (this.terminated) return
        const copy = structuredClone(message, { transfer })
        setTimeout(() => {
          if (this.terminated) return
          this.fromWorker.push(copy)
          for (const listener of this.screen) listener({ data: copy })
        })
      },
      addEventListener: (_type, listener) => void this.host.push(listener as Listener),
    }
    start(scope)
  }

  postMessage(message: ToWorker, transfer: Transferable[]): void {
    if (this.terminated) return
    const copy = structuredClone(message, { transfer })
    setTimeout(() => {
      if (this.terminated) return
      this.toWorker.push(copy)
      for (const listener of this.host) listener({ data: copy })
    })
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.screen.push(listener as Listener)
    if (type === 'error') this.errors.push(listener as (event: unknown) => void)
  }

  terminate(): void {
    this.terminated = true
  }

  /** the worker dies (the web view ran out of memory) */
  crash(): void {
    for (const listener of this.errors) listener(new Event('error'))
  }
}

function fakeWorkers(
  makeCore = coreDeps(),
  local: PictureOps | null = pictures(),
): { made: FakeWorker[]; create: () => WorkerLike } {
  const made: FakeWorker[] = []
  return {
    made,
    create: () => {
      const worker = new FakeWorker((scope) => serveEngine(scope, makeCore, local))
      made.push(worker)
      return worker
    },
  }
}

/** A picked file that records the arrays it handed out */
function file(name: string, bytes: Uint8Array, mime = 'application/pdf') {
  const handed: Uint8Array[] = []
  const picked: ToolFile & { handed: Uint8Array[] } = {
    name,
    mime,
    handed,
    async readBytes() {
      const copy = bytes.slice()
      handed.push(copy)
      return copy
    },
  }
  return picked
}

const never = (name: string): ToolFile => ({
  name,
  mime: 'application/pdf',
  readBytes: () => new Promise<Uint8Array>(() => {}),
})

let text3: Uint8Array
let text2: Uint8Array
let blank: Uint8Array
let compress: Uint8Array

beforeAll(async () => {
  text3 = await textPdf(['Page one', '', 'Page three'])
  text2 = await textPdf(['a', 'b'])
  blank = await blankCandidatesPdf()
  compress = await compressSample()
  await loadNodePdfium()
}, 60_000)

describe('the engine client', () => {
  it('runs a tool in the worker, handing each input over without a copy, one at a time', async () => {
    const workers = fakeWorkers()
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    const a = file('a.pdf', text3)
    const b = file('b.pdf', text2)
    const progress: [number, number][] = []
    const outcome = await engine.run('merge', [a, b], {}, (d, t) => progress.push([d, t]))
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.files.map((f) => [f.name, f.mime])).toEqual([
      ['a-merged.pdf', 'application/pdf'],
    ])
    expect((await PDFDocument.load(outcome.files[0]!.bytes)).getPageCount()).toBe(5)
    // each file was read once and its buffer went to the worker (detached here)
    expect(a.handed.map((x) => x.byteLength)).toEqual([0])
    expect(b.handed.map((x) => x.byteLength)).toEqual([0])
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    const sent = workers.made[0]!.toWorker.map((m) =>
      m.type === 'input' ? `input ${m.index}` : m.type,
    )
    expect(sent).toEqual(['run', 'input 0', 'input 1'])
    // the options and names travel in the run message; the bytes only as inputs
    const asked = workers.made[0]!.fromWorker.filter((m) => m.type === 'need-input')
    expect(asked.map((m) => m.type === 'need-input' && m.index)).toEqual([0, 1])
    engine.dispose()
  })

  it('inspects a file and gives its size', async () => {
    const engine = createPdfToolsEngine({ createWorker: fakeWorkers().create })
    const a = file('a.pdf', text3)
    expect(await engine.inspect(a, 'merge')).toEqual({
      ok: true,
      pages: 3,
      sizeBytes: text3.length,
    })
    expect(a.handed[0]!.byteLength).toBe(0)
    expect(await engine.inspect(file('a.pdf', text3), 'decrypt')).toEqual({
      ok: false,
      problem: 'not-encrypted',
      sizeBytes: text3.length,
    })
    engine.dispose()
  })

  it('sends picture work to the screen thread when the worker has no OffscreenCanvas', async () => {
    const workers = fakeWorkers(coreDeps(), null)
    const screenRecode = vi.fn(fakeRecoder)
    const engine = createPdfToolsEngine({
      createWorker: workers.create,
      pictures: pictures(screenRecode),
    })
    const heic = new TextEncoder().encode('HEIC photo')
    expect(await engine.inspect(file('p.heic', heic, 'image/heic'), 'imagesToPdf')).toEqual({
      ok: true,
      pages: 1,
      sizeBytes: heic.length,
    })
    const photos = await engine.run(
      'imagesToPdf',
      [file('p.heic', heic, 'image/heic'), file('q.png', png(20, 10), 'image/png')],
      {},
    )
    expect(photos.ok && photos.files[0]!.name).toBe('p.pdf')

    const remote = await engine.run('compress', [file('big.pdf', compress)], {})
    const local = await createPdfToolsEngine({ createWorker: fakeWorkers().create }).run(
      'compress',
      [file('big.pdf', compress)],
      {},
    )
    if (!remote.ok || !local.ok) throw new Error('compress failed')
    expect(remote.files[0]!.bytes).toEqual(local.files[0]!.bytes)
    expect(remote.sizeBefore).toBe(compress.length)
    expect(screenRecode).toHaveBeenCalled()
    const ops = workers.made[0]!.fromWorker.flatMap((m) =>
      m.type === 'picture' ? [m.request.op] : [],
    )
    expect(new Set(ops)).toEqual(new Set(['decodable', 'toJpeg', 'recode']))
    engine.dispose()
  })

  it('finds blank pages with ImageData thumbnails in RGBA', async () => {
    const engine = createPdfToolsEngine({ createWorker: fakeWorkers().create })
    const progress: number[] = []
    const found = await engine.findBlankPages(file('scan.pdf', blank), (done) =>
      progress.push(done),
    )
    if (!found.ok) throw new Error(found.reason)
    expect(found.candidates.length).toBeGreaterThan(0)
    const first = found.candidates[0]!
    expect(first.thumb).not.toBeNull()
    expect(first.thumb!.data.length).toBe(first.thumb!.width * first.thumb!.height * 4)
    expect(first.thumb!.data[3]).toBe(255)
    expect(progress.at(-1)).toBe(found.pageCount)
    engine.dispose()
  })

  it('zips results without taking them from the screen', async () => {
    const engine = createPdfToolsEngine({ createWorker: fakeWorkers().create })
    const parts = [
      { name: 'b-1.pdf', mime: 'application/pdf' as const, bytes: new TextEncoder().encode('one') },
      { name: 'b-2.pdf', mime: 'application/pdf' as const, bytes: new TextEncoder().encode('two') },
    ]
    const zip = await engine.zip(parts, 'b-split.zip')
    expect(zip.name).toBe('b-split.zip')
    expect(parts.map((p) => p.bytes.byteLength)).toEqual([3, 3])
    const read = await JSZip.loadAsync(zip.bytes)
    expect(Object.keys(read.files)).toEqual(['b-1.pdf', 'b-2.pdf'])
    engine.dispose()
  })

  it('runs one job at a time, in the order they were asked for', async () => {
    const workers = fakeWorkers()
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    const order: string[] = []
    const jobs = [
      engine.run('reverse', [file('a.pdf', text3)], {}).then(() => order.push('reverse')),
      engine.inspect(file('b.pdf', text2), 'merge').then(() => order.push('inspect')),
      engine.run('rotate', [file('c.pdf', text2)], {}).then(() => order.push('rotate')),
    ]
    await Promise.all(jobs)
    expect(order).toEqual(['reverse', 'inspect', 'rotate'])
    const sent = workers.made[0]!.toWorker.map((m) => m.type)
    expect(sent).toEqual(['run', 'input', 'inspect', 'run', 'input'])
    const done = workers.made[0]!.fromWorker.map((m) => m.type)
    // each job's first message goes only after the one before answered
    expect(done.filter((t) => t === 'done')).toHaveLength(3)
    expect(workers.made).toHaveLength(1)
    engine.dispose()
  })

  it('stops at once: the running and queued calls settle as stopped, the next one gets a fresh worker', async () => {
    const workers = fakeWorkers()
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    const running = engine.run('merge', [file('a.pdf', text3), never('b.pdf')], {})
    const queued = engine.inspect(file('c.pdf', text3), 'merge')
    const queuedZip = engine.zip([], 'x.zip')
    await vi.waitFor(() =>
      expect(
        workers.made[0]!.fromWorker.some((m) => m.type === 'need-input' && m.index === 1),
      ).toBe(true),
    )
    engine.stop()
    expect(await running).toEqual({ ok: false, reason: 'stopped' })
    await expect(queued).rejects.toEqual(new PdfToolsEngineError('stopped'))
    await expect(queuedZip).rejects.toBeInstanceOf(PdfToolsEngineError)
    expect(workers.made[0]!.terminated).toBe(true)

    const again = await engine.run('reverse', [file('a.pdf', text3)], {})
    expect(again.ok).toBe(true)
    expect(workers.made).toHaveLength(2)
    engine.dispose()
  })

  it('answers too large when the worker dies, and starts a fresh worker for the next call', async () => {
    const workers = fakeWorkers()
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    const running = engine.run('merge', [file('a.pdf', text3), never('b.pdf')], {})
    await vi.waitFor(() => expect(workers.made[0]!.toWorker.length).toBeGreaterThan(1))
    workers.made[0]!.crash()
    expect(await running).toEqual({ ok: false, reason: 'too-large' })
    expect(workers.made[0]!.terminated).toBe(true)
    expect((await engine.run('reverse', [file('a.pdf', text3)], {})).ok).toBe(true)
    expect(workers.made).toHaveLength(2)
    engine.dispose()
  })

  it('answers failed, not too large, when the worker script never loads', async () => {
    const errors: ((event: unknown) => void)[] = []
    let terminated = false
    const silent: WorkerLike = {
      postMessage: () => {},
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === 'error') errors.push(listener as (event: unknown) => void)
      },
      terminate: () => {
        terminated = true
      },
    }
    const engine = createPdfToolsEngine({ createWorker: () => silent })
    const running = engine.run('reverse', [file('a.pdf', text3)], {})
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0))
    for (const listener of errors) listener(new Event('error'))
    expect(await running).toEqual({ ok: false, reason: 'failed' })
    expect(terminated).toBe(true)
    engine.dispose()
  })

  it('answers too large for a RangeError in the worker, and does not reuse that worker', async () => {
    const full = async (): Promise<EnginePdfium> => {
      throw new RangeError('Array buffer allocation failed')
    }
    const workers = fakeWorkers(coreDeps({ loadPdfium: full }))
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    expect(await engine.run('toText', [file('a.pdf', text3)], {})).toEqual({
      ok: false,
      reason: 'too-large',
    })
    expect(workers.made[0]!.terminated).toBe(true)
    expect((await engine.run('reverse', [file('a.pdf', text3)], {})).ok).toBe(true)
    expect(workers.made).toHaveLength(2)
    engine.dispose()
  })

  it('reports an input it could not read', async () => {
    const engine = createPdfToolsEngine({ createWorker: fakeWorkers().create })
    const broken = (err: Error): ToolFile => ({
      name: 'x.pdf',
      mime: 'application/pdf',
      readBytes: async () => {
        throw err
      },
    })
    expect(
      await engine.run('merge', [file('a.pdf', text3), broken(new Error('gone'))], {}),
    ).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(
      await engine.run('merge', [file('a.pdf', text3), broken(new RangeError('no memory'))], {}),
    ).toEqual({ ok: false, reason: 'too-large' })
    expect(await engine.inspect(broken(new Error('gone')), 'merge')).toEqual({
      ok: false,
      problem: 'unreadable',
      sizeBytes: 0,
    })
    engine.dispose()
  })

  it('answers a job that threw in the worker, and a worker that cannot start', async () => {
    const throwing = (picture: PictureOps) => ({
      ...coreDeps()(picture),
      zip: async () => {
        throw new Error('zip broke')
      },
    })
    const engine = createPdfToolsEngine({ createWorker: fakeWorkers(throwing).create })
    await expect(engine.zip([], 'x.zip')).rejects.toEqual(new PdfToolsEngineError('failed'))
    expect((await engine.run('reverse', [file('a.pdf', text3)], {})).ok).toBe(true)
    engine.dispose()

    const noWorker = createPdfToolsEngine({
      createWorker: () => {
        throw new Error('module workers are not supported')
      },
    })
    expect(await noWorker.run('reverse', [file('a.pdf', text3)], {})).toEqual({
      ok: false,
      reason: 'failed',
    })
  })

  it('settles every call after dispose as stopped, without starting a worker', async () => {
    const workers = fakeWorkers()
    const engine = createPdfToolsEngine({ createWorker: workers.create })
    engine.dispose()
    expect(await engine.run('reverse', [file('a.pdf', text3)], {})).toEqual({
      ok: false,
      reason: 'stopped',
    })
    expect(await engine.findBlankPages(file('a.pdf', text3))).toEqual({
      ok: false,
      reason: 'stopped',
    })
    await expect(engine.inspect(file('a.pdf', text3), 'merge')).rejects.toBeInstanceOf(
      PdfToolsEngineError,
    )
    expect(workers.made).toHaveLength(0)
  })
})
