// The save area's branches below the screen (spec 2.3–2.5, 6): the phone's
// desktop API and `saveMobileWorkbook` over the stand-in phone — in place,
// Save As (.xls first save), password workbooks locked again, the Rust
// refusals, recovery copies, CSV and ODS copies.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { MobileCommandError } from '@genoffice/mobile-bridge/transport'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import {
  MobileWorkbookSessions,
  createMobileDesktopApi,
  openMobileWorkbook,
} from '../src/renderer/editors/sheets/desktop-api'
import { takeSaveFailure } from '../src/renderer/editors/sheets/desktop-api/save'
import { unlockWorkingCopy } from '../src/renderer/editors/sheets/open/unlock'
import { saveFailureKind, saveFailureMessage } from '../src/renderer/editors/sheets/save/failures'
import { recoveryTitle } from '../src/renderer/editors/sheets/save/names'
import { odsLossCount, parseOdsConversion } from '../src/renderer/editors/sheets/save/odsExport'
import {
  setSheetsSavePrompts,
  type SheetsSavePrompts,
} from '../src/renderer/editors/sheets/save/prompts'
import {
  saveAsSuggestion,
  saveMobileWorkbook,
  takeSavedAsSession,
} from '../src/renderer/editors/sheets/save/saveWorkbook'
import { odsLosses } from '../../sheets/src/main/ods-export'
import { zipEntries } from './helpers/sheetsFakeDevice'
import {
  createSaveDevice,
  lockedBytes,
  unlockBytes,
  type SaveDevice,
} from './helpers/sheetsSaveDevice'
import { emptySaveRequest, valueEdit } from './helpers/sheetsSaveRequest'

const DOC = 'doc-1'
const PASSWORD = 'pw 비밀 1'
const decoder = new TextDecoder()

function docSession(ext: string, name = `ledger.${ext}`): MobileDocSession {
  return {
    sessionId: DOC,
    docKey: 'key-1',
    name,
    ext,
    format: ext as MobileDocSession['format'],
    writable: true,
    ephemeral: false,
  }
}

const asked: string[] = []
function scriptedPrompts(answers: Partial<SheetsSavePrompts> = {}): void {
  setSheetsSavePrompts({
    async chooseFormat() {
      asked.push('format')
      return null
    },
    async askCsvSave() {
      asked.push('csv')
      return 'cancel'
    },
    async askCsvFormulaLoss() {
      asked.push('formula')
      return 'csv'
    },
    async confirmOdsLoss(count) {
      asked.push(`ods:${count}`)
      return true
    },
    ...answers,
  })
}

async function open(device: SaveDevice, ext = 'xlsx', unlock = false) {
  const sessions = new MobileWorkbookSessions()
  const api = createMobileDesktopApi(device.client, sessions, { locale: () => 'ko' })
  const file = await openMobileWorkbook(device.client, sessions, {
    session: docSession(ext),
    locale: 'ko',
    ...(unlock
      ? {
          unlock: (copy) =>
            unlockWorkingCopy(device.client, copy, {
              ask: async () => PASSWORD,
              refusal: (key) => key,
            }),
        }
      : {}),
  })
  return { sessions, api, file }
}

let original: Uint8Array

beforeEach(async () => {
  original = new Uint8Array(await buildEditFixture())
  asked.length = 0
  scriptedPrompts()
})

afterEach(() => setSheetsSavePrompts(null))

describe('saving in place', () => {
  it('reopens the saved workbook with the short-date pattern, at open and after a save', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { api, file } = await open(device)
    await api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
    const opens = device.engineRequests.filter((request) => request.command === 'open')
    expect(opens).toHaveLength(2)
    for (const request of opens) expect(request.shortDateFormat).toMatch(/[ymd]/)
  })

  it('refuses an original another app changed since it was opened, in the phone sentence', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { sessions, api, file } = await open(device)
    device.changedElsewhere.add(DOC)
    const failure = api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
    await expect(failure).rejects.toThrow('다른 이름으로 저장')
    expect(takeSaveFailure(file.sessionId)).toBe('disk-changed')
    expect([...device.originals.get(DOC)!]).toEqual([...original])
    // The session stays, so Save As is still there to use.
    expect(sessions.ids()).toEqual([file.sessionId])
  })

  it('tells a file too large for the bridge, and that the original is unchanged', async () => {
    const device = createSaveDevice({ bridgeLimit: 10 })
    device.originals.set(DOC, original)
    const { api, file } = await open(device)
    const failure = api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
    await expect(failure).rejects.toThrow('원본은 그대로')
    await expect(failure).rejects.toThrow('14MB')
    expect(takeSaveFailure(file.sessionId)).toBe('too-large')
    expect([...device.originals.get(DOC)!]).toEqual([...original])
  })

  it('a manifest the plan did not declare stops the save before the original', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { sessions, file } = await open(device)
    const inner = device.client.transport
    device.client.transport = {
      ...inner,
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        const answer = await inner.invoke<T>(command, args)
        const request =
          command === 'mobile_sheets_request'
            ? (JSON.parse(String(args?.line)) as Record<string, unknown>)
            : null
        if (request?.command !== 'save_archive') return answer
        // The engine changed an entry nobody asked it to.
        const response = answer as { result: { afterEntries: { name: string; crc32: number }[] } }
        for (const entry of response.result.afterEntries) {
          if (entry.name === 'customXml/item1.xml') entry.crc32 += 1
        }
        return answer
      },
    }
    await expect(
      saveMobileWorkbook(
        { client: device.client, sessions, locale: 'ko' },
        valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
      ),
    ).rejects.toThrow()
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC)!]).toEqual([...original])
    expect(sessions.ids()).toEqual([file.sessionId])
  })
})

