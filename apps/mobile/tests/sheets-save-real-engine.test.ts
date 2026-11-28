// The phone's save path against the real engine: the desktop sidecar
// executable (the same engine crate the phone links) answers the engine
// lines, and a folder on disk plays the T1 work folder. Runs when
// IEUM_XLSX_SIDECAR_EXE names a built `xlsx-sidecar` (as the engine-lib
// comparison tests do); skipped otherwise.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MobileDocSession, MobileTransport } from '@genoffice/mobile-bridge/transport'
import { saveWorkbookViaSidecar } from '@genoffice/xlsx-gateway/gateway/xlsx-package-io'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import {
  MobileWorkbookSessions,
  callSheetsEngine,
  openMobileWorkbook,
} from '../src/renderer/editors/sheets/desktop-api'
import { createMobileArchiveClient } from '../src/renderer/editors/sheets/save/archiveClient'
import { saveMobileWorkbook } from '../src/renderer/editors/sheets/save/saveWorkbook'
import { ensureWorkFolder } from '../src/renderer/editors/sheets/save/workFolder'
import { mobileVfs } from '../src/renderer/editors/sheets/node-shims/vfs'
import { valueEdit, emptySaveRequest } from './helpers/sheetsSaveRequest'

const exe = process.env.IEUM_XLSX_SIDECAR_EXE
const available = exe !== undefined && existsSync(exe)

