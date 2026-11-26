// Closing a workbook after it was saved: each save swaps the engine session
// for one on the saved file, so the document must close the session it uses
// now, not the one it opened with. Otherwise the engine session, its working
// copy (the plain workbook of one opened with a password), the engine's cache
// and the password stay for the rest of the app run, and the work folder is
// never emptied again (spec 2.1, 5.2).
import { describe, expect, it, vi } from 'vitest'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { buildEditFixture } from '../../sheets/tests/fixture-builder'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { unlockWorkingCopy } from '../src/renderer/editors/sheets/open/unlock'
import { saveMobileWorkbook } from '../src/renderer/editors/sheets/save/saveWorkbook'
import {
  liveSheetsWorkbooks,
  openSheetsWorkbook,
  sheetsSessions,
} from '../src/renderer/editors/sheets/session'
import { startSheetsDocument } from '../src/renderer/editors/sheets/workspace/document'
import { createSaveDevice, lockedBytes, type SaveDevice } from './helpers/sheetsSaveDevice'
import { valueEdit } from './helpers/sheetsSaveRequest'

const DOC = 'doc-1'
const PASSWORD = 'pw 1'
const HEAVY = { timeout: 60_000 }

function docSession(): MobileDocSession {
  return {
    sessionId: DOC,
    docKey: 'key-1',
    name: 'ledger.xlsx',
    ext: 'xlsx',
    format: 'xlsx',
    writable: true,
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

async function openOn(device: SaveDevice, unlock = false) {
  return openSheetsWorkbook({
    client: device.client as unknown as MobileClient,
    session: docSession(),
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
}

function closedSessions(device: SaveDevice): unknown[] {
  return device.engineRequests
    .filter((request) => request.command === 'close')
    .map((request) => request.sessionId)
}

describe('closing a workbook after a save', HEAVY, () => {
  it('closes the session the save swapped in, empties the work folder, and clears it again next time', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, new Uint8Array(await buildEditFixture()))
    const opened = await openOn(device)
    const doc = startSheetsDocument(host(), opened)
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions: sheetsSessions, locale: 'en' },
      valueEdit(opened.file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    expect(outcome.file.sessionId).not.toBe(opened.file.sessionId)
    expect(sheetsSessions.ids()).toEqual([outcome.file.sessionId])

    device.engineRequests.length = 0
    doc.dispose?.()
    await vi.waitFor(() => expect(device.files.size).toBe(0))
    expect(closedSessions(device)).toContain(outcome.file.sessionId)
    expect(sheetsSessions.ids()).toEqual([])
    expect(liveSheetsWorkbooks()).toBe(0)

    // Nothing is open any more: the next open empties the work folder first.
    device.log.length = 0
    const again = await openOn(device)
    expect(device.log).toContain('mobile_sheets_temp_clear')
    await again.close()
    expect(device.files.size).toBe(0)
  })

  it('a workbook opened with a password: the plain copy and the password go too', async () => {
    const device = createSaveDevice()
    const plain = new Uint8Array(await buildEditFixture())
    device.originals.set(DOC, lockedBytes(plain, PASSWORD))
    const opened = await openOn(device, true)
    expect(opened.unlocked).toBe(true)
    const doc = startSheetsDocument(host(), opened)
    const outcome = await saveMobileWorkbook(
      { client: device.client, sessions: sheetsSessions, locale: 'en' },
      valueEdit(opened.file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    const current = sheetsSessions.get(outcome.file.sessionId).document!
    expect(current.unlocked?.password).toBe(PASSWORD)

    doc.dispose?.()
    await vi.waitFor(() => expect(device.files.size).toBe(0))
    expect(closedSessions(device)).toContain(outcome.file.sessionId)
    expect(sheetsSessions.ids()).toEqual([])
    expect(current.unlocked?.password).toBe('')
    expect(opened.document.unlocked?.password).toBe('')
  })

  it('a close while a save is writing closes the session that save swaps in', async () => {
    const device = createSaveDevice()
    device.originals.set(DOC, new Uint8Array(await buildEditFixture()))
    const opened = await openOn(device)
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = device.client.transport
    let writing = () => {}
    const reachedWrite = new Promise<void>((resolve) => {
      writing = resolve
    })
    device.client.transport = {
      ...inner,
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'mobile_sheets_save_to_original') {
          writing()
          await gate
        }
        return inner.invoke<T>(command, args)
      },
    }
    const saving = saveMobileWorkbook(
      { client: device.client, sessions: sheetsSessions, locale: 'en' },
      valueEdit(opened.file.sessionId, 'sheet-1', 0, 0, 'World'),
    )
    await reachedWrite
    const closing = opened.close()
    release()
    const outcome = await saving
    await closing
    await vi.waitFor(() => expect(device.files.size).toBe(0))
    expect(closedSessions(device)).toContain(outcome.file.sessionId)
    expect(sheetsSessions.ids()).toEqual([])
  })
})
