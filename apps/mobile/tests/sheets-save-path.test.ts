// The phone's save path end to end over a stand-in device: the desktop save
// request → the copied `writeWorkbookTo` → the gateway's
// `saveWorkbookViaSidecar` (running on the Node-module stand-ins) → manifest
// check → engine reopen → write back → session swap.
import { beforeEach, describe, expect, it } from 'vitest'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import {
  MobileWorkbookSessions,
  createMobileDesktopApi,
  openMobileWorkbook,
} from '../src/renderer/editors/sheets/desktop-api'
import { MobileVfs, mobileVfs } from '../src/renderer/editors/sheets/node-shims/vfs'
import {
  SheetsSaveUnreadableError,
  saveMobileWorkbook,
} from '../src/renderer/editors/sheets/save/saveWorkbook'
import { createMobileArchiveClient } from '../src/renderer/editors/sheets/save/archiveClient'
import { tauriWorkFolderBackend } from '../src/renderer/editors/sheets/save/workFolder'
import {
  WORK_ROOT,
  createFakeDevice,
  manifestOf,
  zipEntries,
  type FakeDevice,
} from './helpers/sheetsFakeDevice'
import { emptySaveRequest, valueEdit } from './helpers/sheetsSaveRequest'

const DOC_SESSION = 'doc-1'

function docSession(ext: string, name = `ledger.${ext}`): MobileDocSession {
  return {
    sessionId: DOC_SESSION,
    docKey: 'key-1',
    name,
    ext,
    format: ext as MobileDocSession['format'],
    writable: true,
    ephemeral: false,
  }
}

async function openOn(device: FakeDevice, ext = 'xlsx') {
  const sessions = new MobileWorkbookSessions()
  const file = await openMobileWorkbook(device.client, sessions, {
    session: docSession(ext),
    locale: 'ko',
  })
  return { sessions, file }
}

function snapshotOf(sessions: MobileWorkbookSessions, id: string): string {
  return sessions.get(id).snapshotPath
}

let original: Uint8Array

beforeEach(async () => {
  original = new Uint8Array(await buildEditFixture())
})

