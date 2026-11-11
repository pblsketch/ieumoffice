import { spawn } from 'node:child_process'
import { parseHelperOcrOutput } from '../../../../packages/pdf2docx/src/ocr-helper-output'
import type { OcrRecognition } from '../../../../packages/pdf2docx/src/ocr'

const MAX_OUTPUT = 64 * 1024 * 1024
const TIMEOUT_MS = 30_000
let active = false
let retainedBytes = 0
const waiting: Array<{ start: () => void }> = []

function acquire(bytes: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || waiting.length >= 16 || retainedBytes + bytes > MAX_OUTPUT)
    return Promise.resolve(false)
  retainedBytes += bytes
  if (!active) {
    active = true
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const item = {
      start: () => {
        signal?.removeEventListener('abort', cancel)
        resolve(true)
      },
    }
    const cancel = () => {
      const index = waiting.indexOf(item)
      if (index < 0) return
      waiting.splice(index, 1)
      retainedBytes -= bytes
      resolve(false)
    }
    waiting.push(item)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function release(bytes: number) {
  retainedBytes -= bytes
  const next = waiting.shift()
  if (next) next.start()
  else active = false
}

/** Keep the platform helper's wait outside the application's main event loop. */
export async function recognizeHelperPng(
  helper: string,
  png: Uint8Array,
  signal?: AbortSignal,
  languages: readonly string[] = [],
): Promise<OcrRecognition | null> {
  if (!(await acquire(png.byteLength, signal))) return null
  try {
    if (signal?.aborted) return null
    return await run(helper, png, signal, languages)
  } finally {
    release(png.byteLength)
  }
}

function run(
  helper: string,
  png: Uint8Array,
  signal: AbortSignal | undefined,
  languages: readonly string[],
): Promise<OcrRecognition | null> {
  return new Promise((resolve) => {
    const child = spawn(helper, languages.length ? [languages.join(',')] : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
    })
    const chunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let failed = false
    const stop = () => {
      failed = true
      child.kill()
    }
    const timeout = setTimeout(stop, TIMEOUT_MS)
    child.on('error', () => {
      failed = true
    })
    child.stdin.on('error', stop)
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_OUTPUT) stop()
      if (!failed) chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAX_OUTPUT) stop()
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (failed || code !== 0) {
        resolve(null)
        return
      }
      try {
        resolve(parseHelperOcrOutput(Buffer.concat(chunks, stdoutBytes).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    child.stdin.end(png)
  })
}
