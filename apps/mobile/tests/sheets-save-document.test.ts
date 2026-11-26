// The spreadsheet document's save, Save As, share and recovery copy
// (save/documentSlot.ts) over the stand-in phone. The desktop renderer's
// flows are stood in by scripts that call the phone's desktop API the way
// they do (save-actions.ts `handleSave`, csv-export.ts, ods-export.ts); the
// API, the save path and the Rust stand-ins are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import type { WorkbookFile } from '../../sheets/src/shared/desktop-api'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  createMobileDesktopApi,
  openMobileWorkbook,
} from '../src/renderer/editors/sheets/desktop-api'
import type { MobileGrid } from '../src/renderer/editors/sheets/grid/mobileGrid'
import { unlockWorkingCopy } from '../src/renderer/editors/sheets/open/unlock'
import {
  createSheetsSaveActions,
  isCsvDocument,
  saveGoesToSaveAs,
  type SheetsSaveModules,
} from '../src/renderer/editors/sheets/save/documentSlot'
import {
  outputFormatChoices,
  setSheetsSavePrompts,
  type SheetsOutputFormat,
  type SheetsSavePrompts,
} from '../src/renderer/editors/sheets/save/prompts'
import { sheetsSessions, type OpenedSheetsWorkbook } from '../src/renderer/editors/sheets/session'
import { zipEntries } from './helpers/sheetsFakeDevice'
import {
  createSaveDevice,
  lockedBytes,
  unlockBytes,
  type SaveDevice,
} from './helpers/sheetsSaveDevice'
import { emptySaveRequest, valueEdit } from './helpers/sheetsSaveRequest'

const DOC = 'doc-1'
const PASSWORD = 'pw 1'
const NO_EDITS = 'No edits to save'
const decoder = new TextDecoder()

function docSession(ext: string, over: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: DOC,
    docKey: 'key-1',
    name: `ledger.${ext}`,
    ext,
    format: ext as MobileDocSession['format'],
    writable: true,
    ephemeral: false,
    ...over,
  }
}

interface Harness {
  readonly device: SaveDevice
  readonly host: EditorHost & {
    toasts: string[]
    errors: string[]
    notices: (string | null)[]
    sessions: MobileDocSession[]
    dirty: boolean[]
  }
  readonly grid: MobileGrid
  readonly actions: ReturnType<typeof createSheetsSaveActions>
  /** Whether the script's journal holds an edit (cleared by a save, like the desktop reopen). */
  pending: boolean
  readonly doc: () => ActiveDocState
  /** Holds the next desktop save until released (a save in flight). */
  hold: { promise: Promise<void>; release: () => void } | null
  readonly calls: string[]
}

let answers: { format: SheetsOutputFormat | null; csv: 'csv' | 'xlsx' | 'cancel' }
const asked: string[] = []

beforeEach(() => {
  answers = { format: null, csv: 'cancel' }
  asked.length = 0
  const prompts: SheetsSavePrompts = {
    async chooseFormat(input) {
      asked.push(`format:${input.purpose}`)
      return answers.format
    },
    async askCsvSave() {
      asked.push('csv')
      return answers.csv
    },
    async askCsvFormulaLoss() {
      asked.push('formula')
      return 'csv'
    },
    async confirmOdsLoss() {
      return true
    },
  }
  setSheetsSavePrompts(prompts)
})

afterEach(() => {
  setSheetsSavePrompts(null)
  for (const id of sheetsSessions.ids()) sheetsSessions.delete(id)
})

