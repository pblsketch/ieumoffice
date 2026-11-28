import { describe, expect, it } from 'vitest'
import {
  MobileCommandError,
  createMobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '../src/transport'
import {
  createMobileHwpApi,
  createMobileHwpSkill,
  mobileHwpStudioUrl,
  seedMobileHwpStudioSettings,
  type MobileHwpEditorPort,
} from '../src/hwp'
import type { DocumentMode } from '../src/view-edit-gate'

function makeHwpSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'hwp-sess-1',
    docKey: 'fedcba9876543210',
    name: 'report.hwp',
    ext: 'hwp',
    format: 'hwp',
    writable: true,
    ephemeral: false,
    uriHint: 'content://docs/report.hwp',
    ...overrides,
  }
}

describe('mobile HWP studio boot config (Canvas2D forced, embed chrome)', () => {
  it('forces Canvas2D renderer, disables studio recovery autosave, and uses chrome=embed URL', () => {
    const seeded = JSON.parse(seedMobileHwpStudioSettings(null, 'dark')) as Record<string, unknown>
    expect(seeded.renderer).toBe('canvas2d')
    expect((seeded.rendering as Record<string, unknown>)?.backend).toBe('canvas2d')
    expect((seeded.rendering as Record<string, unknown>)?.useCanvasKit).toBe(false)
    expect((seeded.autosave as Record<string, unknown>)?.recoveryEnabled).toBe(false)
    expect((seeded.theme as Record<string, unknown>)?.mode).toBe('dark')

    const url = mobileHwpStudioUrl('ko')
    expect(url).toContain('./studio/index.html?')
    expect(url).toContain('chrome=embed')
    expect(url).toContain('renderer=canvas2d')
    expect(url).toContain('lang=ko')
  })
})

