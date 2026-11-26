// EPUB reader adapter (track T5, task RDR-T4): opening and refusals, the drawing copy of a chapter
// (sanitizer, CSP, blob: resources), reading order and TOC, book search, link routing and cleanup.
// Test books are built here with jszip; no book made by another program is stored in the repository.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

// jsdom brings its own typed arrays, Node's TextEncoder hands back Node's, and the zip library
// tells bytes apart with `instanceof`. One kind for everything (as apps/epub/tests/setup.ts does).
vi.hoisted(() => {
  const sample = new TextEncoder().encode('')
  globalThis.Uint8Array = sample.constructor as Uint8ArrayConstructor
  globalThis.ArrayBuffer = sample.buffer.constructor as ArrayBufferConstructor
})

import JSZip from 'jszip'
import { IDPF_FONT_OBFUSCATION, obfuscateFont } from '@genoffice/epub-engine/core'
import { buildTextIndex, rangeOf } from '../../epub/src/renderer/reader/book-search'
import {
  BLOCK_ATTR,
  MOBILE_FRAME_CSP,
  VIEW_STYLE_ID,
  buildChapterView,
} from '../src/renderer/editors/readers/epub/chapterView'
import {
  currentTocIndex,
  firstChapter,
  nextChapter,
  openBook,
  tocEntries,
  type ReaderBook,
} from '../src/renderer/editors/readers/epub/book'
import { chapterSearchText, searchBook } from '../src/renderer/editors/readers/epub/search'
import { routeBookLink } from '../src/renderer/editors/readers/epub/links'

const BOOK_ID = 'urn:uuid:12345678-90ab-cdef-1234-567890abcdef'
const FONT_BYTES = new Uint8Array(2048).map((_, i) => (i * 7) % 256)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const BG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])
const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg"><circle id="dot" r="2"/></svg>'

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
  '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
  '</container>\n'

const xhtml = (title: string, body: string, head = '', bodyAttrs = ''): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE html>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
  `<head><title>${title}</title>${head}</head>\n<body${bodyAttrs}>\n${body}\n</body>\n</html>\n`

const CHAPTER_ONE = xhtml(
  'One',
  [
    '<h1 id="top">Chapter One</h1>',
    '<p onclick="steal()">First paragraph <a href="javascript:alert(1)">bad</a> <a href="two.xhtml#n1">next</a> <a href="https://example.com/">web</a></p>',
    '<p><img src="../images/pic.png" srcset="../images/pic.png 2x" alt="a"/><img src="../images/pic.png" alt="b"/></p>',
    '<p><img src="../../../../images/pic.png" alt="escape"/><img src="http://evil.example/x.png" alt="remote"/><img src="missing.png" alt="missing"/><img src="../code/app.js" alt="script"/><img src="data:image/png;base64,AAAA" alt="data"/></p>',
    '<div style="background-image: url(\'../images/bg.png\')">Styled text here.</div>',
    '<iframe src="two.xhtml"></iframe>',
    '<object data="../images/pic.png"></object>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">' +
      '<image xlink:href="../images/icon.svg" width="10" height="10"/>' +
      '<use href="../images/icon.svg#dot"/><use href="#local"/><image href="https://evil.example/i.svg"/></svg>',
  ].join('\n'),
  '<link rel="stylesheet" href="../styles/book.css"/>' +
    '<link rel="stylesheet" href="../code/app.js"/>' +
    '<link rel="stylesheet" href="https://evil.example/x.css"/>' +
    '<style>@font-face { font-family: A; src: url("../fonts/a.otf") format("opentype") } ' +
    '.x { background: url(../images/bg.png) } .y { background: url(http://evil.example/y.png) } ' +
    '.z { background: url(../../../../nowhere.png) }</style>' +
    '<script>alert(1)</script><base href="http://evil.example/"/>',
  ' onload="boot()"',
)