async function harness(
  ext: string,
  bytes: Uint8Array,
  options: { session?: Partial<MobileDocSession>; unlock?: boolean; untitled?: boolean } = {},
  device = createSaveDevice({ convertedXlsx: bytes }),
): Promise<Harness> {
  const session = docSession(ext, options.session)
  device.originals.set(DOC, bytes)
  const api = createMobileDesktopApi(device.client, sheetsSessions, { locale: () => 'ko' })
  const file = await openMobileWorkbook(device.client, sheetsSessions, {
    session,
    locale: 'ko',
    ...(options.unlock
      ? {
          unlock: (copy) =>
            unlockWorkingCopy(device.client, copy, {
              ask: async () => PASSWORD,
              refusal: (key) => key,
            }),
        }
      : {}),
  })
  const document = sheetsSessions.get(file.sessionId).document!
  const opened: OpenedSheetsWorkbook = {
    file,
    document,
    unlocked: document.unlocked !== undefined,
    close: async () => undefined,
  }
  const lazyWorkbookRef = {
    current: { file, flags: { preloadComplete: true } } as never as {
      file: WorkbookFile
      flags: { preloadComplete: boolean }
    },
  }
  const grid = {
    runtime: {},
    lazyWorkbookRef,
    async load(next: WorkbookFile) {
      lazyWorkbookRef.current = { ...lazyWorkbookRef.current, file: next }
    },
  } as unknown as MobileGrid
  const host = {
    toasts: [] as string[],
    errors: [] as string[],
    notices: [] as (string | null)[],
    sessions: [] as MobileDocSession[],
    dirty: [] as boolean[],
    client: {
      get transport() {
        return device.client.transport
      },
      shareFile: vi.fn(async () => undefined),
    } as unknown as MobileClient,
    markDirty(dirty: boolean) {
      host.dirty.push(dirty)
    },
    updateSession(meta: { session: MobileDocSession }) {
      host.sessions.push(meta.session)
      current.session = meta.session
      current.isUntitled = false
    },
    setNotice(text: string | null) {
      host.notices.push(text)
    },
    showToast(input: string | { message: string; tone?: string }) {
      if (typeof input === 'string') host.toasts.push(input)
      else if (input.tone === 'error') host.errors.push(input.message)
      else host.toasts.push(input.message)
    },
    contentChanged() {},
    refreshHome: async () => undefined,
    openSession: async () => undefined,
    translate: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}${JSON.stringify(params)}` : key,
    windowClass: () => 'compact',
  } as unknown as Harness['host']
  const current = {
    session,
    dirty: true,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: options.untitled ?? false,
  }
  const state: Harness = {
    device,
    host,
    grid,
    pending: true,
    doc: () => ({ ...current }),
    hold: null,
    calls: [],
    actions: undefined as never,
  }
  const requestFor = () => {
    const id = grid.lazyWorkbookRef.current!.file.sessionId
    return state.pending ? valueEdit(id, 'sheet-1', 0, 0, 'World') : emptySaveRequest(id)
  }
  const modules: SheetsSaveModules = {
    async handleSave(ctx, mode) {
      state.calls.push(mode)
      const request = requestFor()
      if (mode === 'ods') return { ok: true, request }
      if (mode === 'recovery') return { ok: (await api.writeWorkbookRecovery(request)).ok }
      if (mode === 'save' && !state.pending) {
        ctx.setMessage(NO_EDITS)
        return { ok: false }
      }
      if (state.hold) await state.hold.promise
      try {
        const result = await api.saveWorkbookEdits({ ...request, mode })
        if (result.canceled) return { ok: false }
        await ctx.openLazyWorkbook(result.file)
        state.pending = false
        ctx.setMessage('Saved')
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.setMessage(message)
        return { ok: false, error: message }
      }
    },
    async handleExportCsv(ctx) {
      const result = await api.exportCsv({
        fileName: 'ledger.csv',
        content: 'a,b\r\n1,2\r\n',
        hasFormulas: false,
      })
      if (result.canceled) {
        if (result.saveAsXlsxInstead) ctx.requestSaveAs()
        else ctx.setMessage('CSV canceled')
        return
      }
      ctx.setMessage(`Exported ${result.path}`)
    },
    async handleExportOds(ctx) {
      const result = await api.exportOds({
        sessionId: grid.lazyWorkbookRef.current!.file.sessionId,
        workbook: (await ctx.pendingEdits())!,
      })
      ctx.setMessage(result.canceled ? 'ODS canceled' : `ODS ${result.path}`)
      return !result.canceled
    },
    activeSheetCsv: async () => 'name,score\r\nKim,10\r\n',
    activeSheetPdf: async () => ({
      bytes: new TextEncoder().encode('%PDF-1.7 page'),
      fileName: 'ledger.pdf',
      skippedVisuals: 2,
      missingGlyphs: 0,
    }),
    pcText: async (key) =>
      ({
        appNoEditsToSave: NO_EDITS,
        appCsvExportCanceled: 'CSV canceled',
        appOdsExportCanceled: 'ODS canceled',
        appCsvExportNeedsFullLoad: 'full load',
        appCsvExportTooLarge: 'too large',
      })[key],
  }
  Object.assign(state, {
    actions: createSheetsSaveActions({ host, opened, grid: { grid, handle: null } }, modules),
  })
  return state
}

let original: Uint8Array
beforeEach(async () => {
  original = new Uint8Array(await buildEditFixture())
})

describe('where a save goes', () => {
  it('a writable .xlsx saves over the original', async () => {
    const h = await harness('xlsx', original)
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    const sheet = (await zipEntries(h.device.originals.get(DOC)!)).get('xl/worksheets/sheet1.xml')
    expect(decoder.decode(sheet)).toContain('World')
    expect(h.host.dirty).toEqual([false])
    expect(h.host.toasts).toEqual(['savedNotice'])
  })

  it('an unchanged workbook: nothing to save is a clean document, the original as it was', async () => {
    const h = await harness('xlsx', original)
    h.pending = false
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    expect([...h.device.originals.get(DOC)!]).toEqual([...original])
    expect(h.host.dirty).toEqual([false])
  })

  it('the first save of an .xls is a Save As named name.xlsx; the .xls stays', async () => {
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 7])
    const device = createSaveDevice({ convertedXlsx: original })
    const h = await harness('xls', legacy, {}, device)
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    expect(h.calls).toEqual(['save-as'])
    expect(device.savedAs.map((entry) => entry.name)).toEqual(['ledger.xlsx'])
    expect([...device.originals.get(DOC)!]).toEqual([...legacy])
    expect(h.host.sessions.map((session) => session.name)).toEqual(['ledger.xlsx'])
    // The saved .xlsx is the document now: the next save goes over it.
    h.pending = true
    await h.actions.save!(h.doc(), false)
    expect(h.calls).toEqual(['save-as', 'save'])
  })

  it('a read-only copy, or an untitled (restored) workbook, saves as a new file', async () => {
    const readOnly = await harness('xlsx', original, { session: { writable: false } })
    await readOnly.actions.save!(readOnly.doc(), false)
    expect(readOnly.calls).toEqual(['save-as'])
    expect(
      saveGoesToSaveAs(
        { isUntitled: true, session: { writable: true, ephemeral: false } },
        {
          converted: false,
        },
      ),
    ).toBe(true)
  })

  it('a refusal to write in place turns into Save As', async () => {
    const device = createSaveDevice()
    const h = await harness('xlsx', original, {}, device)
    const inner = device.client.transport
    device.client.transport = {
      ...inner,
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'mobile_sheets_save_to_original') {
          return Promise.reject({ code: 'READ_ONLY_URI', messageKey: 'mobile.fs.readOnly' })
        }
        return inner.invoke<T>(command, args)
      },
    }
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    expect(h.calls).toEqual(['save', 'save-as'])
    expect(h.host.errors).toEqual([])
  })

  it('a refused save shows why and keeps the document unsaved', async () => {
    const h = await harness('xlsx', original)
    h.device.changedElsewhere.add(DOC)
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(false)
    expect(h.host.errors[0]).toContain('다른 이름으로 저장')
    expect(h.host.dirty).toEqual([])
    expect([...h.device.originals.get(DOC)!]).toEqual([...original])
  })
})

describe('a .csv document asks every time', () => {
  const csv = new TextEncoder().encode('name,score\nKim,10\n')

  it('cancel: nothing is written', async () => {
    const h = await harness('csv', csv)
    expect(
      isCsvDocument(sheetsSessions.get(h.grid.lazyWorkbookRef.current!.file.sessionId).document!),
    ).toBe(true)
    answers.csv = 'cancel'
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(false)
    expect(asked).toEqual(['csv'])
    expect([...h.device.originals.get(DOC)!]).toEqual([...csv])
    expect(h.calls).toEqual([])
  })

  it('CSV: the current sheet goes over the original (BOM, desktop rules), the edits into the session', async () => {
    const h = await harness('csv', csv)
    answers.csv = 'csv'
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    const written = h.device.originals.get(DOC)!
    expect([...written.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(decoder.decode(written.slice(3))).toBe('name,score\r\nKim,10\r\n')
    expect(h.calls).toEqual(['save'])
    expect(h.host.dirty).toEqual([false])
    // And again next time.
    h.pending = true
    await h.actions.save!(h.doc(), false)
    expect(asked).toEqual(['csv', 'csv'])
  })

  it('Excel: Save As name.xlsx, which becomes the document (no more CSV question)', async () => {
    const h = await harness('csv', csv)
    answers.csv = 'xlsx'
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(true)
    expect(h.device.savedAs.map((entry) => entry.name)).toEqual(['ledger.xlsx'])
    expect([...h.device.originals.get(DOC)!]).toEqual([...csv])
    h.pending = true
    await h.actions.save!(h.doc(), false)
    expect(asked).toEqual(['csv'])
    expect(h.calls).toEqual(['save-as', 'save'])
  })
})

describe('Save As and share offer the desktop formats', () => {
  const t = (key: string) => key
  it('the workbook first, then CSV, ODS and PDF; a macro workbook offers .xlsm and no CSV', () => {
    expect(outputFormatChoices({ macro: false, unlocked: false, t }).map((c) => c.id)).toEqual([
      'workbook',
      'csv',
      'ods',
      'pdf',
    ])
    const macro = outputFormatChoices({ macro: true, unlocked: false, t })
    expect(macro.map((c) => c.id)).toEqual(['workbook', 'ods', 'pdf'])
    expect(macro[0]!.label).toBe('sheetsFormatWorkbookMacro')
    const locked = outputFormatChoices({ macro: false, unlocked: true, t })
    expect(locked.find((c) => c.id === 'ods')).toMatchObject({
      disabled: true,
      detail: 'sheetsOdsEncrypted',
    })
  })

  it('a PDF copy leaves the session, its unsaved edits and the original, and tells once what it left out', async () => {
    const h = await harness('xlsx', original)
    const sessionBefore = h.grid.lazyWorkbookRef.current!.file.sessionId
    answers.format = 'pdf'
    await expect(h.actions.save!(h.doc(), true)).resolves.toBe(false)
    expect(h.device.copies).toEqual([
      expect.objectContaining({ name: 'ledger.pdf', mime: 'application/pdf' }),
    ])
    expect(decoder.decode(h.device.copies[0]!.bytes)).toBe('%PDF-1.7 page')
    expect(h.host.notices).toEqual(['sheetsPdfSkippedVisuals{"count":2}'])
    expect(h.grid.lazyWorkbookRef.current!.file.sessionId).toBe(sessionBefore)
    expect(h.host.dirty).toEqual([])
    expect([...h.device.originals.get(DOC)!]).toEqual([...original])
    expect([...h.device.files.keys()].some((name) => name.endsWith('.pdf'))).toBe(false)
  })

  it('a CSV copy and an ODS copy leave the session as it is', async () => {
    const h = await harness('xlsx', original)
    const before = h.grid.lazyWorkbookRef.current!.file.sessionId
    answers.format = 'csv'
    await h.actions.save!(h.doc(), true)
    answers.format = 'ods'
    await h.actions.save!(h.doc(), true)
    expect(h.device.copies.map((copy) => copy.name)).toEqual(['ledger.csv', 'ledger.ods'])
    expect(h.grid.lazyWorkbookRef.current!.file.sessionId).toBe(before)
    expect(sheetsSessions.ids()).toEqual([before])
    expect(h.host.toasts).toEqual(['Exported ledger.csv', 'ODS ledger.ods'])
  })

  it('Save As › workbook is the regular Save As', async () => {
    const h = await harness('xlsx', original)
    answers.format = 'workbook'
    await expect(h.actions.save!(h.doc(), true)).resolves.toBe(true)
    expect(h.device.savedAs.map((entry) => entry.name)).toEqual(['ledger.xlsx'])
  })

  it('ODS of a workbook opened with a password is refused', async () => {
    const h = await harness('xlsx', lockedBytes(original, PASSWORD), { unlock: true })
    answers.format = 'ods'
    await h.actions.save!(h.doc(), true)
    expect(h.host.errors).toEqual(['sheetsOdsEncrypted'])
    expect(h.device.copies).toHaveLength(0)
  })
})

describe('share', () => {
  it('an untouched workbook shares its original file', async () => {
    const h = await harness('xlsx', original)
    answers.format = 'workbook'
    await h.actions.share({ ...h.doc(), dirty: false })
    expect(h.host.client.shareFile).toHaveBeenCalledWith({
      sessionId: DOC,
      suggestedName: 'ledger.xlsx',
      mode: 'original',
    })
  })

  it('an edited workbook opened with a password shares the edits, locked again', async () => {
    const h = await harness('xlsx', lockedBytes(original, PASSWORD), { unlock: true })
    answers.format = 'workbook'
    await h.actions.share(h.doc())
    expect(h.device.shared).toHaveLength(1)
    const opened = unlockBytes(h.device.shared[0]!.bytes)
    expect(opened?.password).toBe(PASSWORD)
    const sheet = (await zipEntries(opened!.plain)).get('xl/worksheets/sheet1.xml')
    expect(decoder.decode(sheet)).toContain('World')
    // Nothing was saved: the session and the original stay.
    expect(unlockBytes(h.device.originals.get(DOC)!)?.plain).toEqual(original)
    expect([...h.device.files.values()].some((bytes) => unlockBytes(bytes) !== null)).toBe(false)
  })

  it('a PDF share goes to the share sheet', async () => {
    const h = await harness('xlsx', original)
    answers.format = 'pdf'
    await h.actions.share(h.doc())
    expect(h.device.shared.map((entry) => entry.name)).toEqual(['ledger.pdf'])
  })

  it('a share too large for the bridge says so', async () => {
    const device = createSaveDevice({ bridgeLimit: 5 })
    const h = await harness('xlsx', original, {}, device)
    answers.format = 'csv'
    await h.actions.share(h.doc())
    expect(h.host.errors).toEqual(['sheetsSaveErrTooLarge'])
  })
})

describe('the recovery copy', () => {
  it('is written by the timer through the save writer', async () => {
    const h = await harness('xlsx', original)
    await h.actions.writeRecovery!(h.doc())
    expect(h.calls).toEqual(['recovery'])
    expect(h.device.recoveries).toHaveLength(1)
  })

  it('an .xls session recovers as name.xlsx', async () => {
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 7])
    const h = await harness('xls', legacy, {}, createSaveDevice({ convertedXlsx: original }))
    await h.actions.writeRecovery!(h.doc())
    expect(h.device.recoveries[0]?.title).toBe('ledger.xlsx')
  })

  it('none for a workbook opened with a password', async () => {
    const h = await harness('xlsx', lockedBytes(original, PASSWORD), { unlock: true })
    await h.actions.writeRecovery!(h.doc())
    expect(h.calls).toEqual([])
    expect(h.device.recoveries).toHaveLength(0)
  })

  it('going to the background during a save writes no recovery copy and no half state', async () => {
    const h = await harness('xlsx', original)
    let release = () => {}
    h.hold = {
      promise: new Promise<void>((resolve) => {
        release = resolve
      }),
      release: () => release(),
    }
    const saving = h.actions.save!(h.doc(), false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The app hides: its timer asks for a recovery copy while the save runs.
    await h.actions.writeRecovery!(h.doc())
    expect(h.device.recoveries).toHaveLength(0)
    // The original is untouched until the verified write.
    expect([...h.device.originals.get(DOC)!]).toEqual([...original])
    // A second save while the first runs is refused, not interleaved.
    await expect(h.actions.save!(h.doc(), false)).resolves.toBe(false)
    expect(h.host.errors).toEqual(['sheetsSaveBusy'])
    h.hold.release()
    await expect(saving).resolves.toBe(true)
    expect(h.calls).toEqual(['save'])
  })
})
