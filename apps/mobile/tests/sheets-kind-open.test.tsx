// The spreadsheet editor kind end to end over a stand-in phone: registration,
// open (view-first document, .xls/.csv conversion, a new workbook, notices),
// the password prompt (wrong, right, cancel, unsupported), the unlocked
// workbook's rules (editable, AI available, no recovery copy), and what
// dispose() and discard() clean up.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MobileCommandError,
  type MobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import type { EditorDocument, EditorHost, EditorOpened } from '../src/renderer/editors/editorKind'
import { findEditorKind, openableExtensions } from '../src/renderer/editors/registry'
import { sheetsEditorKinds } from '../src/renderer/editors/sheets'
import { sheetsEditorKind } from '../src/renderer/editors/sheets/kind'
import { liveSheetsWorkbooks } from '../src/renderer/editors/sheets/session'
import { OPEN_PROGRESS_DELAY_MS } from '../src/renderer/editors/sheets/open/overlays'
import { pinchZoomRatio } from '../src/renderer/editors/sheets/grid/pinchZoom'
import { FORMULA_KEYS } from '../src/renderer/editors/sheets/grid/FormulaKeyboardBar'
import { createFakeDevice, type FakeDevice } from './helpers/sheetsFakeDevice'

const recoveryWrites = vi.hoisted(() => ({ count: 0 }))

// The recovery copy is XLS-T10's; a stand-in shows whether the document lets it run.
vi.mock('../src/renderer/editors/sheets/save/documentSlot', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/editors/sheets/save/documentSlot')>()
  return {
    ...actual,
    createSheetsSaveActions: (context: Parameters<typeof actual.createSheetsSaveActions>[0]) => ({
      ...actual.createSheetsSaveActions(context),
      async writeRecovery() {
        recoveryWrites.count += 1
      },
    }),
  }
})

const DOC = 'doc-1'
const PASSWORD = 'pw 비밀 1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A stand-in encrypted workbook: a marker, the password, then the plain bytes. */
function locked(plain: Uint8Array, password: string, scheme = 'LOCKED'): Uint8Array {
  const head = encoder.encode(`${scheme}:${password}:`)
  const out = new Uint8Array(head.byteLength + plain.byteLength)
  out.set(head)
  out.set(plain, head.byteLength)
  return out
}

interface Phone {
  readonly device: FakeDevice
  readonly client: MobileClient
  readonly crypto: Record<string, unknown>[]
  externalLinks: number
}

/**
 * The fake device of the save tests plus the two things opening adds: the
 * engine library's password requests (`mobile_sheets_crypto`) over the
 * work folder, and `list_external_links`.
 */
function phone(): Phone {
  const device = createFakeDevice()
  const crypto: Record<string, unknown>[] = []
  const state: Phone = {
    device,
    client: undefined as unknown as MobileClient,
    crypto,
    externalLinks: 0,
  }
  const inner = device.client.transport
  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (command === 'mobile_sheets_crypto') {
        const request = JSON.parse(String(args.line)) as Record<string, string>
        crypto.push(request)
        device.log.push(command)
        const source = device.files.get(request.op === 'probe' ? request.path! : request.source!)
        if (!source) throw new Error('fake crypto: no such file')
        const text = decoder.decode(source.slice(0, 64))
        const match = /^(LOCKED|ODDLOCK):([^:]*):/.exec(text)
        if (request.op === 'probe') {
          return {
            ok: true,
            result: {
              encrypted: match !== null,
              supported: match?.[1] === 'LOCKED',
              document: 'ooxml',
            },
          } as T
        }
        if (!match) {
          return { ok: false, error: { code: 'not_encrypted', message: 'not encrypted' } } as T
        }
        if (match[2] !== request.password) {
          return { ok: false, error: { code: 'wrong_password', message: 'wrong' } } as T
        }
        device.files.set(request.target!, source.slice(encoder.encode(match[0]).byteLength))
        return { ok: true, result: { document: 'ooxml' } } as T
      }
      if (command === 'mobile_sheets_request') {
        const request = JSON.parse(String(args.line)) as Record<string, unknown>
        if (request.command === 'list_external_links') {
          device.log.push('engine:list_external_links')
          return {
            version: 1,
            requestId: request.requestId,
            ok: true,
            result: { links: Array.from({ length: state.externalLinks }, () => ({})) },
          } as T
        }
      }
      return inner.invoke<T>(command, args)
    },
    listen: inner.listen,
  }
  ;(state as { client: MobileClient }).client = {
    transport,
    shareFile: vi.fn(async () => undefined),
  } as unknown as MobileClient
  return state
}

function session(ext: string, writable = true): MobileDocSession {
  return {
    sessionId: DOC,
    docKey: 'key-1',
    name: `ledger.${ext}`,
    ext,
    format: ext as MobileDocSession['format'],
    writable,
    ephemeral: false,
  }
}

