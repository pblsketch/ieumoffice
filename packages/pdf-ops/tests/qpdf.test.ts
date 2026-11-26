// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  QpdfFailedError,
  WrongPasswordError,
  qpdfDecrypt,
  qpdfEncrypt,
  type CreateQpdf,
  type QpdfInstance,
} from '../src/qpdf'

interface Fake {
  create: CreateQpdf
  options: Record<string, unknown>[]
  calls: string[][]
  written: Map<string, Uint8Array>
}

/** a qpdf factory that records what it is asked and answers `code` (and an output unless null) */
function fakeQpdf(code: number | 'throw', output: Uint8Array | null = Uint8Array.of(9, 9)): Fake {
  const options: Record<string, unknown>[] = []
  const calls: string[][] = []
  const written = new Map<string, Uint8Array>()
  const create: CreateQpdf = async (o) => {
    options.push(o)
    const instance: QpdfInstance = {
      callMain(args) {
        calls.push(args)
        if (code === 'throw') throw new Error('abort')
        if (output) written.set('/out.pdf', output)
        return code
      },
      FS: {
        writeFile: (path, data) => void written.set(path, Uint8Array.from(data)),
        readFile(path) {
          const data = written.get(path)
          if (!data) throw new Error('ENOENT')
          return data
        },
      },
    }
    return instance
  }
  return { create, options, calls, written }
}

const input = Uint8Array.of(1, 2, 3)

describe('qpdfEncrypt', () => {
  it('runs qpdf with the passwords, AES-256 and no restrictions', async () => {
    const q = fakeQpdf(0)
    const out = await qpdfEncrypt(q.create, 'wasm://qpdf', input, {
      userPassword: 'u',
      ownerPassword: 'o',
      restrict: false,
    })
    expect(out).toEqual(Uint8Array.of(9, 9))
    expect(q.calls).toEqual([
      [
        '--encrypt',
        '--user-password=u',
        '--owner-password=o',
        '--bits=256',
        '--',
        '/in.pdf',
        '/out.pdf',
      ],
    ])
    expect(q.written.get('/in.pdf')).toEqual(input)
    expect((q.options[0]!.locateFile as () => string)()).toBe('wasm://qpdf')
    expect(q.options[0]).toMatchObject({ noInitialRun: true, thisProgram: 'qpdf' })
  })

  it('adds the four restrictions when asked', async () => {
    const q = fakeQpdf(3)
    await qpdfEncrypt(q.create, 'w', input, {
      userPassword: 'u',
      ownerPassword: 'o',
      restrict: true,
    })
    expect(q.calls[0]).toEqual([
      '--encrypt',
      '--user-password=u',
      '--owner-password=o',
      '--bits=256',
      '--print=none',
      '--modify=none',
      '--extract=n',
      '--annotate=n',
      '--',
      '/in.pdf',
      '/out.pdf',
    ])
  })

  it.each([
    ['fails', 2, Uint8Array.of(1)],
    ['aborts', 'throw' as const, Uint8Array.of(1)],
    ['says done but writes nothing', 0, null],
  ])('throws QpdfFailedError when qpdf %s, without the password', async (_n, code, output) => {
    const q = fakeQpdf(code, output)
    const err = await qpdfEncrypt(q.create, 'w', input, {
      userPassword: 'secret-user',
      ownerPassword: 'secret-owner',
      restrict: false,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QpdfFailedError)
    expect(String((err as Error).message)).not.toMatch(/secret/)
  })
})

describe('qpdfDecrypt', () => {
  it('refuses a wrong password before qpdf runs', async () => {
    const q = fakeQpdf(0)
    const err = await qpdfDecrypt(q.create, 'w', input, 'nope', () => 'wrong-password').catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(WrongPasswordError)
    expect((err as WrongPasswordError).name).toBe('PdfLoadError')
    expect((err as WrongPasswordError).code).toBe('password-required')
    expect(q.options).toEqual([])
  })

  it.each(['ok', 'unreadable'] as const)('runs qpdf when PDFium says %s', async (verdict) => {
    const q = fakeQpdf(0)
    const seen: [Uint8Array, string][] = []
    const out = await qpdfDecrypt(q.create, 'w', input, 'pw', (b, p) => {
      seen.push([b, p])
      return verdict
    })
    expect(out).toEqual(Uint8Array.of(9, 9))
    expect(seen).toEqual([[input, 'pw']])
    expect(q.calls).toEqual([['--password=pw', '--decrypt', '/in.pdf', '/out.pdf']])
  })

  it('throws QpdfFailedError when qpdf cannot write the file', async () => {
    const q = fakeQpdf(2)
    await expect(qpdfDecrypt(q.create, 'w', input, 'pw', () => 'ok')).rejects.toBeInstanceOf(
      QpdfFailedError,
    )
  })
})
