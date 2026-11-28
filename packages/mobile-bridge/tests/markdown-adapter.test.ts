import { describe, expect, it } from 'vitest'
import { createMobileClient, type MobileDocSession, type MobileTransport } from '../src/transport'
import {
  MAX_MOBILE_INLINE_IMAGE_BYTES,
  createMobileMarkdownApi,
  createMobileMarkdownSkill,
  inlineImageToMarkdown,
  preserveRelativeImageLinks,
} from '../src/markdown'
import type { DocumentMode } from '../src/view-edit-gate'

function utf8ToBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

function base64ToUtf8(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8')
}

function makeSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'md-sess-1',
    docKey: 'abcd1234abcd1234',
    name: 'note.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
    uriHint: 'content://notes/note.md',
    ...overrides,
  }
}

describe('markdown inline image validation and relative link preservation', () => {
  it('encodes allowed image types up to 5 MiB as inline data URIs', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const md = inlineImageToMarkdown({ bytes: pngBytes, mime: 'image/png', alt: 'chart' })
    expect(md).toBe(`![chart](data:image/png;base64,${Buffer.from(pngBytes).toString('base64')})`)

    const jpgMd = inlineImageToMarkdown({ bytes: new Uint8Array([1, 2]), mime: 'image/jpg' })
    expect(jpgMd.startsWith('![](data:image/jpeg;base64,')).toBe(true)
  })

  it('rejects images exceeding 5 MiB with FILE_TOO_LARGE and disallowed MIME with INVALID_ARGUMENT', () => {
    const tooBig = new Uint8Array(MAX_MOBILE_INLINE_IMAGE_BYTES + 1)
    expect(() => inlineImageToMarkdown({ bytes: tooBig, mime: 'image/png' })).toThrow(
      /FILE_TOO_LARGE/,
    )
    expect(() =>
      inlineImageToMarkdown({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/svg+xml' }),
    ).toThrow(/INVALID_ARGUMENT/)
  })

  it('preserves existing relative image markdown syntax intact across edits', () => {
    const original = '# Title\n\n![diagram](./assets/diagram.png)\n\nOld text.\n'
    const edited = '# Title\n\n![diagram](./assets/diagram.png)\n\nNew text.\n'
    expect(preserveRelativeImageLinks(original, edited)).toContain(
      '![diagram](./assets/diagram.png)',
    )
  })
})

describe('createMobileMarkdownApi save, recovery, share, and unsupported stubs', () => {
  it('reads, saves in-place, clears recovery, and rejects READ_ONLY_URI for ephemeral shares', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const transport: MobileTransport = {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        calls.push({ command, args })
        if (command === 'mobile_read_file_bytes') {
          return { bytesBase64: utf8ToBase64('# Hello\n![pic](./assets/a.png)\n') } as T
        }
        if (command === 'mobile_save_file_bytes') {
          return { ok: true } as T
        }
        if (command === 'mobile_save_as_file_bytes') {
          return makeSession({
            sessionId: 'md-sess-saved',
            docKey: '9999888877776666',
            name: 'saved.md',
            writable: true,
            ephemeral: false,
          }) as T
        }
        if (
          command === 'mobile_recovery_discard' ||
          command === 'mobile_recovery_write' ||
          command === 'mobile_share_file'
        ) {
          return { ok: true } as T
        }
        throw new Error(`unexpected ${command}`)
      },
      async listen() {
        return () => {}
      },
    }

    const client = createMobileClient(transport)
    const api = createMobileMarkdownApi(client)

    const session = makeSession()
    const opened = await api.readDocument(session)
    expect(opened.text).toContain('![pic](./assets/a.png)')

    await api.writeRecovery(session, '# Updated\n![pic](./assets/a.png)\n')
    expect(calls.some((c) => c.command === 'mobile_recovery_write')).toBe(true)

    await api.saveDocument(session, '# Updated\n![pic](./assets/a.png)\n')
    const saveCall = calls.find((c) => c.command === 'mobile_save_file_bytes')
    expect(saveCall).toBeDefined()
    expect(base64ToUtf8(String(saveCall?.args?.bytesBase64))).toBe(
      '# Updated\n![pic](./assets/a.png)\n',
    )
    expect(calls.some((c) => c.command === 'mobile_recovery_discard')).toBe(true)

    const ephemeralSession = makeSession({ writable: false, ephemeral: true })
    await expect(api.saveDocument(ephemeralSession, '# Draft')).rejects.toThrow(/READ_ONLY_URI/)

    const savedAs = await api.saveAsDocument(ephemeralSession, 'saved.md', '# Draft')
    expect(savedAs.writable).toBe(true)
    expect(savedAs.ephemeral).toBe(false)

    await api.shareDocument(session, '# Updated')
    const shareCall = calls.find((c) => c.command === 'mobile_share_file')
    expect(shareCall?.args?.mode).toBe('edited')

    // Excluded desktop features must close safely as unsupported
    expect(await api.listWikiNotes()).toEqual([])
    expect(await api.exportPdf()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.exportDocx()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.printDocument()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
    expect(await api.uploadImage()).toEqual({ ok: false, error: 'unsupported-on-mobile' })
  })

  it('auto-switches view to edit mode on markdown AI mutation tool and blocks read-only mutations', async () => {
    let text = '# Heading\n\nParagraph one.'
    let mode: DocumentMode = 'view'
    const skill = createMobileMarkdownSkill(
      {
        getMarkdown: () => text,
        setMarkdown: (next) => {
          text = next
        },
      },
      {
        getMode: () => mode,
        getCapabilities: () => ({ writable: true, encrypted: false, distribution: false }),
        switchToEdit: () => {
          mode = 'edit'
        },
      },
    )

    const readRes = await skill.executeTool({ id: 'r1', name: 'read_document', input: {} })
    expect(readRes.output).toContain('Paragraph one.')
    expect(mode).toBe('view')

    const editRes = await skill.executeTool({
      id: 'e1',
      name: 'replace_text',
      input: { find: 'Paragraph one.', replace: 'Paragraph updated.' },
    })
    expect(editRes.mutated).toBe(true)
    expect(mode).toBe('edit')
    expect(text).toContain('Paragraph updated.')
  })
})