const CHAPTER_TWO = xhtml('Two', '<h1>Chapter Two</h1>\n<p id="n1">A note that is not linear.</p>')
const CHAPTER_THREE = xhtml(
  'Three',
  '<h2>Chapter   Three</h2>\n<pre>\nfirst line\n  second line</pre>\n<p>Another <em>paragraph</em> with a paragraph word.</p>\n<table><tr><td>cell one</td><td>cell two</td></tr></table>',
)
const NOTES = xhtml('Notes', '<p>Outside the spine.</p>')
const NAV = xhtml(
  'Contents',
  '<nav epub:type="toc"><ol>' +
    '<li><a href="one.xhtml">Chapter One</a></li>' +
    '<li><a href="two.xhtml#n1">The note</a></li>' +
    '<li><a href="notes.xhtml">Notes</a></li>' +
    '<li><a href="three.xhtml#x">Chapter Three</a></li>' +
    '</ol></nav>',
)

interface BookOptions {
  fixedLayout?: boolean
  rtl?: boolean
  vertical?: boolean
}

async function zipBook(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  const date = new Date('2026-01-01T00:00:00Z')
  zip.file('mimetype', 'application/epub+zip', { date, compression: 'STORE' })
  for (const [name, data] of Object.entries(files))
    zip.file(name, data, { date, createFolders: false })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildBook(options: BookOptions = {}): Promise<Uint8Array> {
  const meta =
    (options.fixedLayout ? '<meta property="rendition:layout">pre-paginated</meta>\n' : '') +
    (options.vertical ? '<meta name="primary-writing-mode" content="vertical-rl"/>\n' : '')
  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">\n' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    `<dc:identifier id="uid">${BOOK_ID}</dc:identifier>\n` +
    '<dc:title>A Reader Book</dc:title>\n<dc:language>en</dc:language>\n' +
    '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>\n' +
    meta +
    '</metadata>\n<manifest>\n' +
    '<item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
    '<item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="three" href="text/three.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="css" href="styles/book.css" media-type="text/css"/>\n' +
    '<item id="more" href="styles/more.css" media-type="text/css"/>\n' +
    '<item id="font" href="fonts/a.otf" media-type="font/otf"/>\n' +
    '<item id="js" href="code/app.js" media-type="text/javascript"/>\n' +
    '<item id="pic" href="images/pic.png" media-type="image/png"/>\n' +
    '<item id="bg" href="images/bg.png" media-type="image/png"/>\n' +
    '<item id="icon" href="images/icon.svg" media-type="image/svg+xml"/>\n' +
    '</manifest>\n' +
    `<spine${options.rtl ? ' page-progression-direction="rtl"' : ''}>\n` +
    '<itemref idref="one"/>\n<itemref idref="two" linear="no"/>\n<itemref idref="three"/>\n' +
    '</spine>\n</package>\n'
  return zipBook({
    'META-INF/container.xml': CONTAINER_XML,
    'META-INF/encryption.xml':
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">\n' +
      `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${IDPF_FONT_OBFUSCATION}"/>` +
      '<enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData>\n' +
      '</encryption>\n',
    'OEBPS/content.opf': opf,
    'OEBPS/text/nav.xhtml': NAV,
    'OEBPS/text/one.xhtml': CHAPTER_ONE,
    'OEBPS/text/two.xhtml': CHAPTER_TWO,
    'OEBPS/text/three.xhtml': CHAPTER_THREE,
    'OEBPS/text/notes.xhtml': NOTES,
    'OEBPS/styles/book.css':
      '@import url("more.css");\n@import "../code/app.js";\n@import url(https://evil.example/r.css);\n@namespace epub url(http://www.idpf.org/2007/ops);\nbody { margin: 0 }\n/* url(../images/pic.png) */\n' +
      '.q::after { content: "</style><script>alert(2)</script>" }\n',
    'OEBPS/styles/more.css':
      '@import "book.css";\n.more { background: url("../images/bg.png") no-repeat }\n',
    'OEBPS/fonts/a.otf': obfuscateFont(FONT_BYTES, IDPF_FONT_OBFUSCATION, BOOK_ID)!,
    'OEBPS/code/app.js': 'alert(1)\n',
    'OEBPS/images/pic.png': PNG,
    'OEBPS/images/bg.png': BG,
    'OEBPS/images/icon.svg': SVG_ICON,
  })
}

// --- blob URL stand-ins (jsdom has neither function) ---

let blobs: Map<string, Blob>
let created: string[]
let revoked: string[]
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(() => {
  blobs = new Map()
  created = []
  revoked = []
  let n = 0
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${++n}`
    blobs.set(url, blob)
    created.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  }) as typeof URL.revokeObjectURL
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function blobBytes(url: string): Promise<Uint8Array> {
  const blob = blobs.get(url)
  if (!blob) throw new Error(`no blob for ${url}`)
  return new Uint8Array(await readBlob(blob))
}

async function blobText(url: string): Promise<string> {
  return new TextDecoder().decode(await blobBytes(url))
}

async function open(options?: BookOptions): Promise<ReaderBook> {
  const result = await openBook(await buildBook(options))
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.book
}

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')

/** The one blob URL whose bytes equal `bytes`. */
async function urlWithBytes(bytes: Uint8Array): Promise<string[]> {
  const out: string[] = []
  for (const url of created) {
    const got = await blobBytes(url)
    if (got.length === bytes.length && got.every((b, i) => b === bytes[i])) out.push(url)
  }
  return out
}

describe('opening a book', () => {
  it('opens a book and states the facts the screen needs', async () => {
    const book = await open()
    expect(book.facts).toMatchObject({
      title: 'A Reader Book',
      chapterCount: 3,
      fixedLayout: false,
      verticalWriting: false,
      rtl: false,
    })
  })

  it('reports fixed layout, right-to-left page order and vertical writing', async () => {
    const book = await open({ fixedLayout: true, rtl: true, vertical: true })
    expect(book.facts.fixedLayout).toBe(true)
    expect(book.facts.rtl).toBe(true)
    expect(book.facts.verticalWriting).toBe(true)
  })

  it('returns the engine refusal unchanged: damaged, not-epub, drm', async () => {
    const damaged = await openBook(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]))
    expect(damaged).toEqual({ ok: false, reason: 'damaged' })

    const notEpub = await openBook(await zipBook({ 'hello.txt': 'hi' }))
    expect(notEpub).toEqual({ ok: false, reason: 'not-epub' })

    const good = await JSZip.loadAsync(await buildBook())
    good.file('META-INF/rights.xml', '<rights/>')
    const rights = await openBook(await good.generateAsync({ type: 'uint8array' }))
    expect(rights).toEqual({ ok: false, reason: 'drm' })

    const encrypted = await JSZip.loadAsync(await buildBook())
    encrypted.file(
      'META-INF/encryption.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">\n' +
        '<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>' +
        '<enc:CipherData><enc:CipherReference URI="OEBPS/text/one.xhtml"/></enc:CipherData></enc:EncryptedData>\n' +
        '</encryption>\n',
    )
    const drm = await openBook(await encrypted.generateAsync({ type: 'uint8array' }))
    expect(drm).toEqual({ ok: false, reason: 'drm' })
  })
})

describe('the drawing copy of a chapter', () => {
  it('removes scripts, on… attributes, javascript: addresses, frames, plug-ins and <base>', async () => {
    const book = await open()
    const view = (await buildChapterView(book, 0, ''))!
    // the only "<script" left is text inside an inlined stylesheet (checked below)
    expect(parse(view.html).querySelectorAll('script')).toHaveLength(0)
    expect(view.html.replace(/<style[\s\S]*?<\/style>/g, '')).not.toMatch(/<script/i)
    expect(view.html).not.toMatch(/\son[a-z]+=/i)
    expect(view.html).not.toMatch(/javascript:/i)
    expect(view.html).not.toMatch(/<iframe/i)
    expect(view.html).not.toMatch(/<object/i)
    expect(view.html).not.toMatch(/<base/i)
    expect(view.html).not.toContain('evil.example')
    expect(view.html.startsWith('<!DOCTYPE html>\n')).toBe(true)
  })

  it('carries the mobile CSP exactly, charset first and the view style last', async () => {
    expect(MOBILE_FRAME_CSP).toBe(
      "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; " +
        "worker-src 'none'; connect-src 'none'; form-action 'none'; img-src blob: data:; " +
        "style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src 'none'",
    )
    const book = await open()
    const view = (await buildChapterView(book, 0, 'html { color: red }'))!
    const doc = parse(view.html)
    const head = Array.from(doc.head.children)
    expect(head[0]!.getAttribute('charset')).toBe('utf-8')
    expect(head[1]!.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(head[1]!.getAttribute('content')).toBe(MOBILE_FRAME_CSP)
    expect(head[2]!.localName).toBe('title')
    const last = head[head.length - 1]!
    expect(last.id).toBe(VIEW_STYLE_ID)
    expect(last.textContent).toBe('html { color: red }')
    // the book's styles in their order: the linked sheet (inlined), then the chapter's own <style>
    const styles = head.filter((el) => el.localName === 'style' && el.id !== VIEW_STYLE_ID)
    expect(styles).toHaveLength(2)
    expect(styles[0]!.textContent).toContain('body { margin: 0 }')
    // a stylesheet cannot close its <style> and open a script in the frame's HTML
    expect(styles[0]!.textContent).toContain('alert(2)')
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(styles[1]!.textContent).toContain('@font-face')
    expect(doc.querySelectorAll('link')).toHaveLength(0)
  })

  it('marks blocks with the engine block ids', async () => {
    const book = await open()
    const doc = parse((await buildChapterView(book, 0))!.html)
    const marked = Array.from(doc.querySelectorAll(`[${BLOCK_ATTR}]`))
    expect(marked.length).toBeGreaterThanOrEqual(2)
    expect(marked[0]!.localName).toBe('h1')
    expect(new Set(marked.map((el) => el.getAttribute(BLOCK_ATTR))).size).toBe(marked.length)
  })

  it('serves pictures as one blob URL per entry and removes what cannot be served', async () => {
    const book = await open()
    const view = (await buildChapterView(book, 0))!
    const doc = parse(view.html)
    const img = (alt: string) => doc.querySelector(`img[alt="${alt}"]`)!
    const [picUrl] = await urlWithBytes(PNG)
    expect(picUrl).toBeDefined()
    expect(img('a').getAttribute('src')).toBe(picUrl)
    expect(img('b').getAttribute('src')).toBe(picUrl)
    expect(img('a').hasAttribute('srcset')).toBe(false)
    for (const alt of ['escape', 'remote', 'missing', 'script']) {
      expect(img(alt).hasAttribute('src')).toBe(false)
    }
    expect(img('data').getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(await urlWithBytes(PNG)).toHaveLength(1)
  })

  it('never serves a script entry', async () => {
    const book = await open()
    await buildChapterView(book, 0)
    for (const url of created) {
      const blob = blobs.get(url)!
      expect(blob.type).not.toMatch(/javascript|ecmascript/)
      expect(await blobText(url)).not.toContain('alert(1)')
    }
  })

  it('rewrites SVG image and use references inside the book', async () => {
    const book = await open()
    const doc = parse((await buildChapterView(book, 0))!.html)
    const svg = doc.querySelector('svg')!
    const images = svg.querySelectorAll('image')
    const iconUrl = images[0]!.getAttribute('xlink:href')!
    expect(iconUrl).toMatch(/^blob:test\//)
    expect(await blobText(iconUrl)).toBe(SVG_ICON)
    expect(blobs.get(iconUrl)!.type).toBe('image/svg+xml')
    // the remote one lost its address
    expect(images[1]!.hasAttribute('href')).toBe(false)
    const uses = svg.querySelectorAll('use')
    expect(uses[0]!.getAttribute('href')).toBe(`${iconUrl}#dot`)
    expect(uses[1]!.getAttribute('href')).toBe('#local')
  })

  it('inlines linked stylesheets and rewrites url(), @import and @font-face', async () => {
    const book = await open()
    const doc = parse((await buildChapterView(book, 0))!.html)
    const [bgUrl] = await urlWithBytes(BG)
    expect(bgUrl).toBeDefined()
    // one URL for bg.png, though the chapter style, a style attribute and an imported sheet use it
    expect(await urlWithBytes(BG)).toHaveLength(1)

    const styles = Array.from(doc.head.querySelectorAll('style')).filter(
      (s) => s.id !== VIEW_STYLE_ID,
    )
    const linked = styles[0]!.textContent!
    const imports = Array.from(linked.matchAll(/@import url\("([^"]+)"\)/g)).map((m) => m[1]!)
    // more.css is served; the script and the remote import are gone
    expect(imports).toHaveLength(1)
    expect(linked).not.toContain('app.js')
    expect(linked).not.toContain('evil.example')
    // an @namespace rule names a namespace and loads nothing: kept as written
    expect(linked).toContain('@namespace epub url(http://www.idpf.org/2007/ops);')
    // a comment is left as it is and loads nothing
    expect(linked).toContain('/* url(../images/pic.png) */')
    const more = await blobText(imports[0]!)
    expect(blobs.get(imports[0]!)!.type).toBe('text/css')
    expect(more).toContain(`url("${bgUrl}")`)
    // the import back to book.css (a cycle) is dropped
    expect(more).not.toContain('@import')

    const own = styles[1]!.textContent!
    expect(own).toContain(`.x { background: url("${bgUrl}") }`)
    expect(own).toContain('.y { background: none }')
    expect(own).toContain('.z { background: none }')
    const fontUrl = /src: url\("([^"]+)"\) format\("opentype"\)/.exec(own)![1]!
    // the IDPF-obfuscated font comes out revealed
    expect(await blobBytes(fontUrl)).toEqual(FONT_BYTES)

    const styled = doc.querySelector('div[style]')!
    expect(styled.getAttribute('style')).toBe(`background-image: url("${bgUrl}")`)
  })

  it('release() revokes every URL the chapter made, once', async () => {
    const book = await open()
    const view = (await buildChapterView(book, 0))!
    expect(created.length).toBeGreaterThan(0)
    view.release()
    expect([...revoked].sort()).toEqual([...created].sort())
    view.release()
    expect(revoked).toHaveLength(created.length)
  })

  it('dispose() revokes what is left and later chapters draw nothing', async () => {
    const book = await open()
    const first = (await buildChapterView(book, 0))!
    first.release()
    const before = revoked.length
    await buildChapterView(book, 0)
    book.dispose()
    expect([...revoked].sort()).toEqual([...created].sort())
    expect(revoked.length).toBeGreaterThan(before)
    expect(book.disposed).toBe(true)
    expect(await buildChapterView(book, 0)).toBeNull()
    book.dispose()
    expect(revoked).toHaveLength(created.length)
  })

  it('a book closed while a chapter is drawn keeps no URL alive', async () => {
    const book = await open()
    const pending = buildChapterView(book, 0)
    book.dispose()
    expect(await pending).toBeNull()
    expect([...revoked].sort()).toEqual([...created].sort())
  })

  it('returns null for a chapter that does not exist', async () => {
    const book = await open()
    expect(await buildChapterView(book, 99)).toBeNull()
    expect(await buildChapterView(book, -1)).toBeNull()
  })
})