describe('Save As', () => {
  it('an .xls is saved as name.xlsx; the .xls is never written and the new file is the document', async () => {
    const device = createSaveDevice({ convertedXlsx: original })
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])
    device.originals.set(DOC, legacy)
    const { sessions, api, file } = await open(device, 'xls')
    expect(file.needsSaveAs).toBe(true)
    const result = await api.saveWorkbookEdits({
      ...valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
      mode: 'save-as',
    })
    expect(result.canceled).toBe(false)
    if (result.canceled) return
    expect(device.savedAs.map((entry) => entry.name)).toEqual(['ledger.xlsx'])
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC)!]).toEqual([...legacy])
    const session = takeSavedAsSession(result.file.sessionId)
    expect(session?.name).toBe('ledger.xlsx')
    expect(result.file.needsSaveAs).toBe(false)
    const document = sessions.get(result.file.sessionId).document!
    expect(document).toMatchObject({ sessionId: session!.sessionId, converted: false })
    // The next save goes over the new file.
    await api.saveWorkbookEdits(valueEdit(result.file.sessionId, 'sheet-1', 0, 0, 'Again'))
    const saved = await zipEntries(device.originals.get(session!.sessionId)!)
    expect(decoder.decode(saved.get('xl/worksheets/sheet1.xml'))).toContain('Again')
  })

  it('keeps a macro workbook a macro workbook', () => {
    expect(saveAsSuggestion({ name: 'tools.xlsm' })).toBe('tools.xlsm')
    expect(saveAsSuggestion({ name: 'list.csv' })).toBe('list.xlsx')
    expect(saveAsSuggestion({ name: 'old.xls' })).toBe('old.xlsx')
  })

  it('a closed save dialog is a cancel: nothing written, the session stays', async () => {
    const device = createSaveDevice({ cancelDialog: true })
    device.originals.set(DOC, original)
    const { sessions, api, file } = await open(device)
    await expect(
      api.saveWorkbookEdits({ ...emptySaveRequest(file.sessionId), mode: 'save-as' }),
    ).resolves.toEqual({ canceled: true })
    expect(sessions.ids()).toEqual([file.sessionId])
    expect([...device.files.keys()].filter((name) => name.endsWith('.xlsx'))).toEqual([
      sessions.get(file.sessionId).snapshotPath,
    ])
  })
})