/** One sidecar process answering protocol lines (as the desktop client drives it). */
function startSidecar(path: string) {
  const child: ChildProcessWithoutNullStreams = spawn(path, [], { stdio: 'pipe' })
  const waiting = new Map<string, (line: string) => void>()
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    pending += chunk
    for (let index = pending.indexOf('\n'); index >= 0; index = pending.indexOf('\n')) {
      const line = pending.slice(0, index)
      pending = pending.slice(index + 1)
      const id = (JSON.parse(line) as { requestId: string }).requestId
      waiting.get(id)?.(line)
      waiting.delete(id)
    }
  })
  return {
    request(line: string): Promise<string> {
      const id = (JSON.parse(line) as { requestId: string }).requestId
      return new Promise((resolve) => {
        waiting.set(id, resolve)
        child.stdin.write(`${line}\n`)
      })
    },
    stop: () => child.kill(),
  }
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe.skipIf(!available)('the phone save path on the real engine', () => {
  let root: string
  let sidecar: ReturnType<typeof startSidecar>
  const originals = new Map<string, Uint8Array>()
  let counter = 0

  const client: { transport: MobileTransport } = {
    transport: {
      async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        const inside = (value: unknown) => {
          const path = String(value)
          if (!path.startsWith(`${root}/`)) throw new Error(`outside the work folder: ${path}`)
          return path
        }
        switch (command) {
          case 'mobile_sheets_request':
            return JSON.parse(await sidecar.request(String(args.line))) as T
          case 'mobile_sheets_copy_session_to_temp': {
            const path = `${root}/f-${(counter += 1)}.${String(args.ext)}`
            const bytes = originals.get(String(args.sessionId))!
            writeFileSync(path, bytes)
            return { path, size: bytes.byteLength } as T
          }
          case 'mobile_sheets_temp_new_path':
            return { path: `${root}/f-${(counter += 1)}.${String(args.ext)}` } as T
          case 'mobile_sheets_temp_root':
            return { path: root } as T
          case 'mobile_sheets_temp_mkdir':
            mkdirSync(inside(args.path), { recursive: true })
            return { ok: true } as T
          case 'mobile_sheets_temp_rename':
            renameSync(inside(args.from), inside(args.to))
            return { ok: true } as T
          case 'mobile_sheets_temp_copy':
            copyFileSync(inside(args.from), inside(args.to))
            return { ok: true } as T
          case 'mobile_sheets_temp_stat': {
            const path = inside(args.path)
            if (!existsSync(path)) return null as T
            const info = statSync(path)
            return { size: info.size, isFile: info.isFile(), isDir: info.isDirectory() } as T
          }
          case 'mobile_sheets_temp_read_raw':
            return new Uint8Array(readFileSync(inside(args.path))).buffer as T
          case 'mobile_sheets_temp_write_text':
            writeFileSync(inside(args.path), String(args.text))
            return { ok: true } as T
          case 'mobile_sheets_temp_append_text':
            appendFileSync(inside(args.path), String(args.text))
            return { ok: true } as T
          case 'mobile_sheets_temp_write_bytes':
            writeFileSync(inside(args.path), Buffer.from(String(args.bytesBase64), 'base64'))
            return { ok: true } as T
          case 'mobile_sheets_temp_append_bytes':
            appendFileSync(inside(args.path), Buffer.from(String(args.bytesBase64), 'base64'))
            return { ok: true } as T
          case 'mobile_sheets_temp_delete':
            rmSync(inside(args.path), { recursive: true, force: true })
            return { ok: true } as T
          case 'mobile_sheets_save_to_original': {
            const bytes = new Uint8Array(readFileSync(inside(args.path)))
            originals.set(String(args.sessionId), bytes)
            return { ok: true, size: bytes.byteLength } as T
          }
          default:
            throw new Error(`test device: ${command}`)
        }
      },
      async listen() {
        return () => {}
      },
    },
  }

  const document = (ext: string): MobileDocSession => ({
    sessionId: 'doc-1',
    docKey: 'key-1',
    name: `book.${ext}`,
    ext,
    format: ext as MobileDocSession['format'],
    writable: true,
    ephemeral: false,
  })

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ieum-sheets-save-')).replace(/\\/g, '/')
    sidecar = startSidecar(exe!)
  })

  afterAll(() => {
    sidecar?.stop()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  async function manifest(path: string) {
    return (await callSheetsEngine(client, 'archive_manifest', { path })) as {
      entries: { name: string; crc32: number; compressedSize: number }[]
    }
  }

  it('saves an edit: only the reported entries change, the result reopens, the next save chains on it', async () => {
    const original = new Uint8Array(await buildEditFixture())
    originals.set('doc-1', original)
    const sessions = new MobileWorkbookSessions()
    const file = await openMobileWorkbook(client, sessions, {
      session: document('xlsx'),
      locale: 'en',
    })
    const outcome = await saveMobileWorkbook(
      { client, sessions, locale: 'en' },
      valueEdit(file.sessionId, file.sheets[0]!.id, 0, 0, 'World'),
    )
    expect(outcome.touchedEntries).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    const before = `${root}/before.xlsx`
    const after = `${root}/after.xlsx`
    writeFileSync(before, original)
    writeFileSync(after, originals.get('doc-1')!)
    const was = new Map((await manifest(before)).entries.map((entry) => [entry.name, entry]))
    for (const entry of (await manifest(after)).entries) {
      if (outcome.touchedEntries.includes(entry.name)) continue
      // Untouched entries are the original's compressed bytes (same CRC and size).
      expect(entry).toEqual(was.get(entry.name))
    }
    const second = await saveMobileWorkbook(
      { client, sessions, locale: 'en' },
      valueEdit(outcome.file.sessionId, outcome.file.sheets[0]!.id, 1, 0, 'Second'),
    )
    expect(second.wroteOriginal).toBe(true)
    const zip = await JSZip.loadAsync(originals.get('doc-1')!)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(sheet).toContain('World')
    expect(sheet).toContain('Second')
    await callSheetsEngine(client, 'close', { sessionId: second.file.sessionId })
  })

  it('an unchanged save gives the original back byte for byte', async () => {
    const original = new Uint8Array(await buildEditFixture())
    originals.set('doc-1', original)
    const sessions = new MobileWorkbookSessions()
    const file = await openMobileWorkbook(client, sessions, {
      session: document('xlsx'),
      locale: 'en',
    })
    const outcome = await saveMobileWorkbook(
      { client, sessions, locale: 'en' },
      emptySaveRequest(file.sessionId),
    )
    expect(outcome.unchanged).toBe(true)
    expect(sha(originals.get('doc-1')!)).toBe(sha(original))
    await callSheetsEngine(client, 'close', { sessionId: outcome.file.sessionId })
  })

  it('why the unchanged save skips the engine: an empty plan through save_archive rewrites the zip directory', async () => {
    const source = `${root}/empty-source.xlsx`
    const target = `${root}/empty-target.xlsx`
    const original = new Uint8Array(await buildEditFixture())
    writeFileSync(source, original)
    await ensureWorkFolder(client)
    const result = await saveWorkbookViaSidecar({
      client: createMobileArchiveClient(client, mobileVfs),
      sourcePath: source,
      targetPath: target,
      edits: [],
    })
    // Planning an empty request still marks the workbook for recalculation
    // (fullCalcOnLoad), so its bytes differ: the phone copies the snapshot instead.
    const saved = new Uint8Array(readFileSync(target))
    expect(result.touchedEntries).toEqual(['xl/workbook.xml'])
    expect(sha(saved)).not.toBe(sha(original))
  })
})