describe('reading order and the table of contents', () => {
  it('skips linear="no" items when turning pages', async () => {
    const book = await open()
    expect(firstChapter(book)).toBe(0)
    expect(nextChapter(book, 0, 1)).toBe(2)
    expect(nextChapter(book, 2, -1)).toBe(0)
    // from the non-linear item a link reached
    expect(nextChapter(book, 1, 1)).toBe(2)
    expect(nextChapter(book, 2, 1)).toBeNull()
    expect(nextChapter(book, 0, -1)).toBeNull()
  })

  it('maps TOC entries to spine index and fragment; outside the spine is null', async () => {
    const book = await open()
    const toc = tocEntries(book)
    expect(toc.map((e) => [e.title, e.spineIndex, e.fragment])).toEqual([
      ['Chapter One', 0, null],
      ['The note', 1, 'n1'],
      ['Notes', null, null],
      ['Chapter Three', 2, 'x'],
    ])
    expect(toc.every((e) => e.depth === 1)).toBe(true)
    expect(currentTocIndex(book, 2)).toBe(3)
    expect(currentTocIndex(book, 1)).toBe(1)
  })
})

describe('searching the book', () => {
  it('finds hits whose offsets line up with the drawn copy', async () => {
    const book = await open()
    const result = await searchBook(book, { query: 'paragraph' })
    expect(result.truncated).toBe(false)
    expect(result.hits.map((h) => h.spineIndex)).toEqual([0, 2, 2])
    for (const spineIndex of [0, 2]) {
      const view = (await buildChapterView(book, spineIndex))!
      const drawn = parse(view.html)
      const index = buildTextIndex(drawn.body)
      expect(await chapterSearchText(book, spineIndex)).toBe(index.text)
      for (const hit of result.hits.filter((h) => h.spineIndex === spineIndex)) {
        const range = rangeOf(drawn, index, hit.start, hit.length)!
        expect(range.toString().toLowerCase()).toBe('paragraph')
      }
      view.release()
    }
  })

  it('keeps the PC limit of 500 hits', async () => {
    const book = await open()
    const result = await searchBook(book, { query: 'e' })
    expect(result.hits.length).toBeLessThanOrEqual(500)
    const few = await searchBook(book, { query: 'e', limit: 2 })
    expect(few.hits).toHaveLength(2)
    expect(few.truncated).toBe(true)
  })

  it('serves no resources while searching', async () => {
    const book = await open()
    await searchBook(book, { query: 'chapter' })
    expect(created).toHaveLength(0)
  })
})

