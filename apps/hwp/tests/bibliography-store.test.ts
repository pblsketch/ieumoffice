// @vitest-environment node
/**
 * Tests for the app-wide Hangul bibliography store (`bibliography.ts`)
 * and its main-process Electron IPC handlers (`bibliography-ipc.ts`).
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
    showMessageBox: vi.fn(async () => ({ response: 1 })),
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
  BIBLIOGRAPHY_FILE_NAME,
  BIBLIOGRAPHY_SCHEMA_VERSION,
  MAX_IMPORT_BYTES,
  addAiBibliographyCandidates,
  addBibliographyEntry,
  bibliographyPathOf,
  commitBibliographyImport,
  deleteBibliographyEntry,
  listBibliographyTags,
  loadBibliographyFile,
  previewBibliographyFileImport,
  previewBibliographyImport,
  readBibliography,
  readBibliographyFromFile,
  updateBibliographyEntry,
  verifyBibliographyEntry,
  writeBibliographyExportFile,
} from '../src/main/bibliography'
import { createHwpView } from '../src/main/hwp-main'
import { HWP_CHANNELS } from '../src/shared/ipc'
import { parseBibliographyFile } from '../studio-plugin/citation-io.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-bib-'))
  userData.dir = join(dir, 'userData')
  mkdirSync(userData.dir, { recursive: true })
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

describe('bibliography.ts pure Node store', () => {
  it('contains zero Electron imports so CLI can import it directly in Node', () => {
    const source = readFileSync(join(__dirname, '../src/main/bibliography.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"]electron['"]/)
    expect(source).not.toMatch(/require\(\s*['"]electron['"]\s*\)/)
  })

  it('writes atomically and synchronously without leftover temp files', () => {
    const missingDir = join(dir, 'nested', 'not-created-yet')
    expect(bibliographyPathOf(missingDir)).toBe(join(missingDir, BIBLIOGRAPHY_FILE_NAME))
    expect(readBibliography(missingDir)).toEqual([])

    const first = addBibliographyEntry(missingDir, {
      type: 'article',
      authors: ['홍길동'],
      year: '2024',
      title: '첫 번째 연구',
      tags: ['서론', '핵심'],
    })
    expect(first.ok).toBe(true)

    const second = addBibliographyEntry(missingDir, {
      type: 'book',
      authors: ['Jane Doe'],
      year: '2023',
      title: 'Second Study',
      tags: ['방법론', '서론'],
    })
    expect(second.ok).toBe(true)

    const diskPath = bibliographyPathOf(missingDir)
    expect(existsSync(diskPath)).toBe(true)
    const filesInDir = readdirSync(missingDir)
    expect(filesInDir).toEqual([BIBLIOGRAPHY_FILE_NAME])

    const raw = JSON.parse(readFileSync(diskPath, 'utf8')) as {
      version: number
      updatedAt: string
      entries: unknown[]
    }
    expect(raw.version).toBe(BIBLIOGRAPHY_SCHEMA_VERSION)
    expect(typeof raw.updatedAt).toBe('string')
    expect(raw.entries).toHaveLength(2)

    const entries = readBibliography(missingDir)
    expect(entries).toHaveLength(2)
    expect(listBibliographyTags(entries)).toEqual(['방법론', '서론', '핵심'])
  })

  it('loads explicit files with structured error reasons for missing, corrupt, or oversized files', () => {
    const missing = loadBibliographyFile(join(dir, 'does-not-exist.json'))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe('not_found')

    const corruptPath = join(dir, 'corrupt.json')
    writeFileSync(corruptPath, '{not valid json')
    const corrupt = loadBibliographyFile(corruptPath)
    expect(corrupt.ok).toBe(false)
    if (!corrupt.ok) expect(corrupt.reason).toBe('invalid_format')
    expect(readBibliographyFromFile(corruptPath)).toEqual([])

    const bareArrayPath = join(dir, 'bare.json')
    writeFileSync(
      bareArrayPath,
      JSON.stringify([{ title: 'Bare Array Paper', authors: ['Kim Minsoo'], year: '2022' }]),
    )
    const bare = loadBibliographyFile(bareArrayPath)
    expect(bare.ok).toBe(true)
    if (bare.ok) {
      expect(bare.entries).toHaveLength(1)
      expect(bare.entries[0].title).toBe('Bare Array Paper')
    }

    const oversized = loadBibliographyFile(bareArrayPath, { maxBytes: 10 })
    expect(oversized.ok).toBe(false)
    if (!oversized.ok) expect(oversized.reason).toBe('too_large')
  })

  it('supports human add, update, key rename preserving oldKeys, verify, and delete', () => {
    const app = settingsApp()
    const added1 = addBibliographyEntry(app, {
      type: 'article',
      authors: ['홍길동'],
      year: '2024',
      title: '인공지능 교육 연구',
      doi: '10.1000/abc.1',
      tags: ['교육', 'AI'],
    })
    expect(added1.ok).toBe(true)
    if (!added1.ok) return
    expect(added1.entry.verified).toBe(true)
    expect(added1.entry.source).toBe('manual')
    expect(added1.entry.key).toBe('홍길동2024')

    const added2 = addBibliographyEntry(app, {
      type: 'article',
      authors: ['홍길동'],
      year: '2024',
      title: '동일 저자 두 번째 논문',
    })
    expect(added2.ok).toBe(true)
    if (!added2.ok) return
    expect(added2.entry.key).toBe('홍길동2024a')

    // Rename key -> preserves old key in oldKeys and returns renamedKey metadata
    const renamed = updateBibliographyEntry(app, added1.entry.id, {
      key: 'hong2024ai',
      title: '인공지능 교육 연구 (개정)',
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.entry.key).toBe('hong2024ai')
    expect(renamed.entry.oldKeys).toContain('홍길동2024')
    expect(renamed.renamedKey).toEqual({
      id: added1.entry.id,
      oldKey: '홍길동2024',
      newKey: 'hong2024ai',
      title: '인공지능 교육 연구 (개정)',
    })

    // Renaming to another entry's active key is refused with duplicate_key
    const duplicateKey = updateBibliographyEntry(app, added1.entry.id, {
      key: added2.entry.key,
    })
    expect(duplicateKey.ok).toBe(false)
    if (!duplicateKey.ok) expect(duplicateKey.reason).toBe('duplicate_key')

    // Empty/symbol-only key is refused with invalid_key
    const badKey = updateBibliographyEntry(app, added1.entry.id, { key: '  :::  ' })
    expect(badKey.ok).toBe(false)
    if (!badKey.ok) expect(badKey.reason).toBe('invalid_key')

    // Delete entry
    const deleted = deleteBibliographyEntry(app, added2.entry.id)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.deletedId).toBe(added2.entry.id)
    expect(deleted.entries).toHaveLength(1)
    expect(readBibliography(app)).toHaveLength(1)
  })

  it('enforces the AI verification security invariant strictly across all store operations', () => {
    const app = settingsApp()

    // 1. AI candidate missing source URL is refused
    const missingUrl = addAiBibliographyCandidates(app, [
      {
        title: 'Unverified Paper Without URL',
        authors: ['Alice Smith'],
        year: '2025',
      },
    ])
    expect(missingUrl.ok).toBe(false)
    if (!missingUrl.ok) expect(missingUrl.reason).toBe('missing_source_url')
    expect(readBibliography(app)).toEqual([])

    // 2. Non-http(s) URL schemes (e.g. javascript:, file:) are refused
    const badScheme = addAiBibliographyCandidates(app, [
      {
        title: 'Suspicious Scheme Paper',
        sourceUrl: 'javascript:alert(1)',
      },
    ])
    expect(badScheme.ok).toBe(false)
    if (!badScheme.ok) expect(badScheme.reason).toBe('missing_source_url')

    // 3. AI candidates ALWAYS force verified: false and source: 'ai' even when caller passes verified: true
    const aiAdded = addAiBibliographyCandidates(app, [
      {
        title: 'Verified Attempt From AI',
        authors: ['Bob Lee'],
        year: '2024',
        doi: '10.1234/ai-paper',
        verified: true,
        source: 'manual',
        sourceUrl: 'https://example.org/papers/ai-paper',
      },
      {
        title: 'URL In Memo Candidate',
        authors: ['Carol Kim'],
        year: '2023',
        memo: 'Found on https://example.edu/archive/123',
        verified: true,
      },
    ])
    expect(aiAdded.ok).toBe(true)
    if (!aiAdded.ok) return
    expect(aiAdded.added).toHaveLength(2)
    expect(aiAdded.added[0].verified).toBe(false)
    expect(aiAdded.added[0].source).toBe('ai')
    expect(aiAdded.added[0].memo).toContain('https://example.org/papers/ai-paper')
    expect(aiAdded.added[1].verified).toBe(false)
    expect(aiAdded.added[1].source).toBe('ai')

    // 4. addBibliographyEntry with actor: 'ai' also forces verified: false and source: 'ai'
    const aiSingle = addBibliographyEntry(
      app,
      {
        title: 'Single AI Addition',
        verified: true,
        source: 'manual',
      },
      { actor: 'ai' },
    )
    expect(aiSingle.ok).toBe(true)
    if (!aiSingle.ok) return
    expect(aiSingle.entry.verified).toBe(false)
    expect(aiSingle.entry.source).toBe('ai')

    // 5. Duplicate AI candidate does NOT flip existing unverified entry to verified
    const dupAi = addAiBibliographyCandidates(app, [
      {
        title: 'Verified Attempt From AI',
        year: '2024',
        doi: 'https://doi.org/10.1234/ai-paper',
        verified: true,
        sourceUrl: 'https://example.org/papers/ai-paper',
      },
    ])
    expect(dupAi.ok).toBe(true)
    if (!dupAi.ok) return
    expect(dupAi.added).toHaveLength(0)
    expect(dupAi.duplicates).toHaveLength(1)
    expect(dupAi.duplicates[0].matchReason).toBe('doi')
    const afterDup = readBibliography(app).find((e) => e.id === aiAdded.added[0].id)
    expect(afterDup?.verified).toBe(false)

    // 6. AI update CANNOT verify an entry
    const aiVerifyAttempt = updateBibliographyEntry(
      app,
      aiAdded.added[0].id,
      { verified: true, memo: 'looks right' },
      { actor: 'ai' },
    )
    expect(aiVerifyAttempt.ok).toBe(false)
    if (!aiVerifyAttempt.ok) expect(aiVerifyAttempt.reason).toBe('ai_cannot_verify')
    expect(readBibliography(app).find((e) => e.id === aiAdded.added[0].id)?.verified).toBe(false)

    // 7. Human-only verifyBibliographyEntry marks the entry as verified: true
    const humanVerified = verifyBibliographyEntry(app, aiAdded.added[0].id)
    expect(humanVerified.ok).toBe(true)
    if (!humanVerified.ok) return
    expect(humanVerified.entry.verified).toBe(true)
    expect(readBibliography(app).find((e) => e.id === aiAdded.added[0].id)?.verified).toBe(true)
  })

  it('rejects empty or whitespace-only inputs cleanly', () => {
    const app = settingsApp()

    const emptyTitle = addBibliographyEntry(app, { title: '   \t\n  ' })
    expect(emptyTitle.ok).toBe(false)
    if (!emptyTitle.ok) expect(emptyTitle.reason).toBe('invalid_input')

    const emptyKey = addBibliographyEntry(app, { title: 'Valid Title', key: '   ' })
    expect(emptyKey.ok).toBe(false)
    if (!emptyKey.ok) expect(emptyKey.reason).toBe('invalid_input')

    const emptyAi = addAiBibliographyCandidates(app, [])
    expect(emptyAi.ok).toBe(false)
    if (!emptyAi.ok) expect(emptyAi.reason).toBe('invalid_input')

    const emptyPreview = previewBibliographyImport(app, [])
    expect(emptyPreview.ok).toBe(false)
    if (!emptyPreview.ok) expect(emptyPreview.reason).toBe('empty')

    const emptyCommit = commitBibliographyImport(app, [])
    expect(emptyCommit.ok).toBe(false)
    if (!emptyCommit.ok) expect(emptyCommit.reason).toBe('empty')

    const added = addBibliographyEntry(app, { title: 'Keep Me' })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const blankUpdate = updateBibliographyEntry(app, added.entry.id, { title: '   ' })
    expect(blankUpdate.ok).toBe(false)
    if (!blankUpdate.ok) expect(blankUpdate.reason).toBe('invalid_input')
    expect(readBibliography(app)[0].title).toBe('Keep Me')
  })

  it('detects duplicates on read-only preview and sets verified: true only on commit', () => {
    const app = settingsApp()
    const seed = addBibliographyEntry(app, {
      type: 'article',
      authors: ['Jane Smith'],
      year: '2024',
      title: 'Deep Learning in Education',
      doi: '10.1000/edu.2024',
    })
    expect(seed.ok).toBe(true)

    const candidates = [
      {
        title: 'Different Title Same DOI',
        year: '2024',
        doi: 'https://doi.org/10.1000/EDU.2024',
      },
      {
        title: 'deep learning in education!',
        year: '2024',
      },
      {
        title: 'Brand New Reference',
        authors: ['박영희'],
        year: '2025',
        verified: false,
      },
    ]

    // Preview is strictly read-only
    const previewRes = previewBibliographyImport(app, candidates)
    expect(previewRes.ok).toBe(true)
    if (!previewRes.ok) return
    expect(previewRes.preview.toAdd).toHaveLength(1)
    expect(previewRes.preview.duplicates).toHaveLength(2)
    expect(previewRes.preview.duplicates.map((d) => d.matchReason)).toEqual(['doi', 'title_year'])
    expect(readBibliography(app)).toHaveLength(1)

    // File import preview rejects oversized files without loading into memory
    const bigFile = join(dir, 'oversized.bib')
    writeFileSync(bigFile, 'a'.repeat(MAX_IMPORT_BYTES + 10))
    const tooLarge = previewBibliographyFileImport(app, bigFile)
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) expect(tooLarge.reason).toBe('too_large')

    // Commit writes only non-duplicates and sets verified: true + source: 'document'
    const commitRes = commitBibliographyImport(app, candidates, { source: 'document' })
    expect(commitRes.ok).toBe(true)
    if (!commitRes.ok) return
    expect(commitRes.added).toHaveLength(1)
    expect(commitRes.skippedDuplicates).toHaveLength(2)
    expect(commitRes.added[0].verified).toBe(true)
    expect(commitRes.added[0].source).toBe('document')
    expect(readBibliography(app)).toHaveLength(2)
  })

  it('exports BibTeX, RIS, and CSL JSON atomically to disk with tag filtering and roundtrips cleanly', () => {
    const app = settingsApp()
    addBibliographyEntry(app, {
      type: 'article',
      authors: [{ family: 'Kim', given: 'Minsoo' }],
      year: '2024',
      title: 'Semantic Retrieval for Documents',
      containerTitle: 'Journal of Computing',
      volume: '12',
      issue: '3',
      pages: '45-60',
      doi: '10.1000/jc.123',
      tags: ['chapter1', 'core'],
    })
    addBibliographyEntry(app, {
      type: 'book',
      authors: ['이철수'],
      year: '2023',
      title: '논문 작성의 기초',
      publisher: '학술출판사',
      tags: ['chapter2'],
    })

    const entries = readBibliography(app)
    const exportDir = join(dir, 'exports')

    // BibTeX full roundtrip
    const bibPath = join(exportDir, 'refs.bib')
    const bibRes = writeBibliographyExportFile(bibPath, entries, 'bibtex')
    expect(bibRes).toEqual({ ok: true, path: bibPath, count: 2, format: 'bibtex' })
    const bibParsed = parseBibliographyFile(readFileSync(bibPath), { filename: 'refs.bib' })
    expect(bibParsed.ok).toBe(true)
    if (bibParsed.ok) expect(bibParsed.entries).toHaveLength(2)

    // RIS tag-filtered roundtrip
    const risPath = join(exportDir, 'chapter1.ris')
    const risRes = writeBibliographyExportFile(risPath, entries, 'ris', { tag: 'chapter1' })
    expect(risRes).toEqual({ ok: true, path: risPath, count: 1, format: 'ris' })
    const risParsed = parseBibliographyFile(readFileSync(risPath), { filename: 'chapter1.ris' })
    expect(risParsed.ok).toBe(true)
    if (risParsed.ok) {
      expect(risParsed.entries).toHaveLength(1)
      expect(risParsed.entries[0].title).toBe('Semantic Retrieval for Documents')
    }

    // CSL JSON roundtrip
    const cslPath = join(exportDir, 'refs.json')
    const cslRes = writeBibliographyExportFile(cslPath, entries, 'csl-json')
    expect(cslRes).toEqual({ ok: true, path: cslPath, count: 2, format: 'csl-json' })
    const cslParsed = parseBibliographyFile(readFileSync(cslPath), { filename: 'refs.json' })
    expect(cslParsed.ok).toBe(true)
    if (cslParsed.ok) expect(cslParsed.entries).toHaveLength(2)

    // No leftover .tmp files in exportDir
    expect(readdirSync(exportDir).filter((name) => name.endsWith('.tmp'))).toEqual([])

    // Invalid format rejected
    const badFmt = writeBibliographyExportFile(
      join(exportDir, 'bad.txt'),
      entries,
      'xml' as 'bibtex',
    )
    expect(badFmt.ok).toBe(false)
    if (!badFmt.ok) expect(badFmt.reason).toBe('invalid_format')
  })
})

describe('bibliography-ipc.ts Electron IPC handlers & security', () => {
  it('rejects non-HWP senders on every bibliography channel without mutating disk or broadcasting', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const foreignSender = fakeContents()

    const invokeChannels: Array<[string, unknown[]]> = [
      [HWP_CHANNELS.bibList, []],
      [HWP_CHANNELS.bibAdd, [{ title: 'Injected' }]],
      [HWP_CHANNELS.bibUpdate, ['bib_1', { title: 'Tampered' }]],
      [HWP_CHANNELS.bibDelete, ['bib_1']],
      [HWP_CHANNELS.bibVerify, ['bib_1']],
      [
        HWP_CHANNELS.bibAddAiCandidates,
        [[{ title: 'AI', sourceUrl: 'https://example.org/paper' }]],
      ],
      [HWP_CHANNELS.bibPickImportFile, []],
      [HWP_CHANNELS.bibPreviewImport, [[{ title: 'Preview' }]]],
      [HWP_CHANNELS.bibCommitImport, [[{ title: 'Commit' }]]],
      [HWP_CHANNELS.bibExportFile, ['bibtex']],
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

    expect(readBibliography(settingsApp())).toEqual([])
    expect(v1.send).not.toHaveBeenCalled()
    expect(mockShowOpenDialog).not.toHaveBeenCalled()
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
  })

  it('broadcasts bibChanged and bibKeyRenamed to live HWP views and handles native import/export dialogs', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const v2 = createHwpView().webContents as unknown as FakeContents
    const v3 = createHwpView().webContents as unknown as FakeContents
    v3.destroyed = true

    const listHandler = handlers.get(HWP_CHANNELS.bibList)!
    const addHandler = handlers.get(HWP_CHANNELS.bibAdd)!
    const updateHandler = handlers.get(HWP_CHANNELS.bibUpdate)!
    const verifyHandler = handlers.get(HWP_CHANNELS.bibVerify)!
    const aiHandler = handlers.get(HWP_CHANNELS.bibAddAiCandidates)!
    const pickImportHandler = handlers.get(HWP_CHANNELS.bibPickImportFile)!
    const commitImportHandler = handlers.get(HWP_CHANNELS.bibCommitImport)!
    const exportHandler = handlers.get(HWP_CHANNELS.bibExportFile)!
    const deleteHandler = handlers.get(HWP_CHANNELS.bibDelete)!

    // Add via IPC -> broadcasts bibChanged to v1 and v2 (not destroyed v3)
    const added = (await addHandler(
      { sender: v1 },
      {
        type: 'article',
        authors: ['김철수'],
        year: '2024',
        title: 'IPC 테스트 논문',
        tags: ['테스트'],
      },
    )) as { ok: true; entry: { id: string; key: string }; entries: unknown[] }
    expect(added.ok).toBe(true)
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.bibChanged, added.entries)
    expect(v2.send).toHaveBeenCalledWith(HWP_CHANNELS.bibChanged, added.entries)
    expect(v3.send).not.toHaveBeenCalled()

    // List returns entries and tags
    const listed = (await listHandler({ sender: v2 })) as {
      ok: true
      entries: unknown[]
      tags: string[]
    }
    expect(listed.ok).toBe(true)
    expect(listed.entries).toHaveLength(1)
    expect(listed.tags).toEqual(['테스트'])

    // Rename key via bibUpdate -> broadcasts both bibChanged and bibKeyRenamed
    v1.send.mockClear()
    v2.send.mockClear()
    const renamed = (await updateHandler({ sender: v1 }, added.entry.id, {
      key: 'kim2024ipc',
    })) as { ok: true; renamedKey?: { id: string; oldKey: string; newKey: string; title: string } }
    expect(renamed.ok).toBe(true)
    expect(renamed.renamedKey).toEqual({
      id: added.entry.id,
      oldKey: '김철수2024',
      newKey: 'kim2024ipc',
      title: 'IPC 테스트 논문',
    })
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.bibKeyRenamed, renamed.renamedKey)
    expect(v2.send).toHaveBeenCalledWith(HWP_CHANNELS.bibKeyRenamed, renamed.renamedKey)

    // AI candidates via IPC -> stored unverified, then verified via bibVerify
    const aiRes = (await aiHandler({ sender: v1 }, [
      {
        title: 'AI Discovered Study',
        authors: ['Alice Park'],
        year: '2025',
        verified: true,
        sourceUrl: 'https://example.org/ai-study',
      },
    ])) as { ok: true; added: Array<{ id: string; verified: boolean; source: string }> }
    expect(aiRes.ok).toBe(true)
    expect(aiRes.added[0].verified).toBe(false)
    expect(aiRes.added[0].source).toBe('ai')

    const verified = (await verifyHandler({ sender: v2 }, aiRes.added[0].id)) as {
      ok: true
      entry: { verified: boolean }
    }
    expect(verified.ok).toBe(true)
    expect(verified.entry.verified).toBe(true)

    // Native import dialog -> preview without writing to store, then commit
    const bibFile = join(dir, 'sample.bib')
    writeFileSync(
      bibFile,
      `@article{doe2025,\n  author = {Doe, Jane},\n  title = {Imported BibTeX Article},\n  journal = {Science},\n  year = {2025}\n}\n`,
    )
    mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [bibFile] })

    const picked = (await pickImportHandler({ sender: v1 })) as {
      ok: true
      fileName: string
      format: string
      preview: { toAdd: Array<{ title: string }> }
    }
    expect(picked.ok).toBe(true)
    expect(picked.fileName).toBe('sample.bib')
    expect(picked.format).toBe('bibtex')
    expect(picked.preview.toAdd).toHaveLength(1)
    // Preview MUST NOT write to hwp-bibliography.json
    expect(readBibliography(settingsApp())).toHaveLength(2)

    const committed = (await commitImportHandler({ sender: v1 }, picked.preview.toAdd, {
      source: 'import',
    })) as { ok: true; added: Array<{ verified: boolean; source: string }> }
    expect(committed.ok).toBe(true)
    expect(committed.added[0].verified).toBe(true)
    expect(committed.added[0].source).toBe('import')
    expect(readBibliography(settingsApp())).toHaveLength(3)

    // Native export dialog -> appends extension if omitted and writes file
    const outNoExt = join(dir, 'exported-library')
    mockShowSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outNoExt })
    const exported = (await exportHandler({ sender: v1 }, 'csl-json')) as {
      ok: true
      path: string
      count: number
      format: string
    }
    expect(exported.ok).toBe(true)
    expect(exported.path).toBe(`${outNoExt}.json`)
    expect(exported.count).toBe(3)
    expect(existsSync(`${outNoExt}.json`)).toBe(true)

    // Delete broadcasts updated entries
    v1.send.mockClear()
    const deleted = (await deleteHandler({ sender: v1 }, added.entry.id)) as {
      ok: true
      entries: unknown[]
    }
    expect(deleted.ok).toBe(true)
    expect(deleted.entries).toHaveLength(2)
    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.bibChanged, deleted.entries)
  })
})
