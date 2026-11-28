/**
 * Shell-free child-process runner for `--headless-export` (PDF tools v2).
 * Runs the app binary as a separate child process with `shell: false` so GUI
 * state (`isHeadlessMode()`) and open tabs are never affected, OS reclaims
 * memory on exit, and cancellation kills the child immediately.
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface HeadlessRunnerOptions {
  signal?: AbortSignal
  /** per-file timeout in milliseconds (default: 180_000, tunable) */
  timeoutMs?: number
  /** override executable path (tests) */
  execPath?: string
  /** leading args before `--headless-export` (e.g. app entry path in dev Electron) */
  appArgs?: readonly string[]
}

export type HeadlessRunnerResult =
  { ok: true; outPath: string } | { ok: false; error: string; canceled?: boolean }

const DEFAULT_TIMEOUT_MS = 180_000
const activeChildren = new Set<ChildProcess>()

/** Leading launch arguments for the current Electron runtime (dev vs packaged) */
export function defaultHeadlessLaunchArgs(
  defaultApp = Boolean((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp),
  argv: readonly string[] = process.argv,
): string[] {
  if (defaultApp && argv.length >= 2 && argv[1]) {
    return [argv[1]]
  }
  return []
}

/** Build the exact argument vector passed to `execFile(execPath, args, { shell: false })` */
export function buildHeadlessExportArgs(
  inputPath: string,
  outPath: string,
  appArgs: readonly string[] = defaultHeadlessLaunchArgs(),
): string[] {
  return [...appArgs, '--headless-export', inputPath, '--to', 'pdf', '--out', outPath, '--json']
}

/** Parse the single-line JSON envelope emitted by `--headless-export --json` */
export function parseHeadlessJsonEnvelope(
  stdout: string,
):
  | { status: 'ok'; output_path?: string }
  | { status: 'error'; error?: string; summary?: string }
  | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.status === 'ok') {
        return {
          status: 'ok',
          ...(typeof parsed.output_path === 'string' ? { output_path: parsed.output_path } : {}),
        }
      }
      if (parsed.status === 'error') {
        return {
          status: 'error',
          ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
          ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
        }
      }
    } catch {
      // ignore non-JSON log lines
    }
  }
  return null
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    try {
      execFile(
        'taskkill',
        ['/pid', String(child.pid), '/T', '/F'],
        { shell: false, windowsHide: true },
        () => {},
      )
    } catch {
      // fall through to child.kill
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // already exited
  }
}

/** Terminate every active headless export child (called on window close / app quit) */
export function killAllHeadlessChildren(): void {
  for (const child of activeChildren) {
    terminateChild(child)
  }
  activeChildren.clear()
}

/** Run `--headless-export <inputPath> --to pdf --out <outPath> --json` without a shell */
export function runHeadlessPdfExport(
  inputPath: string,
  outPath: string,
  options: HeadlessRunnerOptions = {},
): Promise<HeadlessRunnerResult> {
  if (options.signal?.aborted) {
    return Promise.resolve({ ok: false, canceled: true, error: 'cancelled' })
  }
  const execPath = options.execPath ?? process.execPath
  const args = buildHeadlessExportArgs(inputPath, outPath, options.appArgs)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<HeadlessRunnerResult>((resolve) => {
    let settled = false
    const finish = (res: HeadlessRunnerResult): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      resolve(res)
    }

    const child = execFile(
      execPath,
      args,
      {
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout) => {
        activeChildren.delete(child)
        if (options.signal?.aborted) {
          finish({ ok: false, canceled: true, error: 'cancelled' })
          return
        }
        const env = parseHeadlessJsonEnvelope(String(stdout ?? ''))
        if (!err && env?.status === 'ok' && existsSync(outPath)) {
          finish({ ok: true, outPath })
          return
        }
        if (env?.status === 'error') {
          finish({ ok: false, error: env.error || env.summary || 'conversion failed' })
          return
        }
        finish({
          ok: false,
          error: err instanceof Error ? err.message : 'headless conversion failed',
        })
      },
    )

    activeChildren.add(child)

    const onAbort = (): void => {
      terminateChild(child)
      activeChildren.delete(child)
      finish({ ok: false, canceled: true, error: 'cancelled' })
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
