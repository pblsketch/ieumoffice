// @vitest-environment node
/**
 * Async OCR helper runner tests: drives a real child process via process.execPath
 * so stdin piping, stdout collection, UTF-8 BOM handling, non-zero exits, timeouts,
 * output-size caps, single-concurrency queueing, and app-quit cleanup are exercised
 * against real OS process lifecycles.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAsyncOcrRunner, recognitionToPdfOcrLines } from '../src/main/ocr'

let workDir = ''
let helperScript = ''

const FAKE_HELPER_SOURCE = `
import { appendFileSync, writeFileSync } from 'node:fs'
import { getPriority } from 'node:os'

const [mode, argPath] = process.argv.slice(2)

function readAllStdin() {
  return new Promise((resolve) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

if (mode === 'fail-fast') {
  process.exit(1)
}

if (mode === 'hang') {
  if (argPath) writeFileSync(argPath, String(process.pid), 'utf8')
  setInterval(() => {}, 10_000)
} else if (mode === 'overflow') {
  if (argPath) writeFileSync(argPath, String(process.pid), 'utf8')
  process.stdout.write('x'.repeat(8192))
  setInterval(() => {}, 10_000)
} else if (mode === 'ok') {
  const input = await readAllStdin()
  const payload = {
    lines: [
      {
        t: 'bytes:' + input.length,
        c: 0.92,
        b: [0.1, 0.2, 0.8, 0.25],
        chars: [{ t: 'b', b: [0.1, 0.2, 0.2, 0.25] }],
      },
    ],
    paper: 0.88,
  }
  process.stdout.write(JSON.stringify(payload))
} else if (mode === 'bom') {
  await readAllStdin()
  const payload = {
    lines: [{ t: 'bom-ok', c: 0.95, b: [0.05, 0.5, 0.4, 0.55] }],
    paper: 0.9,
  }
  process.stdout.write('\\uFEFF' + JSON.stringify(payload))
} else if (mode === 'bad-json') {
  await readAllStdin()
  process.stdout.write('{not valid json')
} else if (mode === 'missing-lines') {
  await readAllStdin()
  process.stdout.write(JSON.stringify({ paper: 0.9 }))
} else if (mode === 'priority') {
  await readAllStdin()
  const prio = getPriority(process.pid)
  process.stdout.write(JSON.stringify({ lines: [{ t: 'prio:' + prio, c: 1, b: [0, 0, 1, 1] }] }))
} else if (mode === 'queue') {
  const input = await readAllStdin()
  const id = input.toString('utf8')
  appendFileSync(argPath, 'start:' + id + '\\n', 'utf8')
  await new Promise((r) => setTimeout(r, 80))
  appendFileSync(argPath, 'end:' + id + '\\n', 'utf8')
  if (id === 'fail') process.exit(2)
  process.stdout.write(JSON.stringify({ lines: [{ t: id, c: 1, b: [0, 0, 1, 1] }] }))
}
`

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8').trim()
      if (content.length > 0) return content
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForPidDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !isPidAlive(pid)
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ieum-pdf-ocr-test-'))
  helperScript = join(workDir, 'fake-helper.mjs')
  writeFileSync(helperScript, FAKE_HELPER_SOURCE, 'utf8')
})

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe('createAsyncOcrRunner', () => {
  it('pipes PNG bytes over stdin, parses JSON lines and chars, and sets windowsHide', async () => {
    const spawnSpy = vi.fn(spawn)
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'ok'],
      languages: ['ko-KR', 'en-US'],
      spawnImpl: spawnSpy as unknown as typeof spawn,
    })

    const png = new Uint8Array([1, 2, 3, 4, 5])
    const res = await runner.recognize(png)
    expect(res).toEqual({
      lines: [
        {
          text: 'bytes:5',
          confidence: 0.92,
          box: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.25 },
          chars: [{ text: 'b', box: { x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.25 } }],
        },
      ],
      paperShare: 0.88,
    })

    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawnSpy.mock.calls[0] as unknown as [
      string,
      string[],
      { windowsHide?: boolean; stdio?: unknown },
    ]
    expect(cmd).toBe(process.execPath)
    expect(args).toEqual([helperScript, 'ok', 'ko-KR,en-US'])
    expect(opts.windowsHide).toBe(true)
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'ignore'])

    expect(recognitionToPdfOcrLines(res)).toEqual([
      {
        text: 'bytes:5',
        confidence: 0.92,
        box: [0.1, 0.2, 0.8, 0.25],
        chars: [{ text: 'b', box: [0.1, 0.2, 0.2, 0.25] }],
      },
    ])
  })

  it('strips a leading UTF-8 BOM from helper stdout', async () => {
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'bom'],
    })

    const res = await runner.recognize(new Uint8Array([9, 8, 7]))
    expect(res).toEqual({
      lines: [
        {
          text: 'bom-ok',
          confidence: 0.95,
          box: { x0: 0.05, y0: 0.5, x1: 0.4, y1: 0.55 },
        },
      ],
      paperShare: 0.9,
    })
  })

  it('returns null on malformed JSON or missing lines array', async () => {
    const badJson = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'bad-json'],
    })
    const missingLines = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'missing-lines'],
    })

    expect(await badJson.recognize(new Uint8Array([1]))).toBeNull()
    expect(await missingLines.recognize(new Uint8Array([1]))).toBeNull()
    expect(recognitionToPdfOcrLines(null)).toEqual([])
  })

  it('returns null on non-zero exit without throwing EPIPE on large stdin', async () => {
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'fail-fast'],
    })

    const bigPayload = new Uint8Array(256 * 1024)
    expect(await runner.recognize(bigPayload)).toBeNull()
  })

  it('kills the helper and returns null when the timeout expires', async () => {
    const pidFile = join(workDir, 'timeout.pid')
    let spawnedPid: number | undefined
    const spawnSpy = vi.fn((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args)
      spawnedPid = child.pid
      return child
    })
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'hang', pidFile],
      // long enough for Node to boot and enter its hang loop on loaded Windows machines
      timeoutMs: 1500,
      spawnImpl: spawnSpy as unknown as typeof spawn,
    })

    const started = Date.now()
    const res = await runner.recognize(new Uint8Array([1]))
    const elapsed = Date.now() - started

    expect(res).toBeNull()
    expect(elapsed).toBeLessThan(8000)

    const pid = spawnedPid ?? Number(await waitForFile(pidFile, 1000))
    expect(typeof pid === 'number' && pid > 0).toBe(true)
    expect(await waitForPidDead(pid)).toBe(true)
  })

  it('kills the helper and returns null when stdout exceeds maxBufferBytes', async () => {
    const pidFile = join(workDir, 'overflow.pid')
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'overflow', pidFile],
      maxBufferBytes: 1024,
      timeoutMs: 5000,
    })

    const res = await runner.recognize(new Uint8Array([1]))
    expect(res).toBeNull()

    const pid = Number(await waitForFile(pidFile, 1000))
    expect(await waitForPidDead(pid)).toBe(true)
  })

  it('runs at most one helper process at a time and continues after a failed page', async () => {
    const logFile = join(workDir, 'queue.log')
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'queue', logFile],
    })

    const [r1, r2, r3] = await Promise.all([
      runner.recognize(Buffer.from('one')),
      runner.recognize(Buffer.from('fail')),
      runner.recognize(Buffer.from('three')),
    ])

    expect(r1?.lines[0]?.text).toBe('one')
    expect(r2).toBeNull()
    expect(r3?.lines[0]?.text).toBe('three')

    const events = readFileSync(logFile, 'utf8').trim().split('\n')
    expect(events).toEqual([
      'start:one',
      'end:one',
      'start:fail',
      'end:fail',
      'start:three',
      'end:three',
    ])
  })

  it('killAll terminates the live child and cancels queued work without spawning it', async () => {
    const pidFile = join(workDir, 'killall.pid')
    const spawnSpy = vi.fn(spawn)
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'hang', pidFile],
      timeoutMs: 30_000,
      spawnImpl: spawnSpy as unknown as typeof spawn,
    })

    const first = runner.recognize(new Uint8Array([1]))
    const second = runner.recognize(new Uint8Array([2]))

    const pid = Number(await waitForFile(pidFile))
    expect(isPidAlive(pid)).toBe(true)

    runner.killAll()

    expect(await first).toBeNull()
    expect(await second).toBeNull()
    expect(await waitForPidDead(pid)).toBe(true)
    // Only the first call spawned a helper; the queued call never spawned after killAll
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    // Subsequent calls after killAll also resolve to null without spawning
    expect(await runner.recognize(new Uint8Array([3]))).toBeNull()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })

  it('lowers the spawned helper process priority to PRIORITY_BELOW_NORMAL', async () => {
    const runner = createAsyncOcrRunner({
      helperPath: process.execPath,
      prefixArgs: [helperScript, 'priority'],
    })

    const res = await runner.recognize(new Uint8Array([1]))
    expect(res?.lines[0]?.text).toBe(`prio:${osConstants.priority.PRIORITY_BELOW_NORMAL}`)
  })
})