function host(): EditorHost {
  return {
    client: {} as MobileClient,
    markDirty: vi.fn(),
    updateSession: vi.fn(),
    setNotice: vi.fn(),
    showToast: vi.fn(),
    contentChanged: vi.fn(),
    refreshHome: vi.fn(async () => undefined),
    openSession: vi.fn(async () => undefined),
    translate: (key: string) => key,
    windowClass: () => 'compact',
  } as unknown as EditorHost
}

async function open(p: Phone, ext: string, isUntitled = false): Promise<EditorOpened> {
  return sheetsEditorKind.open({ session: session(ext), client: p.client, isUntitled })
}

/** Waits for the password sheet, types `password` and presses [Open] (or [Cancel]). */
async function answerPassword(password: string | null): Promise<{ retry: boolean }> {
  let input: HTMLInputElement | null = null
  for (let tries = 0; tries < 200 && !input; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    input = document.querySelector<HTMLInputElement>('[data-testid="sheets-password-input"]')
  }
  if (!input) throw new Error('no password sheet')
  const retry = document.querySelector('.m-sheets-password-wrong') !== null
  await act(async () => {
    if (password === null) {
      const cancel = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Cancel',
      )
      cancel!.click()
      return
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, password)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (password !== null) {
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="sheets-password-open"]')!.click()
    })
  }
  // The sheet unmounts on the next tick.
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { retry }
}

let plain: Uint8Array

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.documentElement.lang = 'en'
  recoveryWrites.count = 0
  plain = new Uint8Array(await buildEditFixture())
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the spreadsheet editor kind', () => {
  it('is the one kind of track T1 and opens .xlsx, .xlsm, .xls and .csv', () => {
    expect(sheetsEditorKinds).toEqual([sheetsEditorKind])
    for (const format of ['xlsx', 'xlsm', 'xls', 'csv'] as const) {
      expect(findEditorKind(format)).toBe(sheetsEditorKind)
    }
    expect(openableExtensions()).toEqual(expect.arrayContaining(['xlsx', 'xlsm', 'xls', 'csv']))
    expect(sheetsEditorKind).toMatchObject({
      id: 'sheets',
      createFormats: ['xlsx'],
      labelKey: 'sheetsEditorName',
      editable: true,
      hasAi: true,
    })
    expect(sheetsEditorKind.recoveryFormat('xls')).toBe('xlsx')
    expect(sheetsEditorKind.recoveryFormat('csv')).toBe('xlsx')
    expect(sheetsEditorKind.recoveryFormat('xlsm')).toBe('xlsx')
  })

  it('keeps the heavy code out of the app start (kind.ts imports types only)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(
      resolve(__dirname, '../src/renderer/editors/sheets/kind.ts'),
      'utf8',
    )
    const imports = [...source.matchAll(/^import\s.*$/gm)].map((match) => match[0])
    expect(imports.every((line) => line.startsWith('import type'))).toBe(true)
    expect(source).toContain("await import('./open/openDocument')")
  })

  it('has the grid helpers of design system 5.6', () => {
    expect(pinchZoomRatio(1, 100, 200)).toBe(2)
    expect(pinchZoomRatio(0.2, 300, 10)).toBe(0.1)
    expect(FORMULA_KEYS.map((key) => key.text)).toEqual(['=', '=SUM()', '()', ',', ':', '$'])
  })
})

describe('opening a workbook', () => {
  it('opens an .xlsx in the engine on its working copy, with no notice', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const opened = await open(p, 'xlsx')
    expect(opened.noticeKey).toBeNull()
    expect(opened.encrypted).toBeUndefined()
    expect(p.device.log).toEqual(
      expect.arrayContaining([
        'mobile_sheets_copy_session_to_temp',
        'mobile_sheets_crypto',
        'engine:open',
        'engine:list_external_links',
      ]),
    )
    const doc = opened.start(host())
    expect(doc.editable).toBeUndefined()
    expect(doc.aiAvailable).toBeUndefined()
    expect(typeof doc.Workspace).toBe('function')
    // The snapshot the save patches from is the working copy.
    expect([...p.device.files.values()]).toContainEqual(plain)
    doc.dispose?.()
    await vi.waitFor(() => expect(p.device.files.size).toBe(0))
  })

  it('tells once that macros are kept but not run, and that external links show saved values', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const macro = await open(p, 'xlsm')
    expect(macro.noticeKey).toBe('sheetsNoticeMacros')
    macro.discard?.()
    p.externalLinks = 2
    const links = await open(p, 'xlsx')
    expect(links.noticeKey).toBe('sheetsNoticeExternalLinks')
    links.discard?.()
    const both = await open(p, 'xlsm')
    expect(both.noticeKey).toBe('sheetsNoticeMacrosAndLinks')
    both.discard?.()
  })

  it('converts a .csv to an .xlsx copy and leaves the original alone', async () => {
    const p = phone()
    const csv = encoder.encode('name,score\nKim,10\n')
    p.device.originals.set(DOC, csv)
    const opened = await open(p, 'csv')
    const doc = opened.start(host())
    expect(p.device.originals.get(DOC)).toEqual(csv)
    const [snapshot] = [...p.device.files.keys()]
    expect(snapshot).toMatch(/\.xlsx$/)
    doc.dispose?.()
  })

  it('makes a new untitled workbook with one Sheet1', async () => {
    const p = phone()
    p.device.originals.set(DOC, new Uint8Array())
    const opened = await open(p, 'xlsx', true)
    const sheets = p.device.engineRequests.filter((request) => request.command === 'open')
    expect(sheets).toHaveLength(1)
    const [path] = [...p.device.files.keys()]
    const { zipEntries } = await import('./helpers/sheetsFakeDevice')
    const workbook = decoder.decode(
      (await zipEntries(p.device.files.get(path!)!)).get('xl/workbook.xml'),
    )
    expect(workbook).toContain('name="Sheet1"')
    opened.discard?.()
  })

  it('shows a progress line while a slow open runs, and removes it after', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const inner = p.client.transport.invoke.bind(p.client.transport)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    ;(p.client.transport as { invoke: MobileTransport['invoke'] }).invoke = async (
      command,
      args,
    ) => {
      if (command === 'mobile_sheets_copy_session_to_temp') await gate
      return inner(command, args)
    }
    const opening = open(p, 'xlsx')
    await new Promise((resolve) => setTimeout(resolve, OPEN_PROGRESS_DELAY_MS + 100))
    const line = document.querySelector('[data-testid="sheets-open-progress"]')
    expect(line?.textContent).toContain('Opening the workbook')
    release()
    const opened = await opening
    expect(document.querySelector('[data-testid="sheets-open-progress"]')).toBeNull()
    opened.discard?.()
  })
})

