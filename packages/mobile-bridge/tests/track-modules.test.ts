import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  invokeMobileCommand,
  MobileCommandError,
  type MobileTransport,
} from '../src/transport'

function makeTransport(invoke: MobileTransport['invoke']): MobileTransport {
  return {
    invoke,
    listen: async () => () => {},
  }
}

const TRACK_SUBPATHS = ['sheets', 'pdf', 'pdf-tools', 'html', 'readers', 'home'] as const

describe('invokeMobileCommand', () => {
  it('returns the value the transport resolves with', async () => {
    const invoke = vi.fn(async () => ({ pages: 3 })) as unknown as MobileTransport['invoke']
    const transport = makeTransport(invoke)
    await expect(
      invokeMobileCommand<{ pages: number }>(transport, 'mobile_test_cmd', { a: 1 }),
    ).resolves.toEqual({ pages: 3 })
    expect(invoke).toHaveBeenCalledWith('mobile_test_cmd', { a: 1 })
  })

  it('turns a structured rejection into a MobileCommandError with the same code', async () => {
    const transport = makeTransport(async () => {
      throw { code: 'PERMISSION_DENIED', messageKey: 'x' }
    })
    const err = await invokeMobileCommand(transport, 'mobile_test_cmd').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('PERMISSION_DENIED')
    expect((err as MobileCommandError).messageKey).toBe('x')
  })

  it('turns an unknown rejection into INTERNAL_ERROR', async () => {
    const transport = makeTransport(async () => {
      throw new Error('boom')
    })
    const err = await invokeMobileCommand(transport, 'mobile_test_cmd').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INTERNAL_ERROR')
  })
})

describe('MobileClient.setOpenableExtensions', () => {
  it('calls mobile_set_openable_formats with the extensions', async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as MobileTransport['invoke']
    const client = createMobileClient(makeTransport(invoke))
    await expect(client.setOpenableExtensions(['hwp', 'md'])).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('mobile_set_openable_formats', { exts: ['hwp', 'md'] })
  })
})

describe('track subpath modules', () => {
  it('declares every track subpath in package.json exports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>
    }
    for (const sub of TRACK_SUBPATHS) {
      expect(pkg.exports[`./${sub}`]).toBe(`./src/${sub}/index.ts`)
    }
  })

  it('can import every track subpath through the package name', async () => {
    const loaded = await Promise.all([
      import('@genoffice/mobile-bridge/sheets'),
      import('@genoffice/mobile-bridge/pdf'),
      import('@genoffice/mobile-bridge/pdf-tools'),
      import('@genoffice/mobile-bridge/html'),
      import('@genoffice/mobile-bridge/readers'),
      import('@genoffice/mobile-bridge/home'),
    ])
    expect(loaded).toHaveLength(TRACK_SUBPATHS.length)
    for (const mod of loaded) expect(typeof mod).toBe('object')
  })
})
