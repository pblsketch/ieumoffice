import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  getReaderState,
  READER_COMMANDS,
  setReaderPosition,
  setReaderSettings,
  type ReaderPosition,
  type ReaderSettings,
  type ReaderState,
} from '../src/readers'
import { createMobileClient, MobileCommandError, type MobileTransport } from '../src/transport'

function makeClient(invoke: MobileTransport['invoke']) {
  return createMobileClient({ invoke, listen: async () => () => {} })
}

const EPUB: ReaderPosition = {
  kind: 'epub',
  spineIndex: 3,
  href: 'text/ch3.xhtml',
  blockId: null,
}
const PPTX: ReaderPosition = { kind: 'pptx', slideIndex: 4, partPath: 'ppt/slides/slide5.xml' }
const SETTINGS: ReaderSettings = {
  fontScale: 1.25,
  lineHeight: null,
  theme: 'sepia',
  layout: 'scroll',
  notesOpen: true,
}

describe('readers bridge', () => {
  it('getReaderState calls mobile_readers_get_state with docKey and returns the result', async () => {
    const state: ReaderState = { position: EPUB, settings: SETTINGS }
    const invoke = vi.fn(async () => state) as unknown as MobileTransport['invoke']
    await expect(getReaderState(makeClient(invoke), 'doc-1')).resolves.toEqual(state)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('mobile_readers_get_state', { docKey: 'doc-1' })
  })

  it('getReaderState passes an empty state through', async () => {
    const empty: ReaderState = { position: null, settings: null }
    const invoke = vi.fn(async () => empty) as unknown as MobileTransport['invoke']
    await expect(getReaderState(makeClient(invoke), 'doc-2')).resolves.toEqual(empty)
  })

  it('setReaderPosition calls mobile_readers_set_position with docKey and position', async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as MobileTransport['invoke']
    const client = makeClient(invoke)
    await expect(setReaderPosition(client, 'doc-1', EPUB)).resolves.toBeUndefined()
    await setReaderPosition(client, 'doc-2', PPTX)
    expect(invoke).toHaveBeenNthCalledWith(1, 'mobile_readers_set_position', {
      docKey: 'doc-1',
      position: EPUB,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'mobile_readers_set_position', {
      docKey: 'doc-2',
      position: PPTX,
    })
  })

  it('setReaderSettings calls mobile_readers_set_settings with settings', async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as MobileTransport['invoke']
    await expect(setReaderSettings(makeClient(invoke), SETTINGS)).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('mobile_readers_set_settings', { settings: SETTINGS })
  })

  it('turns an INVALID_ARGUMENT rejection into a MobileCommandError', async () => {
    const invoke = vi.fn(async () => {
      throw {
        code: 'INVALID_ARGUMENT',
        messageKey: 'mobile.readers.invalidPosition',
        detail: 'unknown variant',
      }
    }) as unknown as MobileTransport['invoke']
    const err = await setReaderPosition(makeClient(invoke), 'doc', EPUB).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INVALID_ARGUMENT')
    expect((err as MobileCommandError).messageKey).toBe('mobile.readers.invalidPosition')
  })

  it('uses the command and argument names the Rust side declares and registers', () => {
    const root = new URL('../../../apps/mobile/src-tauri/src/', import.meta.url)
    const commands = readFileSync(new URL('commands/readers.rs', root), 'utf8')
    const lib = readFileSync(new URL('lib.rs', root), 'utf8')
    // Tauri maps camelCase JS argument names to these snake_case Rust parameters.
    const expected: Record<string, readonly string[]> = {
      [READER_COMMANDS.getState]: ['doc_key'],
      [READER_COMMANDS.setPosition]: ['doc_key', 'position'],
      [READER_COMMANDS.setSettings]: ['settings'],
    }
    for (const [name, params] of Object.entries(expected)) {
      const signature = new RegExp(`pub fn ${name}\\(([^)]*)\\)`).exec(commands)
      expect(signature, name).not.toBeNull()
      const declared = [...(signature?.[1] ?? '').matchAll(/(\w+):\s/g)]
        .map((m) => m[1])
        .filter((p) => p !== 'state')
      expect(declared, name).toEqual(params)
      expect(lib).toContain(`commands::readers::${name},`)
    }
  })
})