describe('links in a chapter', () => {
  it('routes in-book links to chapters, other entries to nothing, and only safe outside links', async () => {
    const book = await open()
    expect(routeBookLink(book, 0, 'two.xhtml#n1')).toEqual({
      kind: 'chapter',
      spineIndex: 1,
      fragment: 'n1',
    })
    expect(routeBookLink(book, 0, '#top')).toEqual({
      kind: 'chapter',
      spineIndex: 0,
      fragment: 'top',
    })
    expect(routeBookLink(book, 2, '../text/one.xhtml')).toEqual({
      kind: 'chapter',
      spineIndex: 0,
      fragment: null,
    })
    expect(routeBookLink(book, 0, '../../../text/three.xhtml')).toEqual({ kind: 'entry' })
    expect(routeBookLink(book, 0, '../images/pic.png')).toEqual({ kind: 'entry' })
    expect(routeBookLink(book, 0, 'notes.xhtml')).toEqual({ kind: 'entry' })
    expect(routeBookLink(book, 0, ' https://example.com/ ')).toEqual({
      kind: 'outside',
      url: 'https://example.com/',
    })
    expect(routeBookLink(book, 0, 'mailto:reader@example.com')).toEqual({
      kind: 'outside',
      url: 'mailto:reader@example.com',
    })
    expect(routeBookLink(book, 0, 'javascript:alert(1)')).toEqual({ kind: 'none' })
    expect(routeBookLink(book, 0, 'file:///etc/passwd')).toEqual({ kind: 'none' })
    expect(routeBookLink(book, 0, '')).toEqual({ kind: 'none' })
    expect(routeBookLink(book, 0, null)).toEqual({ kind: 'none' })
    expect(routeBookLink(book, 42, 'one.xhtml')).toEqual({ kind: 'none' })
  })
})