describe('the phone save path', () => {
  it('opens with the document name, not the working copy name', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const { file } = await openOn(device)
    expect(file.name).toBe('ledger.xlsx')
  })

  it('an unchanged save writes the original its own bytes and never runs the engine save', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const { sessions, file } = await openOn(device)
    device.log.length = 0
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      emptySaveRequest(file.sessionId),
    )
    expect(outcome.unchanged).toBe(true)
    expect(outcome.wroteOriginal).toBe(true)
    expect(device.log).not.toContain('engine:save_archive')
    expect(device.log).not.toContain('engine:read_entries')
    expect([...device.originals.get(DOC_SESSION)!]).toEqual([...original])
  })

  it('an edit save changes only the entries the plan reported', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const { sessions, file } = await openOn(device)
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    expect(outcome.touchedEntries).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    const saved = device.originals.get(DOC_SESSION)!
    const before = new Map((await manifestOf(original)).map((entry) => [entry.name, entry.crc32]))
    const after = new Map((await manifestOf(saved)).map((entry) => [entry.name, entry.crc32]))
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    const changed = [...after]
      .filter(([name, crc]) => before.get(name) !== crc)
      .map(([name]) => name)
    expect(changed.sort()).toEqual([...outcome.touchedEntries].sort())
    const sheet = new TextDecoder().decode(
      (await zipEntries(saved)).get('xl/worksheets/sheet1.xml'),
    )
    expect(sheet).toContain('<is><t xml:space="preserve">World</t></is>')
    // The session swapped to the saved file: the next save patches it.
    expect(outcome.file.sessionId).not.toBe(file.sessionId)
    expect(snapshotOf(sessions, outcome.file.sessionId)).toBe(outcome.savedPath)
    expect(sessions.has(file.sessionId)).toBe(false)
    expect(outcome.file.name).toBe('ledger.xlsx')
    // The in-memory layer gave everything back.
    expect(mobileVfs.stats().heldBytes).toBe(0)
  })

  it('patches the snapshot made at open, not the document as it is now', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const { sessions, file } = await openOn(device)
    // Another app rewrote the document after it was opened.
    device.originals.set(DOC_SESSION, new Uint8Array([1, 2, 3]))
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    const saved = await zipEntries(device.originals.get(DOC_SESSION)!)
    expect(saved.has('customXml/item1.xml')).toBe(true)
    expect(outcome.touchedEntries).toContain('xl/worksheets/sheet1.xml')
  })

  it('a save the engine cannot reopen leaves the original and the session as they were', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const { sessions, file } = await openOn(device)
    const snapshot = snapshotOf(sessions, file.sessionId)
    device.options = { refuseOpen: (path) => path !== snapshot }
    const failure = saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    await expect(failure).rejects.toBeInstanceOf(SheetsSaveUnreadableError)
    await expect(failure).rejects.toThrow('The workbook could not be read.')
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC_SESSION)!]).toEqual([...original])
    expect(sessions.get(file.sessionId).snapshotPath).toBe(snapshot)
    expect(device.files.has(snapshot)).toBe(true)
    // Only the snapshot is left in the work folder (the staged file went).
    expect([...device.files.keys()].filter((name) => name.endsWith('.xlsx'))).toEqual([snapshot])
    // The kept session still saves once the engine reads the result again.
    device.options = {}
    await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 0, 0, 'Again'),
    )
    const sheet = new TextDecoder().decode(
      (await zipEntries(device.originals.get(DOC_SESSION)!)).get('xl/worksheets/sheet1.xml'),
    )
    expect(sheet).toContain('Again')
  })

  it('a failed write back keeps the session and closes the reopened one', async () => {
    const device = createFakeDevice({ failWriteBack: true })
    device.originals.set(DOC_SESSION, original)
    const { sessions, file } = await openOn(device)
    await expect(
      saveMobileWorkbook(
        { client: device.client, sessions, locale: 'ko' },
        valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(sessions.ids()).toEqual([file.sessionId])
    expect([...device.originals.get(DOC_SESSION)!]).toEqual([...original])
    const opens = device.engineRequests.filter((request) => request.command === 'open')
    const closes = device.engineRequests.filter((request) => request.command === 'close')
    expect(closes).toHaveLength(1)
    expect(closes[0]?.sessionId).not.toBe(file.sessionId)
    expect(opens).toHaveLength(2)
  })

  it('a converted .csv session saves to a verified temp .xlsx and leaves the .csv alone', async () => {
    const device = createFakeDevice()
    const csv = new TextEncoder().encode('name,score\nKim,10\nLee,20\n')
    device.originals.set(DOC_SESSION, csv)
    const { sessions, file } = await openOn(device, 'csv')
    expect(file.needsSaveAs).toBe(true)
    expect(file.name).toBe('ledger.csv')
    const first = await zipEntries(device.files.get(snapshotOf(sessions, file.sessionId))!)
    expect(new TextDecoder().decode(first.get('xl/worksheets/sheet1.xml'))).toContain('Kim')
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 1, 1, '99'),
    )
    expect(outcome.wroteOriginal).toBe(false)
    expect(device.log).not.toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC_SESSION)!]).toEqual([...csv])
    expect(outcome.savedPath.endsWith('.xlsx')).toBe(true)
    const saved = await zipEntries(device.files.get(outcome.savedPath)!)
    expect(new TextDecoder().decode(saved.get('xl/worksheets/sheet1.xml'))).toContain('99')
    expect(outcome.file.needsSaveAs).toBe(true)
  })

  it('a converted .xls session (engine conversion) saves to a temp .xlsx too', async () => {
    const device = createFakeDevice({ convertedXlsx: original })
    // An OLE2 header, not an HTML page: the desktop conversion hands it to the engine.
    device.originals.set(
      DOC_SESSION,
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    )
    const { sessions, file } = await openOn(device, 'xls')
    expect(device.engineRequests.map((request) => request.command)).toEqual([
      'convert_workbook',
      'open',
    ])
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions, locale: 'ko' },
      valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    expect(outcome.wroteOriginal).toBe(false)
    expect(device.originals.get(DOC_SESSION)!.byteLength).toBe(8)
  })

  it('an .xls that is an HTML table is imported through the gateway, as on the desktop', async () => {
    const device = createFakeDevice()
    const html =
      '<html><body><table><tr><td>Region</td><td>Total</td></tr><tr><td>Seoul</td><td>12</td></tr></table></body></html>'
    device.originals.set(DOC_SESSION, new TextEncoder().encode(html))
    const { sessions, file } = await openOn(device, 'xls')
    expect(device.engineRequests.map((request) => request.command)).toEqual(['open'])
    const sheet = (await zipEntries(device.files.get(snapshotOf(sessions, file.sessionId))!)).get(
      'xl/worksheets/sheet1.xml',
    )
    expect(new TextDecoder().decode(sheet)).toContain('Seoul')
  })

  it('the save request through the desktop API keeps the desktop result shape', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const sessions = new MobileWorkbookSessions()
    const api = createMobileDesktopApi(device.client, sessions, { locale: () => 'ko' })
    const file = await openMobileWorkbook(device.client, sessions, {
      session: docSession('xlsx'),
      locale: 'ko',
    })
    const result = await api.saveWorkbookEdits(valueEdit(file.sessionId, 'sheet-1', 0, 0, 'World'))
    expect(result.canceled).toBe(false)
    if (result.canceled) return
    expect(result.touchedEntries).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    expect(result.file.name).toBe('ledger.xlsx')
    // A Save As whose system dialog is closed answers like a dismissed desktop dialog.
    const inner = device.client.transport
    device.client.transport = {
      ...inner,
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        return command === 'mobile_sheets_save_as'
          ? Promise.reject({ code: 'USER_CANCELLED', messageKey: 'mobile.fs.cancelled' })
          : inner.invoke<T>(command, args)
      },
    }
    await expect(
      api.saveWorkbookEdits({ ...emptySaveRequest(result.file.sessionId), mode: 'save-as' }),
    ).resolves.toEqual({ canceled: true })
    // The engine got no field the desktop back end does not send.
    const saveArchive = device.engineRequests.find((request) => request.command === 'save_archive')
    expect(Object.keys(saveArchive!).sort()).toEqual(
      [
        'additions',
        'command',
        'removals',
        'replacements',
        'requestId',
        'sourcePath',
        'targetPath',
        'version',
      ].sort(),
    )
  })

  it('large edit sets arrive through the desktop transfer store', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const sessions = new MobileWorkbookSessions()
    const api = createMobileDesktopApi(device.client, sessions, { locale: () => 'ko' })
    const file = await openMobileWorkbook(device.client, sessions, {
      session: docSession('xlsx'),
      locale: 'ko',
    })
    const transferId = '99999999-2222-4333-8444-555555555555'
    const edits = valueEdit(file.sessionId, 'sheet-1', 0, 0, 'Chunked').edits
    await api.beginSaveEditsTransfer({ sessionId: file.sessionId, transferId, total: 1 })
    await api.sendSaveEditsChunk({
      sessionId: file.sessionId,
      transferId,
      seq: 0,
      editsJson: JSON.stringify(edits),
    })
    const result = await api.saveWorkbookEdits({
      ...emptySaveRequest(file.sessionId),
      editsTransferId: transferId,
    })
    expect(result.canceled).toBe(false)
    const sheet = new TextDecoder().decode(
      (await zipEntries(device.originals.get(DOC_SESSION)!)).get('xl/worksheets/sheet1.xml'),
    )
    expect(sheet).toContain('Chunked')
  })
})