describe('createMobileHwpApi save verification, backup gate, protected guard, and stubs', () => {
  it('runs exportHwpVerify -> hwpNewTabs -> measureTabs -> saveFileBytes and surfaces trackingDropped', async () => {
    const calls: string[] = []
    const transport: MobileTransport = {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        calls.push(command)
        if (command === 'mobile_read_file_bytes') {
          return {
            bytesBase64: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString('base64'),
            trackingDropped: true,
            encrypted: false,
            distribution: false,
          } as T
        }
        if (command === 'mobile_hwp_new_tabs') {
          return [
            {
              section: 0,
              para: 0,
              tabIdx: 0,
              before: 'A',
              after: 'B',
              charShapeId: 0,
              tabDefId: 0,
            },
          ] as T
        }
        if (command === 'mobile_save_file_bytes') {
          expect((args?.hwpFix as { measuredTabs?: unknown[] })?.measuredTabs).toHaveLength(1)
          return { ok: true, backupId: 'bk-1' } as T
        }
        if (command === 'mobile_recovery_discard' || command === 'mobile_share_file') {
          return { ok: true } as T
        }
        throw new Error(`unexpected ${command}`)
      },
      async listen() {
        return () => {}
      },
    }

    const client = createMobileClient(transport)
    const api = createMobileHwpApi(client)
    const session = makeHwpSession()

    const opened = await api.readDocument(session)
    expect(opened.trackingDropped).toBe(true)
    expect(opened.encrypted).toBe(false)

    const editor: MobileHwpEditorPort = {
      isPasswordProtected: async () => false,
      exportHwp: async () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]),
      exportHwpx: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      exportHwpVerify: async () => ({ pageCountBefore: 2, pageCountAfter: 2, recovered: true }),
      measureTabs: async (spots) =>
        spots.map((s) => ({
          section: s.section,
          para: s.para,
          tabIdx: s.tabIdx,
          widthHwpUnit: 1200,
        })),
      getPlainText: async () => 'Hello HWP',
      replaceText: async () => true,
      notifySaved: async () => {},
    }

    const saved = await api.saveDocument(session, editor, { encrypted: false, distribution: false })
    expect(saved.kind).toBe('saved')
    if (saved.kind === 'saved') {
      expect(saved.backupId).toBe('bk-1')
    }
    expect(calls).toContain('mobile_hwp_new_tabs')
    expect(calls).toContain('mobile_save_file_bytes')
  })

  it('blocks save on verify mismatch, backup failure, and password-protected docs, and forces original-only share', async () => {
    const sharedModes: string[] = []
    let failBackup = false
    const transport: MobileTransport = {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'mobile_hwp_new_tabs') return [] as T
        if (command === 'mobile_save_file_bytes') {
          if (failBackup) {
            throw new MobileCommandError({
              code: 'BACKUP_FAILED',
              messageKey: 'hwpBackupFailedError',
            })
          }
          return { ok: true } as T
        }
        if (command === 'mobile_share_file') {
          sharedModes.push(String(args?.mode))
          return { ok: true } as T
        }
        return { ok: true } as T
      },
      async listen() {
        return () => {}
      },
    }

    const client = createMobileClient(transport)
    const api = createMobileHwpApi(client)
    const session = makeHwpSession()

    const badVerifyEditor: MobileHwpEditorPort = {
      isPasswordProtected: async () => false,
      exportHwp: async () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]),
      exportHwpx: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      exportHwpVerify: async () => ({ pageCountBefore: 3, pageCountAfter: 1, recovered: false }),
      measureTabs: async () => [],
      getPlainText: async () => 'Text',
      replaceText: async () => true,
      notifySaved: async () => {},
    }

    const verifyFail = await api.saveDocument(session, badVerifyEditor, {
      encrypted: false,
      distribution: false,
    })
    expect(verifyFail).toEqual({ kind: 'failed', reason: 'verify' })

    const protectedRes = await api.saveDocument(session, badVerifyEditor, {
      encrypted: true,
      distribution: false,
    })
    expect(protectedRes).toEqual({ kind: 'failed', reason: 'protected' })

    // Protected share must force mode: 'original' and omit edited bytes
    await api.shareDocument(session, badVerifyEditor, { encrypted: true, distribution: false })
    expect(sharedModes).toEqual(['original'])

    // Backup failure must abort save cleanly with backup-failed reason
    failBackup = true
    const okVerifyEditor: MobileHwpEditorPort = {
      ...badVerifyEditor,
      exportHwpVerify: async () => ({ pageCountBefore: 1, pageCountAfter: 1, recovered: true }),
    }
    const backupFail = await api.saveDocument(session, okVerifyEditor, {
      encrypted: false,
      distribution: false,
    })
    expect(backupFail).toEqual({ kind: 'failed', reason: 'backup-failed' })

    // Excluded desktop HWP features close safely as unsupported
    expect(await api.printPages()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.exportPdf()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.openHanjaDict()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.runDocCheck()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.copyFormat()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
  })

  it('strips HWP AI mutation tools on encrypted/distribution docs and auto-switches on writable docs', async () => {
    let mode: DocumentMode = 'view'
    let docText = 'Original Korean paragraph.'
    const port: MobileHwpEditorPort = {
      isPasswordProtected: async () => false,
      exportHwp: async () => new Uint8Array(),
      exportHwpx: async () => new Uint8Array(),
      exportHwpVerify: async () => ({ pageCountBefore: 1, pageCountAfter: 1, recovered: true }),
      measureTabs: async () => [],
      getPlainText: async () => docText,
      replaceText: async (find, replace) => {
        if (!docText.includes(find)) return false
        docText = docText.replace(find, replace)
        return true
      },
      notifySaved: async () => {},
    }

    const encryptedSkill = createMobileHwpSkill(port, {
      getMode: () => 'view',
      getCapabilities: () => ({ writable: true, encrypted: true, distribution: false }),
      switchToEdit: () => {},
    })
    expect(encryptedSkill.tools.map((t) => t.name)).toEqual(['read_hwp_text'])
    const blocked = await encryptedSkill.executeTool({
      id: '1',
      name: 'replace_hwp_text',
      input: { find: 'Original', replace: 'Edited' },
    })
    expect(blocked.isError).toBe(true)

    const writableSkill = createMobileHwpSkill(port, {
      getMode: () => mode,
      getCapabilities: () => ({ writable: true, encrypted: false, distribution: false }),
      switchToEdit: () => {
        mode = 'edit'
      },
    })
    const res = await writableSkill.executeTool({
      id: '2',
      name: 'replace_hwp_text',
      input: { find: 'Original', replace: 'Updated' },
    })
    expect(res.mutated).toBe(true)
    expect(mode).toBe('edit')
    expect(docText).toContain('Updated')
  })
})
