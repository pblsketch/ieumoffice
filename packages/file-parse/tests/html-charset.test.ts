import { describe, expect, it } from 'vitest'
import { decodeHtmlBytes, parseFileToText } from '../src/parse'
import { writeFixture } from './helpers/fixtures'

let fixtureSeq = 0
function readHtml(content: Buffer) {
  return parseFileToText(writeFixture(`${++fixtureSeq}-page.html`, content))
}

describe('parseFileToText HTML charset', () => {
  it('decodes a page from its meta charset instead of falling back to windows-1252', async () => {
    const korean = '한글 본문'
    // EUC-KR bytes for that phrase (Buffer cannot encode euc-kr by name here)
    const body = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xba, 0xbb, 0xb9, 0xae])
    const html = Buffer.concat([
      Buffer.from('<!doctype html><html><head><meta charset="euc-kr"></head><body><p>', 'ascii'),
      body,
      Buffer.from('</p></body></html>', 'ascii'),
    ])
    const result = await parseFileToText(writeFixture('notice.html', html))
    expect(result.ok).toBe(true)
    expect(result.text).toContain(korean)
  })

  // the maintainer's two requested cases for PR #346: a declared UTF-16 is
  // never genuine without a real BOM (one would already have been caught),
  // and the HTML editor always writes UTF-8, so valid UTF-8 bytes win over
  // whatever charset a page happens to declare.
  it('keeps a redaction mark readable past a UTF-16 meta charset on an otherwise plain UTF-8 page', async () => {
    const html = Buffer.from(
      '<!doctype html><html><head><meta charset="utf-16"></head>' +
        '<body><span data-gx-redact="client phone">13800138000</span></body></html>',
      'utf-8',
    )
    const result = await readHtml(html)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('{{client phone}}')
    expect(result.text).not.toContain('13800138000')
  })

  it('reads valid UTF-8 intact past a stale EUC-KR meta charset', async () => {
    const korean = '한글 본문'
    const html = Buffer.from(
      `<!doctype html><html><head><meta charset="euc-kr"></head><body><p>${korean}</p></body></html>`,
      'utf-8',
    )
    const result = await readHtml(html)
    expect(result.ok).toBe(true)
    expect(result.text).toContain(korean)
  })

  it('never honors a label mapped to the WHATWG "replacement" encoding', () => {
    // real UTF-8 bytes that are invalid as some other charset, so the decoder
    // falls through to the declared label; iso-2022-kr always maps to the
    // replacement encoding (U+FFFD only) and must be skipped, same as UTF-16
    const invalidUtf8 = Buffer.from([0xff, 0x41, 0x42])
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="iso-2022-kr"></head><body>', 'ascii'),
      invalidUtf8,
      Buffer.from('</body></html>', 'ascii'),
    ])
    const text = decodeHtmlBytes(html)
    // the "replacement" decoder collapses an entire stream to one U+FFFD and
    // discards the rest; skipping the label keeps the surrounding markup and
    // the trailing "AB" instead
    expect(text).not.toBe('�')
    expect(text).toContain('iso-2022-kr')
    expect(text).toContain('AB')
  })
})