describe('the archive client over the in-memory layer', () => {
  it('fetches extracted entries before the gateway reads them and hands written contents over before save_archive', async () => {
    const device = createFakeDevice()
    const vfs = new MobileVfs()
    vfs.configure(tauriWorkFolderBackend(device.client), WORK_ROOT)
    const archive = createMobileArchiveClient(device.client, vfs)
    const source = `${WORK_ROOT}/f-src.xlsx`
    device.files.set(source, original)
    await archive.readEntries({
      path: source,
      entries: ['xl/worksheets/sheet1.xml'],
      outputDir: `${WORK_ROOT}/x/extract-0`,
    })
    const extracted = `${WORK_ROOT}/x/extract-0/entry-0.bin`
    expect(vfs.has(extracted)).toBe(true)
    expect(new TextDecoder().decode(vfs.readFileSync(extracted))).toContain('<worksheet')
    // Read once: the gateway caches the text, the layer lets the bytes go.
    expect(vfs.has(extracted)).toBe(false)

    const content = `${WORK_ROOT}/x/replace-0.bin`
    vfs.writeFileSync(content, new TextEncoder().encode('<worksheet/>'), true)
    expect(device.files.has(content)).toBe(false)
    device.log.length = 0
    await archive.saveArchive({
      sourcePath: source,
      targetPath: `${WORK_ROOT}/f-out.xlsx`,
      replacements: [{ name: 'xl/worksheets/sheet1.xml', contentPath: content }],
      removals: [],
      additions: [],
    })
    expect(device.log.indexOf('mobile_sheets_temp_write_text')).toBeLessThan(
      device.log.indexOf('engine:save_archive'),
    )
    expect(new TextDecoder().decode(device.files.get(content))).toBe('<worksheet/>')
    expect(vfs.has(content)).toBe(false)
  })
})

describe('an unchanged save through the desktop API', () => {
  it('is the restore write-back the desktop sends, and gives the original its own bytes', async () => {
    const device = createFakeDevice()
    device.originals.set(DOC_SESSION, original)
    const sessions = new MobileWorkbookSessions()
    const api = createMobileDesktopApi(device.client, sessions, { locale: () => 'ko' })
    const file = await openMobileWorkbook(device.client, sessions, {
      session: docSession('xlsx'),
      locale: 'ko',
    })
    // The shared schema refuses an empty plain Save, as on the desktop.
    await expect(api.saveWorkbookEdits(emptySaveRequest(file.sessionId))).rejects.toThrow(
      'A save needs at least one edit.',
    )
    device.log.length = 0
    const result = await api.saveWorkbookEdits({
      ...emptySaveRequest(file.sessionId),
      restoreWriteBack: true,
    })
    expect(result.canceled).toBe(false)
    expect(device.log).not.toContain('engine:save_archive')
    expect(device.log).toContain('mobile_sheets_save_to_original')
    expect([...device.originals.get(DOC_SESSION)!]).toEqual([...original])
  })
})
