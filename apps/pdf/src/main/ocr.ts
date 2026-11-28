/**
 * System-OCR bridge for the pdf viewer (issue #119): recognizes one rendered
 * page image via the platform helper binaries shared with pdf2docx
 * (macOS Vision / Windows.Media.Ocr). Same helper-path resolution as the
 * shell's pdf2docx-local.ts — packaged under Resources/ocr, repo-relative in
 * dev. Linux (or a build without the helper) resolves to no engine and the
 * viewer keeps today's behavior.
 *
 * Unlike pdf2docx's sync conversion pipeline, the viewer runs inside Electron's
 * main process (UI thread), so helper binaries must be spawned asynchronously
 * and serialized through a single-concurrency queue so multiple scanned tabs
 * do not launch parallel OCR processes on low-memory machines.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { constants as osConstants, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HELPER_MAX_BUFFER,
  HELPER_TIMEOUT_MS,
  parseHelperOcrOutput,
} from '../../../../packages/pdf2docx/src/ocr-vision'
import type { OcrRecognition } from '../../../../packages/pdf2docx/src/ocr'
import type { PdfOcrLine } from '../shared/ipc'

export interface AsyncOcrRunnerOptions {
  helperPath: string
  /** Extra arguments prepended before language hints (e.g. script path when helperPath is node) */
  prefixArgs?: readonly string[]
  languages?: readonly string[]
  timeoutMs?: number
  maxBufferBytes?: number
  spawnImpl?: typeof spawn
}

export interface AsyncOcrRunner {
  recognize(png: Uint8Array): Promise<OcrRecognition | null>
  killAll(): void
}

function killChildProcess(child: ChildProcess): void {
  try {
    child.kill('SIGKILL')
  } catch {
    try {
      child.kill()
    } catch {
      // process already exited
    }
  }
}

/**
 * Create an asynchronous, single-concurrency runner around a platform OCR
 * helper binary. At most one helper process runs at a time; live children are
 * tracked so `killAll()` ensures no helper outlives the app.
 */
export function createAsyncOcrRunner(options: AsyncOcrRunnerOptions): AsyncOcrRunner {
  const {
    helperPath,
    prefixArgs = [],
    languages,
    timeoutMs = HELPER_TIMEOUT_MS,
    maxBufferBytes = HELPER_MAX_BUFFER,
    spawnImpl = spawn,
  } = options

  const args = [...prefixArgs, ...(languages && languages.length > 0 ? [languages.join(',')] : [])]

  let queue: Promise<void> = Promise.resolve()
  let disposed = false
  const activeAborts = new Set<() => void>()

  function runOnce(png: Uint8Array): Promise<OcrRecognition | null> {
    if (disposed) return Promise.resolve(null)

    return new Promise<OcrRecognition | null>((resolve) => {
      let child: ChildProcess
      try {
        child = spawnImpl(helperPath, args, {
          stdio: ['pipe', 'pipe', 'ignore'],
          // win-ocr.exe is a console program; started from the GUI app it would open a window
          windowsHide: true,
        })
      } catch {
        resolve(null)
        return
      }

      if (child.pid !== undefined) {
        try {
          setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
        } catch {
          // process may have exited already or OS may restrict priority changes
        }
      }

      let settled = false
      let aborted = false
      const chunks: Buffer[] = []
      let totalBytes = 0

      const finish = (result: OcrRecognition | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        activeAborts.delete(abortNow)
        resolve(result)
      }

      const stopChild = (): void => {
        aborted = true
        killChildProcess(child)
        child.stdin?.destroy()
        child.stdout?.destroy()
      }

      // Used on shutdown: kill and settle synchronously so quit handlers never hang
      const abortNow = (): void => {
        stopChild()
        finish(null)
      }

      activeAborts.add(abortNow)

      const timer = setTimeout(() => {
        stopChild()
      }, timeoutMs)

      child.on('error', () => {
        finish(null)
      })

      child.stdout?.on('error', () => {
        // stream errors resolve via close/error
      })

      child.stdout?.on('data', (chunk: Buffer | string) => {
        if (settled || aborted) return
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        totalBytes += buf.length
        if (totalBytes > maxBufferBytes) {
          stopChild()
          return
        }
        chunks.push(buf)
      })

      child.on('exit', () => {
        if (aborted) finish(null)
      })

      child.on('close', (code, signal) => {
        if (aborted || code !== 0 || signal !== null) {
          finish(null)
          return
        }
        finish(parseHelperOcrOutput(Buffer.concat(chunks, totalBytes)))
      })

      child.stdin?.on('error', () => {
        // child may exit before reading all of stdin (EPIPE); close handles the failure
      })
      child.stdin?.end(png)
    })
  }

  return {
    async recognize(png: Uint8Array): Promise<OcrRecognition | null> {
      if (disposed) return null
      let release!: () => void
      const prev = queue
      queue = new Promise<void>((r) => {
        release = r
      })
      await prev
      if (disposed) {
        release()
        return null
      }
      try {
        return await runOnce(png)
      } finally {
        release()
      }
    },

    killAll(): void {
      disposed = true
      for (const abort of [...activeAborts]) abort()
    },
  }
}

let ocrRunner: AsyncOcrRunner | null | undefined

function resolveHelperPath(): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null
  const here = dirname(fileURLToPath(import.meta.url))
  const helper = process.platform === 'darwin' ? 'vision-ocr' : 'win-ocr.exe'
  const candidates = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'ocr', helper)] : []),
    join(here, '../../../../packages/pdf2docx/ocr-helper', helper),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

function ensureOcrRunner(): AsyncOcrRunner | null {
  if (ocrRunner !== undefined) return ocrRunner
  const helperPath = resolveHelperPath()
  ocrRunner = helperPath ? createAsyncOcrRunner({ helperPath }) : null
  return ocrRunner
}

/** Terminate any live OCR helper processes (called on app quit / process exit) */
export function killAllOcrHelpers(): void {
  ocrRunner?.killAll()
}

export function recognitionToPdfOcrLines(result: OcrRecognition | null): PdfOcrLine[] {
  if (!result) return []
  return result.lines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    box: [l.box.x0, l.box.y0, l.box.x1, l.box.y1],
    ...(l.chars
      ? {
          chars: l.chars.map((c) => ({
            text: c.text,
            box: [c.box.x0, c.box.y0, c.box.x1, c.box.y1] as [number, number, number, number],
          })),
        }
      : {}),
  }))
}

/** PNG (base64) -> OCR lines; null only when the platform has no engine (callers
    stop trying), [] when recognition failed for this image (callers move on) */
export async function ocrPagePng(pngBase64: string): Promise<PdfOcrLine[] | null> {
  const runner = ensureOcrRunner()
  if (!runner) return null
  let png: Uint8Array
  try {
    png = Buffer.from(pngBase64, 'base64')
  } catch {
    return []
  }
  return recognitionToPdfOcrLines(await runner.recognize(png))
}