describe('a workbook opened with a password', () => {
  it('is locked again with the same password before it reaches the original', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, lockedBytes(original, PASSWORD))
    const { sessions, api, file } = await open(device, 'xlsx', true)
    expect(sessions.get(file.sessionId).document?.unlocked).toEqual({ password: PASSWORD })
    await api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
    const written = unlockBytes(device.originals.get(DOC)!)
    expect(written?.password).toBe(PASSWORD)
    const sheet = (await zipEntries(written!.plain)).get('xl/worksheets/sheet1.xml')
    expect(decoder.decode(sheet)).toContain('World')
    // The locked temp file went; the plain workbook stays in the work folder only.
    expect([...device.files.values()].filter((bytes) => unlockBytes(bytes) !== null)).toHaveLength(
      0,
    )
  })

  it('an unchanged save writes nothing (the original is already those bytes, locked)', async () => {
    const device = createSaveDevice()
    const locked = lockedBytes(original, PASSWORD)
    device.originals.set(DOC, locked)
    const { api, file } = await open(device, 'xlsx', true)
    await api.saveWorkbookEdits({ ...emptySaveRequest(file.sessionId), restoreWriteBack: true })
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC)!]).toEqual([...locked])
  })

  it('a lock that fails leaves the original and says so', async () => {
    const device = createSaveDevice({ failEncrypt: true })
    const locked = lockedBytes(original, PASSWORD)
    device.originals.set(DOC, locked)
    const { sessions, api, file } = await open(device, 'xlsx', true)
    await expect(
      api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World')),
    ).rejects.toThrow('같은 암호로 다시 잠그지 못해')
    expect(takeSaveFailure(file.sessionId)).toBe('lock-failed')
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC)!]).toEqual([...locked])
    expect(sessions.ids()).toEqual([file.sessionId])
  })

  it('an .xls opened with a password becomes an .xlsx locked with that password', async () => {
    const device = createSaveDevice({ convertedXlsx: original })
    const legacy = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 9])
    device.originals.set(DOC, lockedBytes(legacy, PASSWORD))
    const { api, file } = await open(device, 'xls', true)
    const result = await api.saveWorkbookEdits({
      ...emptySaveRequest(file.sessionId),
      mode: 'save-as',
    })
    expect(result.canceled).toBe(false)
    expect(device.savedAs).toHaveLength(1)
    const opened = unlockBytes(device.savedAs[0]!.bytes)
    expect(opened?.password).toBe(PASSWORD)
    expect(device.savedAs[0]!.name).toBe('ledger.xlsx')
  })

  it('writes no recovery copy and refuses ODS', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, lockedBytes(original, PASSWORD))
    const { api, file } = await open(device, 'xlsx', true)
    await expect(
      api.writeWorkbookRecovery(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World')),
    ).resolves.toEqual({ ok: false })
    expect(device.recoveries).toHaveLength(0)
    await expect(api.exportOds({ sessionId: file.sessionId })).resolves.toEqual({
      canceled: true,
      reason: 'encrypted',
    })
    expect(device.log).not.toContain('engine:convert_to_ods')
  })
})

describe('the recovery copy', () => {
  it('goes through the save writer into Rust and leaves the session and the original', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { sessions, api, file } = await open(device)
    const before = sessions.get(file.sessionId).snapshotPath
    await expect(
      api.writeWorkbookRecovery(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'Draft')),
    ).resolves.toEqual({ ok: true })
    expect(device.recoveries).toHaveLength(1)
    expect(device.recoveries[0]).toMatchObject({ docKey: 'key-1', title: 'ledger.xlsx' })
    const sheet = (await zipEntries(device.recoveries[0]!.bytes)).get('xl/worksheets/sheet1.xml')
    expect(decoder.decode(sheet)).toContain('Draft')
    expect(sessions.ids()).toEqual([file.sessionId])
    expect(sessions.get(file.sessionId).snapshotPath).toBe(before)
    expect([...device.originals.get(DOC)!]).toEqual([...original])
    // The staged copy went.
    expect([...device.files.keys()].filter((name) => name.endsWith('.xlsx'))).toEqual([before])
  })

  it('an .xls or .csv session recovers as an untitled name.xlsx', () => {
    expect(recoveryTitle({ name: 'list.csv', converted: true })).toBe('list.xlsx')
    expect(recoveryTitle({ name: 'old.xls', converted: true })).toBe('old.xlsx')
    expect(recoveryTitle({ name: 'tools.xlsm', converted: false })).toBe('tools.xlsm')
  })
})