describe('opening a password-protected workbook', () => {
  it('asks for the password, asks again after a wrong one, and opens the decrypted copy', async () => {
    const p = phone()
    p.device.originals.set(DOC, locked(plain, PASSWORD))
    const opening = open(p, 'xlsx')
    expect(await answerPassword('nope')).toEqual({ retry: false })
    expect(await answerPassword(PASSWORD)).toEqual({ retry: true })
    const opened = await opening

    // Not marked protected: an unlocked workbook stays editable (spec 5.1).
    expect(opened.encrypted).toBeUndefined()
    const doc = opened.start(host())
    expect(doc.editable).not.toBe(false)
    expect(doc.aiAvailable).not.toBe(false)
    // Only the decrypted copy is left in the work folder; the encrypted copy went.
    expect([...p.device.files.values()]).toEqual([plain])
    // No recovery copy for it, ever.
    await doc.writeRecovery?.({} as never)
    expect(recoveryWrites.count).toBe(0)
    expect(p.crypto.map((request) => request.op)).toEqual(['probe', 'decrypt', 'decrypt'])

    doc.dispose?.()
    await vi.waitFor(() => expect(p.device.files.size).toBe(0))
  })

  it('a plain workbook writes its recovery copy (the slot runs)', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const doc = (await open(p, 'xlsx')).start(host())
    await doc.writeRecovery?.({} as never)
    expect(recoveryWrites.count).toBe(1)
    doc.dispose?.()
  })

  it('cancelling the prompt throws USER_CANCELLED and leaves nothing behind', async () => {
    const p = phone()
    p.device.originals.set(DOC, locked(plain, PASSWORD))
    const opening = open(p, 'xlsx')
    const rejected = expect(opening).rejects.toSatisfy(
      (error: unknown) => error instanceof MobileCommandError && error.code === 'USER_CANCELLED',
    )
    await answerPassword(null)
    await rejected
    expect(p.device.files.size).toBe(0)
    expect(p.device.log).not.toContain('engine:open')
    expect(liveSheetsWorkbooks()).toBe(0)
  })

  it('refuses an encryption it cannot open, with the notice, and leaves nothing behind', async () => {
    const p = phone()
    p.device.originals.set(DOC, locked(plain, PASSWORD, 'ODDLOCK'))
    await expect(open(p, 'xlsx')).rejects.toThrow(
      'This kind of password protection cannot be opened.',
    )
    expect(document.querySelector('[data-testid="sheets-password-input"]')).toBeNull()
    expect(p.device.files.size).toBe(0)
  })
})

describe('closing a workbook', () => {
  it('dispose closes the engine session and deletes its files, once', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const doc: EditorDocument = (await open(p, 'xlsx')).start(host())
    expect(p.device.files.size).toBe(1)
    doc.dispose?.()
    doc.dispose?.()
    await vi.waitFor(() => expect(p.device.files.size).toBe(0))
    expect(p.device.log.filter((entry) => entry === 'engine:close')).toHaveLength(1)
    expect(liveSheetsWorkbooks()).toBe(0)
  })

  it('discard (the switch was cancelled) does the same, and leaves the other workbook open', async () => {
    const p = phone()
    p.device.originals.set(DOC, plain)
    const current = (await open(p, 'xlsx')).start(host())
    const next = await open(p, 'xlsx')
    expect(p.device.files.size).toBe(2)
    next.discard?.()
    await vi.waitFor(() => expect(p.device.files.size).toBe(1))
    expect(liveSheetsWorkbooks()).toBe(1)
    current.dispose?.()
    await vi.waitFor(() => expect(p.device.files.size).toBe(0))
  })
})
