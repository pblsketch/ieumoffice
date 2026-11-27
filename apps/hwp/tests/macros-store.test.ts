// @vitest-environment node
/**
 * Tests for the app-wide Hangul macro store (`macros.ts`) and its main-process
 * Electron IPC handlers (`macros-ipc.ts`).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

interface FakeContents {
  id: number
  destroyed: boolean
  isDestroyed(): boolean
  setWindowOpenHandler(handler: unknown): void
  loadURL(url: string): Promise<void>
  send: ReturnType<typeof vi.fn>
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
}

let nextId = 1
const contentsById = new Map<number, FakeContents>()

function fakeContents(): FakeContents {
  const id = nextId++
  const contents: FakeContents = {
    id,
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    setWindowOpenHandler: () => {},
    loadURL: async () => {},
    send: vi.fn(),
    on: () => {},
    once: () => {},
  }
  contentsById.set(id, contents)
  return contents
}

const userData = { dir: '' }
const mockShowMessageBox = vi.fn(async () => ({ response: 1 }))
const mockShowOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }))
const mockShowSaveDialog = vi.fn(async () => ({
  canceled: true,
  filePath: undefined as string | undefined,
}))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) =>
      name === 'userData' ? userData.dir : join(userData.dir, `path-${name}`),
    getLocale: () => 'ko-KR',
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => mockShowMessageBox(...(args as [])),
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...(args as [])),
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...(args as [])),
  },
  shell: { openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  ipcRenderer: {},
  webUtils: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = fakeContents()
  },
  webContents: {
    fromId: (id: number) => contentsById.get(id) ?? null,
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))

vi.mock('@genoffice/file-parse', () => ({
  hwpToText: vi.fn(async () => ''),
  parseFileToText: vi.fn(async () => ({ kind: 'text', text: '' })),
  ATTACHABLE_EXTS: new Set<string>(),
  ATTACHABLE_IMAGE_EXTS: new Set<string>(),
  ATTACHABLE_MAX_BYTES: 25 * 1024 * 1024,
  attachableMaxBytes: () => 25 * 1024 * 1024,
  ATTACHABLE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
}))

import {
  MACROS_FILE_NAME,
  MACROS_NEAR_LIMIT_RATIO,
  MACROS_SCHEMA_VERSION,
  MACRO_FILE_EXT,
  MACRO_FILE_FORMAT_VERSION,
  MACRO_SLOT_MAX,
  MACRO_SLOT_MIN,
  MAX_MACROS_FILE_BYTES,
  MAX_MACRO_DESCRIPTION_CHARS,
  MAX_MACRO_IMPORT_BYTES,
  MAX_MACRO_NAME_CHARS,
  addMacro,
  assignMacroSlot,
  commitMacroImport,
  deleteMacro,
  macrosPathOf,
  parseMacroFile,
  previewMacroFileImport,
  readMacrosState,
  serializeMacroFile,
  updateMacro,
  validateMacroSlot,
  writeMacroExportFile,
} from '../src/main/macros'
import { registerHwpMacrosIpc } from '../src/main/macros-ipc'
import { createHwpView } from '../src/main/hwp-main'
import { HWP_CHANNELS } from '../src/shared/ipc'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-macros-'))
  userData.dir = join(dir, 'userData')
  mkdirSync(userData.dir, { recursive: true })
  mockShowMessageBox.mockReset()
  mockShowMessageBox.mockResolvedValue({ response: 1 })
  mockShowOpenDialog.mockReset()
  mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  mockShowSaveDialog.mockReset()
  mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function settingsApp() {
  return { getPath: (): string => userData.dir }
}

describe('macros.ts pure Node store', () => {
  it('contains zero Electron imports so CLI can import it directly in Node', () => {
    const source = readFileSync(join(__dirname, '../src/main/macros.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"]electron['"]/)
    expect(source).not.toMatch(/require\(\s*['"]electron['"]\s*\)/)
  })

  it('supports CRUD, slot reassignment across macros, and atomic sync writes without leftover temp files', () => {
    const missingDir = join(dir, 'nested', 'not-created-yet')
    expect(macrosPathOf(missingDir)).toBe(join(missingDir, MACROS_FILE_NAME))

    const initial = readMacrosState(missingDir)
    expect(initial).toEqual({
      ok: true,
      exists: false,
      macros: [],
      sizeBytes: 0,
      maxBytes: MAX_MACROS_FILE_BYTES,
      nearLimit: false,
    })

    const first = addMacro(missingDir, {
      name: '  Remove Double Spaces  ',
      description: 'Replaces double spaces with a single space.',
      script: 'replaceAll("  ", " ");',
      slot: 1,
      origin: 'recorded',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.macro.name).toBe('Remove Double Spaces')
    expect(first.macro.description).toBe('Replaces double spaces with a single space.')
    expect(first.macro.slot).toBe(1)
    expect(first.macro.origin).toBe('recorded')

    const second = addMacro(missingDir, {
      name: 'Bold Title',
      script: 'setCharFormat({ bold: true });',
      slot: 2,
      origin: 'ai',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.macro.slot).toBe(2)
    expect(second.macro.origin).toBe('ai')

    // Reassign slot 1 to the second macro -> clears slot 1 from the first macro
    const moved = assignMacroSlot(missingDir, second.macro.id, 1)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.macro.slot).toBe(1)
    const firstAfterMove = moved.macros.find((m) => m.id === first.macro.id)
    expect(firstAfterMove?.slot).toBeNull()

    // Clear slot back to null
    const cleared = assignMacroSlot(missingDir, second.macro.id, null)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.macro.slot).toBeNull()

    // Update name, description, script, and slot while preserving origin and createdAt
    const updated = updateMacro(missingDir, first.macro.id, {
      name: 'Clean Spaces',
      description: null,
      script: 'replaceAll("  ", " ");\nreplaceAll("\\t", " ");',
      slot: 11,
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.macro.name).toBe('Clean Spaces')
    expect(updated.macro.description).toBeUndefined()
    expect(updated.macro.slot).toBe(11)
    expect(updated.macro.origin).toBe('recorded')
    expect(updated.macro.createdAt).toBe(first.macro.createdAt)

    // Disk state is schema v1 with no leftover .tmp files
    const diskPath = macrosPathOf(missingDir)
    expect(existsSync(diskPath)).toBe(true)
    expect(readdirSync(missingDir)).toEqual([MACROS_FILE_NAME])
    const rawDisk = JSON.parse(readFileSync(diskPath, 'utf8')) as {
      version: number
      updatedAt: string
      macros: unknown[]
    }
    expect(rawDisk.version).toBe(MACROS_SCHEMA_VERSION)
    expect(typeof rawDisk.updatedAt).toBe('string')
    expect(rawDisk.macros).toHaveLength(2)

    // Delete second macro
    const deleted = deleteMacro(missingDir, second.macro.id)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.deletedId).toBe(second.macro.id)
    expect(deleted.macros).toHaveLength(1)
    expect(deleted.macros[0].id).toBe(first.macro.id)
  })

  it('strictly validates shortcut slots (rejecting 0, -1, 12, 1.5, 2147483648) and malformed inputs', () => {
    const app = settingsApp()

    // Valid slots: null, undefined, and integers 1..11
    expect(validateMacroSlot(null)).toEqual({ ok: true, slot: null })
    expect(validateMacroSlot(undefined)).toEqual({ ok: true, slot: null })
    for (let slot = MACRO_SLOT_MIN; slot <= MACRO_SLOT_MAX; slot++) {
      expect(validateMacroSlot(slot)).toEqual({ ok: true, slot })
    }

    // Invalid slots explicitly rejected
    const invalidSlots: unknown[] = [
      0,
      -1,
      -100,
      12,
      1.5,
      2147483648,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      true,
      {},
    ]
    for (const badSlot of invalidSlots) {
      expect(validateMacroSlot(badSlot).ok).toBe(false)
      const addRes = addMacro(app, {
        name: 'Slot Test',
        script: 'insertText("ok");',
        slot: badSlot as number,
      })
      expect(addRes.ok).toBe(false)
      if (!addRes.ok) expect(addRes.reason).toBe('invalid_input')
    }

    // Seed one valid macro to test update & assignMacroSlot rejection
    const seeded = addMacro(app, {
      name: 'Valid Macro',
      script: 'insertText("hello");',
      slot: 3,
    })
    expect(seeded.ok).toBe(true)
    if (!seeded.ok) return

    for (const badSlot of [0, -1, 12, 1.5, 2147483648]) {
      const assignRes = assignMacroSlot(app, seeded.macro.id, badSlot)
      expect(assignRes.ok).toBe(false)
      if (!assignRes.ok) expect(assignRes.reason).toBe('invalid_input')

      const updateRes = updateMacro(app, seeded.macro.id, { slot: badSlot })
      expect(updateRes.ok).toBe(false)
      if (!updateRes.ok) expect(updateRes.reason).toBe('invalid_input')
    }

    // Empty-after-trim name/script, invalid origin, oversized name/description, NUL bytes
    const emptyName = addMacro(app, { name: '   \t\n  ', script: 'insertText("x");' })
    expect(emptyName.ok).toBe(false)
    if (!emptyName.ok) expect(emptyName.reason).toBe('invalid_input')

    const emptyScript = addMacro(app, { name: 'Empty Script', script: '   \n\t  ' })
    expect(emptyScript.ok).toBe(false)
    if (!emptyScript.ok) expect(emptyScript.reason).toBe('invalid_input')

    const badOrigin = addMacro(app, {
      name: 'Bad Origin',
      script: 'insertText("x");',
      origin: 'document' as 'manual',
    })
    expect(badOrigin.ok).toBe(false)
    if (!badOrigin.ok) expect(badOrigin.reason).toBe('invalid_input')

    const longName = addMacro(app, {
      name: 'n'.repeat(MAX_MACRO_NAME_CHARS + 1),
      script: 'insertText("x");',
    })
    expect(longName.ok).toBe(false)

    const longDesc = addMacro(app, {
      name: 'Long Desc',
      description: 'd'.repeat(MAX_MACRO_DESCRIPTION_CHARS + 1),
      script: 'insertText("x");',
    })
    expect(longDesc.ok).toBe(false)

    const nulScript = addMacro(app, {
      name: 'NUL Script',
      script: 'insertText("a\0b");',
    })
    expect(nulScript.ok).toBe(false)

    // Store still contains only the original untouched macro
    const state = readMacrosState(app)
    expect(state.ok).toBe(true)
    if (state.ok) {
      expect(state.macros).toHaveLength(1)
      expect(state.macros[0].slot).toBe(3)
    }
  })

  it('roundtrips plain-text .ieummacro files, runs syntaxChecker on preview without saving, and rejects malformed/binary/oversized files', () => {
    const app = settingsApp()
    const multilineScript = [
      'const count = replaceAll("  ", " ");',
      'if (count > 0) {',
      '  insertText("Done: \\"cleaned\\"");',
      '}',
    ].join('\n')

    const added = addMacro(app, {
      name: 'Cleanup Pipeline',
      description: 'Cleans repeated spaces and logs result.',
      script: multilineScript,
      slot: 4,
      origin: 'manual',
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    // Export to .ieummacro on disk
    const exportPath = join(dir, 'exports', `cleanup${MACRO_FILE_EXT}`)
    const exported = writeMacroExportFile(exportPath, added.macro)
    expect(exported).toEqual({
      ok: true,
      path: exportPath,
      macroId: added.macro.id,
      name: 'Cleanup Pipeline',
    })
    expect(readdirSync(join(dir, 'exports')).filter((f) => f.endsWith('.tmp'))).toEqual([])

    // Verify plain-text visibility: script appears unescaped verbatim in the file
    const diskText = readFileSync(exportPath, 'utf8')
    expect(diskText).toContain(`// @ieum-macro: ${MACRO_FILE_FORMAT_VERSION}`)
    expect(diskText).toContain('// @name: Cleanup Pipeline')
    expect(diskText).toContain('// @description: Cleans repeated spaces and logs result.')
    expect(diskText).toContain('// ---')
    expect(diskText).toContain(multilineScript)

    // Preview with syntaxChecker returning ok -> NEVER mutates hwp-macros.json
    const previewOk = previewMacroFileImport(exportPath, {
      syntaxChecker: () => ({ ok: true }),
    })
    expect(previewOk.ok).toBe(true)
    if (!previewOk.ok) return
    expect(previewOk.fileName).toBe(`cleanup${MACRO_FILE_EXT}`)
    expect(previewOk.preview).toEqual({
      name: 'Cleanup Pipeline',
      description: 'Cleans repeated spaces and logs result.',
      script: multilineScript,
      syntax: { ok: true },
    })
    const stateAfterPreview = readMacrosState(app)
    expect(stateAfterPreview.ok && stateAfterPreview.macros).toHaveLength(1)

    // Preview with syntax errors still returns the full script + (line, column) so user can save & fix
    const brokenPath = join(dir, `broken${MACRO_FILE_EXT}`)
    writeFileSync(
      brokenPath,
      serializeMacroFile({
        name: 'Needs Fix',
        description: 'Has syntax issue on line 2',
        script: 'const x = 1;\ninsertText(;\n',
      }),
      'utf8',
    )
    const previewErr = previewMacroFileImport(brokenPath, {
      syntaxChecker: (script) => {
        if (script.includes('insertText(;')) {
          return { ok: false, error: 'Unexpected token ";"', line: 2, column: 12 }
        }
        return { ok: true }
      },
    })
    expect(previewErr.ok).toBe(true)
    if (!previewErr.ok) return
    expect(previewErr.preview.script).toBe('const x = 1;\ninsertText(;\n')
    expect(previewErr.preview.syntax).toEqual({
      ok: false,
      error: 'Unexpected token ";"',
      line: 2,
      column: 12,
    })

    // Commit imported macro -> forces origin: 'imported' regardless of caller payload
    const committed = commitMacroImport(app, {
      name: previewErr.preview.name,
      description: previewErr.preview.description,
      script: previewErr.preview.script,
      origin: 'manual',
    })
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    expect(committed.macro.origin).toBe('imported')
    expect(committed.macro.slot).toBeNull()
    expect(committed.macros).toHaveLength(2)

    // Header spoofing defense: newlines in name/description are flattened
    const sanitizedSerialized = serializeMacroFile({
      name: 'Safe\n// ---\nEvil()',
      description: 'Line1\r\n// @name: Spoofed',
      script: 'insertText("safe");',
    })
    const parsedSanitized = parseMacroFile(sanitizedSerialized)
    expect(parsedSanitized.ok).toBe(true)
    if (parsedSanitized.ok) {
      expect(parsedSanitized.preview.name).toBe('Safe // --- Evil()')
      expect(parsedSanitized.preview.description).toBe('Line1 // @name: Spoofed')
      expect(parsedSanitized.preview.script).toBe('insertText("safe");')
    }

    // Reject oversized import file via statSync before loading
    const hugePath = join(dir, `oversized${MACRO_FILE_EXT}`)
    writeFileSync(
      hugePath,
      `// @ieum-macro: 1\n// @name: Huge\n// ---\n${'a'.repeat(MAX_MACRO_IMPORT_BYTES + 64)}\n`,
      'utf8',
    )
    const tooLarge = previewMacroFileImport(hugePath)
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) {
      expect(tooLarge.reason).toBe('too_large')
      expect(tooLarge.maxBytes).toBe(MAX_MACRO_IMPORT_BYTES)
      expect(tooLarge.actualBytes).toBeGreaterThan(MAX_MACRO_IMPORT_BYTES)
    }

    // Reject binary file containing NUL bytes
    const binaryPath = join(dir, `binary${MACRO_FILE_EXT}`)
    writeFileSync(binaryPath, Buffer.from([0x2f, 0x2f, 0x00, 0x50, 0x4b, 0x03, 0x04]))
    const binaryRes = previewMacroFileImport(binaryPath)
    expect(binaryRes.ok).toBe(false)
    if (!binaryRes.ok) expect(binaryRes.reason).toBe('invalid_format')

    // Reject invalid UTF-8 bytes
    const invalidUtf8 = parseMacroFile(new Uint8Array([0xff, 0xfe, 0xfd]))
    expect(invalidUtf8.ok).toBe(false)
    if (!invalidUtf8.ok) expect(invalidUtf8.reason).toBe('invalid_format')

    // Reject missing header, wrong version, missing separator, empty script, unknown field
    expect(parseMacroFile('replaceAll("a", "b");').ok).toBe(false)
    expect(parseMacroFile('// @ieum-macro: 99\n// @name: Future\n// ---\nx();\n').ok).toBe(false)
    expect(parseMacroFile('// @ieum-macro: 1\n// @name: NoSep\nx();\n').ok).toBe(false)
    expect(parseMacroFile('// @ieum-macro: 1\n// @name: Empty\n// ---\n   \n').ok).toBe(false)
    expect(
      parseMacroFile('// @ieum-macro: 1\n// @name: BadField\n// @exec: rm -rf\n// ---\nx();\n').ok,
    ).toBe(false)
    expect(
      parseMacroFile('// @ieum-macro: 1\n// @name: BadSlot\n// @slot: 99\n// ---\nx();\n').ok,
    ).toBe(false)
  })

  it('never reads or loads macros from document files (app-data userData/hwp-macros.json only)', () => {
    const app = settingsApp()
    const docDir = join(dir, 'documents')
    mkdirSync(docDir, { recursive: true })

    // Place decoy document files containing macro-like content outside userData
    writeFileSync(
      join(docDir, 'report.hwpx'),
      serializeMacroFile({ name: 'Document Embedded Macro', script: 'insertText("pwn");' }),
      'utf8',
    )
    writeFileSync(
      join(docDir, MACROS_FILE_NAME),
      JSON.stringify({
        version: 1,
        macros: [
          {
            id: 'doc-macro',
            name: 'Decoy Store Beside Document',
            script: 'insertText("nope");',
            slot: 1,
            origin: 'manual',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      'utf8',
    )

    // Store resolves strictly to <userData>/hwp-macros.json and ignores all document-side files
    expect(macrosPathOf(app)).toBe(join(userData.dir, MACROS_FILE_NAME))
    const state = readMacrosState(app)
    expect(state.ok).toBe(true)
    if (state.ok) {
      expect(state.exists).toBe(false)
      expect(state.macros).toEqual([])
    }
  })

  it('enforces MAX_MACROS_FILE_BYTES before writing, rejects oversized stores, and flags nearLimit writes', () => {
    // 1. Existing oversized store on disk is refused and backed up without mutation
    const oversizedDir = join(dir, 'oversized-store')
    mkdirSync(oversizedDir, { recursive: true })
    const oversizedPath = macrosPathOf(oversizedDir)
    writeFileSync(oversizedPath, 'x'.repeat(MAX_MACROS_FILE_BYTES + 64), 'utf8')

    const oversizedState = readMacrosState(oversizedDir)
    expect(oversizedState.ok).toBe(false)
    if (!oversizedState.ok) {
      expect(oversizedState.reason).toBe('library_too_large')
      expect(oversizedState.maxBytes).toBe(MAX_MACROS_FILE_BYTES)
      expect(oversizedState.sizeBytes).toBe(MAX_MACROS_FILE_BYTES + 64)
      expect(oversizedState.corruptBackupPath).toBeTruthy()
      expect(existsSync(oversizedState.corruptBackupPath!)).toBe(true)
    }

    const refuseAdd = addMacro(oversizedDir, { name: 'Blocked', script: 'insertText("x");' })
    expect(refuseAdd.ok).toBe(false)
    if (!refuseAdd.ok) expect(refuseAdd.reason).toBe('library_too_large')
    expect(readFileSync(oversizedPath).byteLength).toBe(MAX_MACROS_FILE_BYTES + 64)

    // 2. Write exceeding custom maxBytes is refused BEFORE touching disk
    const freshDir = join(dir, 'fresh-size-guard')
    mkdirSync(freshDir, { recursive: true })
    const freshPath = macrosPathOf(freshDir)
    const customMaxBytes = 1200

    const tooBig = addMacro(
      freshDir,
      { name: 'Oversized Write', script: `insertText("${'a'.repeat(1100)}");` },
      { maxBytes: customMaxBytes },
    )
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) {
      expect(tooBig.reason).toBe('too_large')
      expect(tooBig.maxBytes).toBe(customMaxBytes)
      expect(tooBig.actualBytes).toBeGreaterThan(customMaxBytes)
    }
    expect(existsSync(freshPath)).toBe(false)
    expect(readdirSync(freshDir)).toEqual([])

    // 3. Write landing >= 85% and <= 100% of customMaxBytes succeeds with nearLimit: true
    const boundedDir = join(dir, 'bounded-store')
    mkdirSync(boundedDir, { recursive: true })
    const boundedPath = macrosPathOf(boundedDir)

    const first = addMacro(
      boundedDir,
      { name: 'Initial', script: `insertText("${'x'.repeat(100)}");` },
      { maxBytes: customMaxBytes },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.nearLimit).toBe(false)
    const beforeOverflowDisk = readFileSync(boundedPath, 'utf8')

    // Commit import that would overflow maxBytes leaves existing file untouched
    const overflowImport = commitMacroImport(
      boundedDir,
      { name: 'Overflow Import', script: `insertText("${'z'.repeat(900)}");` },
      { maxBytes: customMaxBytes },
    )
    expect(overflowImport.ok).toBe(false)
    if (!overflowImport.ok) expect(overflowImport.reason).toBe('too_large')
    expect(readFileSync(boundedPath, 'utf8')).toBe(beforeOverflowDisk)

    // Add second macro bringing total size between 85% and 100% of customMaxBytes
    const targetNearBytes = Math.ceil(customMaxBytes * MACROS_NEAR_LIMIT_RATIO)
    const padLen = Math.max(50, targetNearBytes - first.sizeBytes - 230)
    const nearAdd = addMacro(
      boundedDir,
      { name: 'Near Limit', script: `insertText("${'n'.repeat(padLen)}");` },
      { maxBytes: customMaxBytes },
    )
    expect(nearAdd.ok).toBe(true)
    if (!nearAdd.ok) return
    expect(nearAdd.sizeBytes).toBeGreaterThanOrEqual(
      Math.floor(customMaxBytes * MACROS_NEAR_LIMIT_RATIO),
    )
    expect(nearAdd.sizeBytes).toBeLessThanOrEqual(customMaxBytes)
    expect(nearAdd.nearLimit).toBe(true)

    const inspected = readMacrosState(boundedDir, { maxBytes: customMaxBytes })
    expect(inspected.ok).toBe(true)
    if (inspected.ok) {
      expect(inspected.nearLimit).toBe(true)
      expect(inspected.sizeBytes).toBe(nearAdd.sizeBytes)
    }
  })

  it('never overwrites corrupt hwp-macros.json, creates one deduplicated .corrupt backup, and refuses all writes', () => {
    const app = settingsApp()
    const storePath = macrosPathOf(app)
    const corruptPayload = '{ "version": 1, "macros": [ BROKEN JSON '
    writeFileSync(storePath, corruptPayload, 'utf8')

    const state1 = readMacrosState(app)
    expect(state1.ok).toBe(false)
    if (state1.ok) return
    expect(state1.reason).toBe('library_corrupt')
    expect(state1.maxBytes).toBe(MAX_MACROS_FILE_BYTES)
    expect(state1.corruptBackupPath).toBeTruthy()
    expect(state1.corruptBackupPath!).toMatch(/hwp-macros\.json\.corrupt-\d{8}-\d{6}/)
    expect(readFileSync(state1.corruptBackupPath!, 'utf8')).toBe(corruptPayload)
    expect(readFileSync(storePath, 'utf8')).toBe(corruptPayload)

    // Repeated reads reuse the identical backup instead of spamming files
    const state2 = readMacrosState(app)
    expect(state2.ok).toBe(false)
    if (!state2.ok) {
      expect(state2.corruptBackupPath).toBe(state1.corruptBackupPath)
    }
    const backups = readdirSync(userData.dir).filter((name) =>
      name.startsWith(`${MACROS_FILE_NAME}.corrupt-`),
    )
    expect(backups).toHaveLength(1)

    // Every mutating operation refuses without altering hwp-macros.json
    const addRes = addMacro(app, { name: 'Blocked', script: 'insertText("a");' })
    expect(addRes.ok).toBe(false)
    if (!addRes.ok) {
      expect(addRes.reason).toBe('library_corrupt')
      expect(addRes.corruptBackupPath).toBe(state1.corruptBackupPath)
    }

    const updateRes = updateMacro(app, 'any-id', { name: 'Updated' })
    expect(updateRes.ok).toBe(false)
    if (!updateRes.ok) expect(updateRes.reason).toBe('library_corrupt')

    const deleteRes = deleteMacro(app, 'any-id')
    expect(deleteRes.ok).toBe(false)
    if (!deleteRes.ok) expect(deleteRes.reason).toBe('library_corrupt')

    const slotRes = assignMacroSlot(app, 'any-id', 1)
    expect(slotRes.ok).toBe(false)
    if (!slotRes.ok) expect(slotRes.reason).toBe('library_corrupt')

    const importRes = commitMacroImport(app, { name: 'Imported', script: 'insertText("b");' })
    expect(importRes.ok).toBe(false)
    if (!importRes.ok) expect(importRes.reason).toBe('library_corrupt')

    expect(readFileSync(storePath, 'utf8')).toBe(corruptPayload)
  })
})

describe('macros-ipc.ts Electron IPC handlers & security', () => {
  it('rejects non-HWP senders on every macro channel without mutating disk, broadcasting, or opening dialogs', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const foreignSender = fakeContents()

    const invokeChannels: Array<[string, unknown[]]> = [
      [HWP_CHANNELS.macrosReadState, []],
      [HWP_CHANNELS.macrosAdd, [{ name: 'Injected', script: 'insertText("x");' }]],
      [HWP_CHANNELS.macrosUpdate, ['id-1', { name: 'Tampered' }]],
      [HWP_CHANNELS.macrosDelete, ['id-1']],
      [HWP_CHANNELS.macrosAssignSlot, ['id-1', 1]],
      [HWP_CHANNELS.macrosPickImportFile, []],
      [HWP_CHANNELS.macrosCommitImport, [{ name: 'Imported', script: 'insertText("y");' }]],
      [HWP_CHANNELS.macrosExportFile, ['id-1']],
    ]

    for (const [channel, args] of invokeChannels) {
      const handler = handlers.get(channel)
      expect(handler, `handler registered for ${channel}`).toBeTypeOf('function')
      const res = (await handler!({ sender: foreignSender }, ...args)) as {
        ok: boolean
        reason?: string
      }
      expect(res.ok).toBe(false)
      expect(res.reason).toBe('unauthorized')
    }

    const state = readMacrosState(settingsApp())
    expect(state.ok && state.macros).toEqual([])
    expect(v1.send).not.toHaveBeenCalled()
    expect(mockShowOpenDialog).not.toHaveBeenCalled()
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
  })

  it('broadcasts macrosChanged to live HWP views and handles native import preview, commit, and export dialogs', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const v2 = createHwpView().webContents as unknown as FakeContents
    const v3 = createHwpView().webContents as unknown as FakeContents
    v3.destroyed = true

    const readStateHandler = handlers.get(HWP_CHANNELS.macrosReadState)!
    const addHandler = handlers.get(HWP_CHANNELS.macrosAdd)!
    const updateHandler = handlers.get(HWP_CHANNELS.macrosUpdate)!
    const assignSlotHandler = handlers.get(HWP_CHANNELS.macrosAssignSlot)!
    const pickImportHandler = handlers.get(HWP_CHANNELS.macrosPickImportFile)!
    const commitImportHandler = handlers.get(HWP_CHANNELS.macrosCommitImport)!
    const exportHandler = handlers.get(HWP_CHANNELS.macrosExportFile)!
    const deleteHandler = handlers.get(HWP_CHANNELS.macrosDelete)!

    // Add via IPC -> broadcasts macrosChanged to live views v1 & v2 only
    const added = (await addHandler(
      { sender: v1 },
      {
        name: 'Normalize Quotes',
        description: 'Converts straight quotes',
        script: 'replaceAll("\\"", "“");',
        slot: 1,
        origin: 'recorded',
      },
    )) as { ok: true; macro: { id: string }; macros: unknown[] }
    expect(added.ok).toBe(true)
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, added.macros)
    expect(v2.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, added.macros)
    expect(v3.send).not.toHaveBeenCalled()

    // Update via IPC -> broadcasts macrosChanged
    v1.send.mockClear()
    const updated = (await updateHandler({ sender: v2 }, added.macro.id, {
      name: 'Normalize Quotes v2',
    })) as { ok: true; macro: { name: string }; macros: unknown[] }
    expect(updated.ok).toBe(true)
    expect(updated.macro.name).toBe('Normalize Quotes v2')
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, updated.macros)

    // Assign slot via IPC -> broadcasts macrosChanged
    v1.send.mockClear()
    const slotted = (await assignSlotHandler({ sender: v1 }, added.macro.id, 5)) as {
      ok: true
      macro: { slot: number | null }
      macros: unknown[]
    }
    expect(slotted.ok).toBe(true)
    expect(slotted.macro.slot).toBe(5)
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, slotted.macros)

    // Export via native save dialog -> appends .ieummacro automatically
    const outNoExt = join(dir, 'exported-macro')
    mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outNoExt })
    const exported = (await exportHandler({ sender: v1 }, added.macro.id)) as {
      ok: true
      path: string
      macroId: string
      name: string
    }
    expect(exported.ok).toBe(true)
    expect(exported.path).toBe(`${outNoExt}${MACRO_FILE_EXT}`)
    expect(exported.macroId).toBe(added.macro.id)
    expect(existsSync(exported.path)).toBe(true)

    // Pick import file via native open dialog -> read-only preview (does NOT save!)
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exported.path] })
    const picked = (await pickImportHandler({ sender: v2 })) as {
      ok: true
      fileName: string
      preview: { name: string; script: string }
    }
    expect(picked.ok).toBe(true)
    expect(picked.fileName).toBe(`exported-macro${MACRO_FILE_EXT}`)
    expect(picked.preview.name).toBe('Normalize Quotes v2')
    const beforeCommit = (await readStateHandler({ sender: v1 })) as {
      ok: true
      macros: unknown[]
    }
    expect(beforeCommit.ok).toBe(true)
    expect(beforeCommit.macros).toHaveLength(1)

    // Commit import -> saves with origin: 'imported' and broadcasts
    v2.send.mockClear()
    const committed = (await commitImportHandler({ sender: v1 }, picked.preview)) as {
      ok: true
      macro: { id: string; origin: string }
      macros: unknown[]
    }
    expect(committed.ok).toBe(true)
    expect(committed.macro.origin).toBe('imported')
    expect(committed.macros).toHaveLength(2)
    expect(v2.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, committed.macros)

    // Delete via IPC -> broadcasts updated list
    v1.send.mockClear()
    const deleted = (await deleteHandler({ sender: v1 }, added.macro.id)) as {
      ok: true
      deletedId: string
      macros: unknown[]
    }
    expect(deleted.ok).toBe(true)
    expect(deleted.macros).toHaveLength(1)
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.macrosChanged, deleted.macros)

    // Corrupt store refuses pickImport and export before opening native dialogs
    writeFileSync(macrosPathOf(settingsApp()), '{BROKEN', 'utf8')
    mockShowOpenDialog.mockClear()
    mockShowSaveDialog.mockClear()
    const corruptPick = (await pickImportHandler({ sender: v1 })) as {
      ok: false
      reason: string
    }
    expect(corruptPick.ok).toBe(false)
    expect(corruptPick.reason).toBe('library_corrupt')
    expect(mockShowOpenDialog).not.toHaveBeenCalled()

    const corruptExport = (await exportHandler({ sender: v1 }, committed.macro.id)) as {
      ok: false
      reason: string
    }
    expect(corruptExport.ok).toBe(false)
    expect(corruptExport.reason).toBe('library_corrupt')
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
  })

  it('guards against silent export overwrite when ensureExtension resolves to an existing file and passes syntaxChecker on import preview', async () => {
    const savedHandlers = new Map(handlers)
    try {
      const app = settingsApp()
      const seeded = addMacro(app, {
        name: 'Export Guard Macro',
        script: 'insertText("fresh");',
      })
      expect(seeded.ok).toBe(true)
      if (!seeded.ok) return

      const v1 = fakeContents()
      const confirmOverwrite = vi.fn(async () => false)
      const syntaxChecker = vi.fn(() => ({
        ok: false as const,
        error: 'Syntax error on line 1',
        line: 1,
        column: 7,
      }))

      registerHwpMacrosIpc({
        app: {
          getPath: (name: string) =>
            name === 'userData' ? userData.dir : join(userData.dir, `path-${name}`),
        },
        hasView: (id) => id === v1.id,
        getWindow: () => null,
        broadcast: () => {},
        confirmOverwrite,
        syntaxChecker,
      })

      const exportHandler = handlers.get(HWP_CHANNELS.macrosExportFile)!
      const pickImportHandler = handlers.get(HWP_CHANNELS.macrosPickImportFile)!

      const baseNoExt = join(dir, 'existing-macro')
      const suffixedPath = `${baseNoExt}${MACRO_FILE_EXT}`
      const originalContent = '// sentinel: do not overwrite'
      writeFileSync(suffixedPath, originalContent, 'utf8')

      // 1. Declining overwrite leaves existing suffixed file completely untouched
      mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: baseNoExt })
      confirmOverwrite.mockResolvedValueOnce(false)
      const declined = (await exportHandler({ sender: v1 }, seeded.macro.id)) as {
        ok: true
        canceled?: true
      }
      expect(declined).toEqual({ ok: true, canceled: true })
      expect(confirmOverwrite).toHaveBeenCalledTimes(1)
      expect(confirmOverwrite).toHaveBeenCalledWith(suffixedPath)
      expect(readFileSync(suffixedPath, 'utf8')).toBe(originalContent)

      // 2. Confirming overwrite replaces the existing suffixed file cleanly
      mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: baseNoExt })
      confirmOverwrite.mockResolvedValueOnce(true)
      const confirmed = (await exportHandler({ sender: v1 }, seeded.macro.id)) as {
        ok: true
        path: string
      }
      expect(confirmed.ok).toBe(true)
      expect(confirmed.path).toBe(suffixedPath)
      expect(confirmOverwrite).toHaveBeenCalledTimes(2)
      expect(readFileSync(suffixedPath, 'utf8')).toContain('Export Guard Macro')

      // 3. Already-suffixed path does not trigger double confirmation
      confirmOverwrite.mockClear()
      mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: suffixedPath })
      const direct = (await exportHandler({ sender: v1 }, seeded.macro.id)) as {
        ok: true
        path: string
      }
      expect(direct.ok).toBe(true)
      expect(confirmOverwrite).not.toHaveBeenCalled()

      // 4. Injected syntaxChecker runs during macrosPickImportFile preview
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [suffixedPath] })
      const previewRes = (await pickImportHandler({ sender: v1 })) as {
        ok: true
        preview: { syntax?: { ok: false; error: string; line: number; column: number } }
      }
      expect(previewRes.ok).toBe(true)
      expect(syntaxChecker).toHaveBeenCalledWith('insertText("fresh");')
      expect(previewRes.preview.syntax).toEqual({
        ok: false,
        error: 'Syntax error on line 1',
        line: 1,
        column: 7,
      })

      // 5. Default dialog.showMessageBox path (without custom confirmOverwrite hook)
      registerHwpMacrosIpc({
        app: {
          getPath: (name: string) =>
            name === 'userData' ? userData.dir : join(userData.dir, `path-${name}`),
        },
        hasView: (id) => id === v1.id,
        getWindow: () => null,
        broadcast: () => {},
      })
      const defaultExportHandler = handlers.get(HWP_CHANNELS.macrosExportFile)!
      writeFileSync(suffixedPath, originalContent, 'utf8')

      mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: baseNoExt })
      mockShowMessageBox.mockResolvedValueOnce({ response: 1 })
      const dialogCanceled = (await defaultExportHandler({ sender: v1 }, seeded.macro.id)) as {
        ok: true
        canceled?: true
      }
      expect(dialogCanceled).toEqual({ ok: true, canceled: true })
      expect(mockShowMessageBox).toHaveBeenCalledTimes(1)
      expect(readFileSync(suffixedPath, 'utf8')).toBe(originalContent)

      mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: baseNoExt })
      mockShowMessageBox.mockResolvedValueOnce({ response: 0 })
      const dialogConfirmed = (await defaultExportHandler({ sender: v1 }, seeded.macro.id)) as {
        ok: true
        path: string
      }
      expect(dialogConfirmed.ok).toBe(true)
      expect(readFileSync(suffixedPath, 'utf8')).toContain('Export Guard Macro')
    } finally {
      handlers.clear()
      for (const [channel, fn] of savedHandlers) {
        handlers.set(channel, fn)
      }
    }
  })
})