describe('copies (CSV, ODS) leave the session as it is', () => {
  it('a CSV copy is UTF-8 with a BOM, after the formula warning', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { sessions, api, file } = await open(device)
    const result = await api.exportCsv({
      fileName: 'ledger.csv',
      content: 'a,b\r\n한,2\r\n',
      hasFormulas: true,
    })
    expect(asked).toEqual(['formula'])
    expect(result).toEqual({ canceled: false, path: 'ledger.csv' })
    const bytes = device.copies[0]!.bytes
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(decoder.decode(bytes.slice(3))).toBe('a,b\r\n한,2\r\n')
    expect(device.copies[0]!.mime).toBe('text/csv')
    expect(sessions.ids()).toEqual([file.sessionId])
    expect([...device.originals.get(DOC)!]).toEqual([...original])
  })

  it('the formula warning can send the person to an Excel Save As instead, or cancel', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { api } = await open(device)
    scriptedPrompts({ askCsvFormulaLoss: async () => 'xlsx' })
    await expect(
      api.exportCsv({ fileName: 'ledger.csv', content: 'x', hasFormulas: true }),
    ).resolves.toEqual({ canceled: true, saveAsXlsxInstead: true })
    scriptedPrompts({ askCsvFormulaLoss: async () => 'cancel' })
    await expect(
      api.exportCsv({ fileName: 'ledger.csv', content: 'x', hasFormulas: true }),
    ).resolves.toEqual({ canceled: true })
    expect(device.copies).toHaveLength(0)
  })

  it('ODS asks only when something is left out, and reopens the result before writing it', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { sessions, api, file } = await open(device)
    const quiet = await api.exportOds({
      sessionId: file.sessionId,
      workbook: valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
    })
    expect(quiet.canceled).toBe(false)
    expect(asked).toEqual([])
    const order = device.log.filter((entry) =>
      ['engine:convert_to_ods', 'engine:convert_workbook', 'mobile_sheets_write_copy'].includes(
        entry,
      ),
    )
    expect(order).toEqual([
      'engine:convert_to_ods',
      'engine:convert_workbook',
      'mobile_sheets_write_copy',
    ])
    expect(device.copies[0]!.name).toBe('ledger.ods')
    // The pending edits went into a private copy, not the session.
    const source = device.engineRequests.find((r) => r.command === 'convert_to_ods')!.path
    expect(source).not.toBe(sessions.get(file.sessionId).snapshotPath)
    expect(sessions.ids()).toEqual([file.sessionId])

    device.options.odsDropped = { charts: 2 }
    device.options.odsFormulasDropped = 3
    scriptedPrompts({
      confirmOdsLoss: async (count) => {
        asked.push(`ods:${count}`)
        return false
      },
    })
    await expect(api.exportOds({ sessionId: file.sessionId })).resolves.toEqual({
      canceled: true,
      reason: 'canceled',
    })
    expect(asked).toEqual(['ods:5'])
    expect(device.copies).toHaveLength(1)
  })

  it('an ODS the engine cannot read back is not written', async () => {
    const device = createSaveDevice({ odsUnreadable: true })
    device.originals.set(DOC, original)
    const { api, file } = await open(device)
    await expect(api.exportOds({ sessionId: file.sessionId })).resolves.toEqual({
      canceled: true,
      reason: 'unreadable',
    })
    expect(device.copies).toHaveLength(0)
    expect([...device.files.keys()].some((name) => name.endsWith('.ods'))).toBe(false)
  })

  it('counts the losses the way the desktop lists them', () => {
    const result = parseOdsConversion({
      sheets: 2,
      formulasDropped: 4,
      dropped: { macros: 1, charts: 2, comments: 3, sparklines: 1 },
    })
    const desktop = odsLosses(result).reduce((sum, loss) => sum + loss.count, 0)
    expect(odsLossCount(result)).toBe(desktop)
    expect(odsLossCount(result)).toBe(11)
  })
})

describe('failure sentences', () => {
  const t = (key: string) => `<${key}>`
  it('the phone translates the failures it adds and passes engine sentences on as they are', () => {
    const disk = new MobileCommandError({
      code: 'INVALID_ARGUMENT',
      messageKey: 'mobile.sheets.diskChanged',
    })
    const large = new MobileCommandError({
      code: 'FILE_TOO_LARGE',
      messageKey: 'mobile.sheets.tooLargeToWrite',
    })
    expect(saveFailureMessage(disk, t)).toBe('<sheetsSaveErrDiskChanged>')
    expect(saveFailureMessage(large, t)).toBe('<sheetsSaveErrTooLarge>')
    const engine = new Error('A new table cannot be saved together with row/column changes.')
    expect(saveFailureKind(engine)).toBe('other')
    // Left for the desktop's SAVE_ERROR_PATTERNS (save-actions.ts) to translate.
    expect(saveFailureMessage(engine, t)).toBe(engine.message)
    expect(saveFailureMessage(new Error(''), t)).toBe('<sheetsSaveFailed>')
  })
})

describe('the desktop table translates engine sentences that pass through', () => {
  // The patterns of save-actions.ts SAVE_ERROR_PATTERNS, read from its source
  // (importing it would load the whole desktop grid stack).
  const source = readFileSync(
    resolve(__dirname, '../../sheets/src/renderer/save-actions.ts'),
    'utf8',
  )
  const table = source.slice(source.indexOf('const SAVE_ERROR_PATTERNS'))
  const patterns = [
    ...table.slice(0, table.indexOf('] as const')).matchAll(/\['([^']+)', 'app/g),
  ].map((match) => match[1]!)

  it('a gateway refusal thrown by the phone API keeps the sentence the table matches', async () => {
    expect(patterns).toContain('The save target is locked by another program')
    const device = createSaveDevice()
    device.originals.set(DOC, original)
    const { api, file } = await open(device)
    const inner = device.client.transport
    device.client.transport = {
      ...inner,
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'mobile_sheets_save_to_original') {
          return Promise.reject(new Error('The save target is locked by another program.'))
        }
        return inner.invoke<T>(command, args)
      },
    }
    const thrown = await api
      .saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
      .catch((error: unknown) => error as Error)
    expect(patterns.some((pattern) => (thrown as Error).message.includes(pattern))).toBe(true)
  })
})
