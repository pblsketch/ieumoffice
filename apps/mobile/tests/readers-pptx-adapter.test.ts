// PPTX adapter of track T5 readers: bytes → opened deck → per-slide render data, media URLs,
// notes, hidden flag, search text → cleanup. Runs the real engine through the mobile stand-ins.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import type { RenderFill, RenderNode, RenderSlide } from '@genoffice/pptx-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { displayMime as pcDisplayMime } from '../../slides/src/main/media-mime'
import { PPTX_ENGINE_SRC } from '../src/renderer/editors/readers/build/pptxNodeShims'
import { PptxOpenError, openDeck, type PptxDeck } from '../src/renderer/editors/readers/pptx/deck'
import { loadSlideImages, slideImageUrls } from '../src/renderer/editors/readers/pptx/images'
import { createSlideMediaStore, isMetafileUrl } from '../src/renderer/editors/readers/pptx/media'
import { displayMime, sniffImageMime } from '../src/renderer/editors/readers/pptx/mime'

const FIXTURES = join(PPTX_ENGINE_SRC, '../tests/fixtures')
const FIXTURE_DECKS = readdirSync(FIXTURES).filter((name) => name.endsWith('.pptx'))
const SLOW = 60_000

// ── blob: URL stand-ins (jsdom has none) ─────────────────────────────

const blobs = new Map<string, Blob>()
const revoked: string[] = []
let blobSeq = 0

beforeEach(() => {
  blobs.clear()
  revoked.length = 0
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${++blobSeq}`
    blobs.set(url, blob)
    return url
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
    blobs.delete(url)
  }
})

const baseUrl = (url: string): string => url.replace(/#.*$/, '')
const isLive = (url: string): boolean => blobs.has(baseUrl(url))

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => fail(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

// ── test media ──────────────────────────────────────────────────────

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG_DATA = `image/png;base64,${PNG_B64}`

function emfBytes(): Uint8Array {
  const out = new Uint8Array(108)
  out.set([0x01, 0x00, 0x00, 0x00], 0)
  out.set([0x20, 0x45, 0x4d, 0x46], 40)
  return out
}

/** A minimal JPEG whose EXIF says Orientation = 6 (little-endian TIFF block) */
function jpegWithOrientation(value: number): Uint8Array {
  // prettier-ignore
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00, // 0x0112 SHORT
    0x00, 0x00, 0x00, 0x00, // next IFD
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const segLen = payload.length + 2
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    segLen >> 8,
    segLen & 0xff,
    ...payload,
    0xff,
    0xd9,
  ])
}

// ── a deck built for these tests ────────────────────────────────────

const GROUP_XML =
  '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="900" name="Outer group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="500000" y="4000000"/><a:ext cx="4000000" cy="1000000"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="1000000"/></a:xfrm></p:grpSpPr>' +
  textSp(901, 'Grouped words', 0) +
  '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="902" name="Inner group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="500000"/><a:ext cx="4000000" cy="500000"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="500000"/></a:xfrm></p:grpSpPr>' +
  textSp(903, 'Deep words', 0) +
  '</p:grpSp></p:grpSp>'

function textSp(id: number, text: string, y: number): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="4000000" cy="500000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

const pictureFillSp = (rid: string): string =>
  '<p:sp><p:nvSpPr><p:cNvPr id="950" name="Picture fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>' +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="${rid}"/>` +
  '<a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr></p:sp>'

/**
 * Slide 1: title, picture, 2×2 table, nested group (injected), notes.
 * Slide 2: hidden, picture background, a shape with a picture fill on the same part (injected).
 * Slide 3: the slide-1 picture again (rels rewired to the same part) and an EMF picture.
 */
async function buildDeck(): Promise<Uint8Array> {
  const p = new PptxGenJS()
  const s1 = p.addSlide()
  s1.addText('Title one', { x: 1, y: 0.3, w: 6, h: 0.8 })
  s1.addImage({ data: PNG_DATA, x: 1, y: 1.3, w: 1, h: 1 })
  s1.addTable(
    [
      [{ text: 'Cell A1' }, { text: 'Cell B1' }],
      [{ text: 'Cell A2' }, { text: 'Cell B2' }],
    ],
    { x: 3, y: 1.3, w: 4 },
  )
  s1.addNotes('Note line one\nNote line two')
  const s2 = p.addSlide()
  s2.hidden = true
  s2.background = { data: PNG_DATA }
  s2.addText('Hidden slide', { x: 1, y: 2, w: 4, h: 1 })
  const s3 = p.addSlide()
  s3.addImage({ data: PNG_DATA, x: 1, y: 1, w: 1, h: 1 })
  s3.addImage({ data: PNG_DATA, x: 3, y: 1, w: 1, h: 1 })

  const zip = await JSZip.loadAsync((await p.write({ outputType: 'uint8array' })) as Uint8Array)
  const edit = async (path: string, change: (xml: string) => string): Promise<void> => {
    zip.file(path, change(await zip.file(path)!.async('string')))
  }
  await edit('ppt/slides/slide1.xml', (xml) =>
    xml.replace('</p:spTree>', `${GROUP_XML}</p:spTree>`),
  )
  const rels2 = await zip.file('ppt/slides/_rels/slide2.xml.rels')!.async('string')
  const bgRid = /Id="(rId\d+)"[^>]*Target="\.\.\/media\/[^"]+"/.exec(rels2)![1]!
  await edit('ppt/slides/slide2.xml', (xml) =>
    xml.replace('</p:spTree>', `${pictureFillSp(bgRid)}</p:spTree>`),
  )
  await edit('ppt/slides/_rels/slide3.xml.rels', (xml) =>
    xml.replace('../media/image-3-1.png', '../media/image-1-1.png'),
  )
  zip.file('ppt/media/image-3-2.png', emfBytes())
  return zip.generateAsync({ type: 'uint8array' })
}

let builtDeck: Promise<Uint8Array> | null = null
const deckBytes = (): Promise<Uint8Array> => (builtDeck ??= buildDeck())
const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, name)))

// ── Node-side reference render (real node:crypto/zlib/Buffer, no stand-ins) ─────

const NODE_RENDER = `
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const bytes = new Uint8Array(Buffer.from(Buffer.concat(chunks).toString('utf8'), 'base64'))
const { openPptx } = await import('@genoffice/pptx-engine')
const { buildRenderSlide } = await import('@genoffice/pptx-render')
const width = Number(process.argv[1])
const opened = await openPptx(bytes)
const out = opened.deck.slides.map((slide, i) =>
  buildRenderSlide(slide, opened.deck.size, { fitWidthPx: width, media: (ref) => 'media:' + ref, slideNo: i + 1 }))
process.stdout.write(JSON.stringify(out))
`

function nodeRender(bytes: Uint8Array, width: number): unknown[] {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', NODE_RENDER, String(width)],
    {
      cwd: resolve(__dirname, '..'),
      input: Buffer.from(bytes).toString('base64'),
      maxBuffer: 256 * 1024 * 1024,
    },
  )
  return JSON.parse(out.toString('utf8')) as unknown[]
}

// Element ids come from an engine counter that runs for the whole process (sp_0 in a fresh
// Node, sp_49 here after other decks): they are renamed in order of first appearance.
const ENGINE_UID = /(?<![A-Za-z0-9])(chart|cxn|gf|grp|olepic|pic|pt|sp|tbl)_[0-9a-z]+(?![0-9a-z])/g

/** JSON form with every media URL folded to one token and engine ids renumbered */
function normalized(value: unknown): RenderSlide[] {
  const ids = new Map<string, string>()
  const json = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'string' && /^(blob:|media:)/.test(v) ? '<media>' : v,
  ).replace(ENGINE_UID, (id, prefix: string) => {
    let renamed = ids.get(id)
    if (!renamed) ids.set(id, (renamed = `${prefix}_#${ids.size}`))
    return renamed
  })
  return JSON.parse(json) as RenderSlide[]
}

/** All picture nodes of a render, groups included */
function pictures(nodes: readonly RenderNode[]): Extract<RenderNode, { type: 'picture' }>[] {
  return nodes.flatMap((n) =>
    n.type === 'picture' ? [n] : n.type === 'group' ? pictures(n.children) : [],
  )
}

// ── tests ───────────────────────────────────────────────────────────

describe('display MIME', () => {
  const samples: [string, Uint8Array][] = [
    ['a.png', Uint8Array.from(Buffer.from(PNG_B64, 'base64'))],
    ['a.jpg', jpegWithOrientation(6)],
    ['a.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ['a.bmp', new Uint8Array([0x42, 0x4d, 0, 0])],
    ['a.webp', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
    ['a.tif', new Uint8Array([0x49, 0x49, 0x2a, 0x00])],
    ['a.tiff', new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])],
    ['mislabeled.png', emfBytes()],
    ['a.wmf', new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0])],
    ['a.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['a.emf', new Uint8Array([1, 2, 3])],
    ['a.WMF', new Uint8Array([1, 2, 3])],
    ['noext', new Uint8Array([1, 2, 3])],
    ['a.xyz', new Uint8Array(0)],
  ]

  it.each(samples)('decides %s the way the PC slides app does', (ref, bytes) => {
    expect(displayMime(ref, bytes)).toBe(pcDisplayMime(ref, bytes))
  })

  it('lets the magic bytes win over the extension', () => {
    expect(sniffImageMime(emfBytes())).toBe('image/x-emf')
    expect(displayMime('ppt/media/x.png', emfBytes())).toBe('image/x-emf')
  })
})

describe('media store', () => {
  const parts = new Map<string, Uint8Array>([
    ['ppt/media/a.png', Uint8Array.from(Buffer.from(PNG_B64, 'base64'))],
    ['ppt/media/b.jpg', jpegWithOrientation(6)],
    ['ppt/media/c.emf', emfBytes()],
    ['ppt/media/d.wmf', new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0])],
  ])
  const source = { readBytes: (path: string) => parts.get(path) ?? null }

  it('serves each part as a blob of its display MIME, one URL per part', async () => {
    const store = createSlideMediaStore(source)
    const media = store.resolverFor(0)
    const png = media('ppt/media/a.png')!
    expect(png).toMatch(/^blob:/)
    expect(media('ppt/media/a.png')).toBe(png)
    expect(store.resolverFor(1)('ppt/media/a.png')).toBe(png)
    expect(blobs.get(png)!.type).toBe('image/png')
    expect(await blobBytes(blobs.get(png)!)).toEqual(parts.get('ppt/media/a.png'))
    expect(media('ppt/media/missing.png')).toBeUndefined()
    expect(media('')).toBeUndefined()
  })

  it('neutralizes the JPEG orientation in the served copy, not in the archive', async () => {
    const original = Uint8Array.from(parts.get('ppt/media/b.jpg')!)
    const url = createSlideMediaStore(source).resolverFor(0)('ppt/media/b.jpg')!
    const served = await blobBytes(blobs.get(url)!)
    expect(blobs.get(url)!.type).toBe('image/jpeg')
    expect(served).not.toEqual(original)
    expect([...served].filter((b, i) => b !== original[i])).toEqual([1])
    expect(parts.get('ppt/media/b.jpg')).toEqual(original)
  })

  it('marks EMF and WMF URLs so the image loader skips them', () => {
    const media = createSlideMediaStore(source).resolverFor(0)
    const emf = media('ppt/media/c.emf')!
    const wmf = media('ppt/media/d.wmf')!
    expect(isMetafileUrl(emf)).toBe(true)
    expect(isMetafileUrl(wmf)).toBe(true)
    expect(isMetafileUrl(media('ppt/media/a.png')!)).toBe(false)
    expect(blobs.get(baseUrl(emf))!.type).toBe('image/x-emf')
    expect(blobs.get(baseUrl(wmf))!.type).toBe('image/x-wmf')
  })

  it('revokes a shared URL only when its last slide lets go', () => {
    const store = createSlideMediaStore(source)
    const shared = store.resolverFor(0)('ppt/media/a.png')!
    const own = store.resolverFor(0)('ppt/media/c.emf')!
    expect(store.resolverFor(1)('ppt/media/a.png')).toBe(shared)
    store.release(0)
    expect(revoked).toEqual([baseUrl(own)])
    expect(isLive(shared)).toBe(true)
    store.release(0)
    expect(revoked).toHaveLength(1)
    store.release(1)
    expect(revoked).toEqual([baseUrl(own), shared])
    expect(store.liveUrls()).toEqual([])
    // A later render gets a fresh URL
    const again = store.resolverFor(2)('ppt/media/a.png')!
    expect(again).not.toBe(shared)
    expect(isLive(again)).toBe(true)
  })

  it('revokes everything on dispose and serves nothing after', () => {
    const store = createSlideMediaStore(source)
    const urls = ['ppt/media/a.png', 'ppt/media/b.jpg', 'ppt/media/c.emf'].map((ref, i) =>
      store.resolverFor(i)(ref)!,
    )
    store.dispose()
    expect(revoked.sort()).toEqual(urls.map(baseUrl).sort())
    expect(store.resolverFor(0)('ppt/media/a.png')).toBeUndefined()
    expect(blobs.size).toBe(0)
  })
})

describe('image URLs of a render tree', () => {
  const box = { x: 0, y: 0, w: 10, h: 10, rotationDeg: 0, flipH: false, flipV: false }
  const img = (url: string): RenderFill => ({ kind: 'image', dataUrl: url, mode: 'stretch' })
  const text = (url: string) => ({ lines: [{ runs: [{ text: '', image: url }] }] })
  const node = (n: Record<string, unknown>): RenderNode =>
    ({ id: `r_${String(n.type)}`, sourceId: 's', box, ...n }) as unknown as RenderNode
  const slideOf = (nodes: RenderNode[], background: RenderFill = { kind: 'none' }): RenderSlide =>
    ({ widthPx: 100, heightPx: 75, scale: 1, background, nodes }) as RenderSlide

  it.each<[string, RenderSlide, string[]]>([
    ['slide background', slideOf([], img('u:bg')), ['u:bg']],
    ['picture node', slideOf([node({ type: 'picture', dataUrl: 'u:pic' })]), ['u:pic']],
    [
      'picture backdrop fill',
      slideOf([node({ type: 'picture', fill: img('u:backdrop') })]),
      ['u:backdrop'],
    ],
    [
      'shape picture fill and overlay',
      slideOf([node({ type: 'shape', fill: img('u:fill'), fillOverlay: img('u:overlay') })]),
      ['u:fill', 'u:overlay'],
    ],
    [
      'picture bullet',
      slideOf([node({ type: 'text', fill: { kind: 'none' }, text: text('u:bullet') })]),
      ['u:bullet'],
    ],
    [
      'table background, cell fill and cell bullet',
      slideOf([
        node({
          type: 'table',
          bgFill: img('u:tblbg'),
          cells: [{ fill: img('u:cell'), text: text('u:cellbullet') }, { fill: { kind: 'none' } }],
        }),
      ]),
      ['u:tblbg', 'u:cell', 'u:cellbullet'],
    ],
    [
      'chart background, plot area and bar fills',
      slideOf([
        node({
          type: 'chart',
          bgFill: img('u:chartbg'),
          plotRect: { x: 0, y: 0, w: 1, h: 1, fill: img('u:plot') },
          bars: [{ fill: img('u:bar1') }, { color: '#000' }, { fill: img('u:bar2') }],
        }),
      ]),
      ['u:chartbg', 'u:plot', 'u:bar1', 'u:bar2'],
    ],
    [
      'group children at any depth',
      slideOf([
        node({
          type: 'group',
          children: [
            node({ type: 'picture', dataUrl: 'u:g1' }),
            node({ type: 'group', children: [node({ type: 'shape', fill: img('u:g2') })] }),
          ],
        }),
      ]),
      ['u:g1', 'u:g2'],
    ],
  ])('collects the %s', (_name, slide, expected) => {
    expect(slideImageUrls(slide)).toEqual(expected)
  })

  it('lists each URL once and ignores other fills and chips', () => {
    const slide = slideOf(
      [
        node({ type: 'picture', dataUrl: 'u:same' }),
        node({ type: 'shape', fill: { kind: 'solid', color: '#fff' } }),
        node({ type: 'shape', fill: img('u:same') }),
        node({ type: 'shape', fill: { kind: 'image', mode: 'stretch' } }),
        node({ type: 'placeholder-chip', kind: 'ole', label: 'OLE' }),
      ],
      img('u:same'),
    )
    expect(slideImageUrls(slide)).toEqual(['u:same'])
  })
})

describe('image loader', () => {
  const created: HTMLImageElement[] = []
  beforeEach(() => {
    created.length = 0
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = real(tag)
      if (tag === 'img') created.push(el as HTMLImageElement)
      return el
    }) as typeof document.createElement)
  })
  afterEach(() => vi.restoreAllMocks())

  const imgFor = (url: string): HTMLImageElement => created.find((i) => i.src === url)!

  it('reports a growing map as images load, skipping metafiles and failures', () => {
    const calls: string[][] = []
    loadSlideImages(
      ['blob:test/a', 'blob:test/b#ieum-metafile', 'blob:test/c', 'blob:test/a', 'blob:test/d'],
      (images) => calls.push([...images.keys()]),
    )
    expect(created.map((i) => i.src)).toEqual(['blob:test/a', 'blob:test/c', 'blob:test/d'])
    imgFor('blob:test/c').dispatchEvent(new Event('load'))
    imgFor('blob:test/d').dispatchEvent(new Event('error'))
    imgFor('blob:test/a').dispatchEvent(new Event('load'))
    expect(calls).toEqual([['blob:test/c'], ['blob:test/c', 'blob:test/a']])
  })

  it('stops reporting once cancelled', () => {
    const onLoaded = vi.fn()
    const load = loadSlideImages(['blob:test/a', 'blob:test/b'], onLoaded)
    const [a, b] = created
    a!.dispatchEvent(new Event('load'))
    load.cancel()
    b!.dispatchEvent(new Event('load'))
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(b!.hasAttribute('src')).toBe(false)
    load.cancel()
  })
})

describe('opening a deck', () => {
  it.each(FIXTURE_DECKS)(
    'opens %s with every slide',
    async (name) => {
      const bytes = fixtureBytes(name)
      const zip = await JSZip.loadAsync(bytes)
      const slideParts = Object.keys(zip.files).filter((p) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(p),
      )
      const deck = await openDeck(bytes)
      expect(deck.slideCount).toBe(slideParts.length)
      expect(deck.size.cx).toBeGreaterThan(0)
      for (let i = 0; i < deck.slideCount; i++) {
        expect(deck.indexOfPath(deck.slidePath(i))).toBe(i)
      }
      expect(deck.indexOfPath('ppt/slides/none.xml')).toBe(-1)
      deck.dispose()
    },
    SLOW,
  )

  it('rejects garbage bytes as a damaged deck', async () => {
    const err = await openDeck(new TextEncoder().encode('this is not a presentation')).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PptxOpenError)
    expect((err as PptxOpenError).reason).toBe('damaged')
  })

  it('rejects a zip without a presentation as damaged', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'hi')
    const err = await openDeck(await zip.generateAsync({ type: 'uint8array' })).catch(
      (e: unknown) => e,
    )
    expect((err as PptxOpenError).reason).toBe('damaged')
  })

  it(
    'rejects a package over the engine part limit as too large',
    async () => {
      const zip = new JSZip()
      for (let i = 0; i <= 10_000; i++) zip.file(`p/${i}`, '')
      const err = await openDeck(await zip.generateAsync({ type: 'uint8array' })).catch(
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(PptxOpenError)
      expect((err as PptxOpenError).reason).toBe('too-large')
    },
    SLOW,
  )

  it(
    'does not depend on the input bytes after opening',
    async () => {
      const bytes = Uint8Array.from(await deckBytes())
      const deck = await openDeck(bytes)
      bytes.fill(0)
      const render = deck.renderSlide(0, 640)
      const url = pictures(render.nodes)[0]!.dataUrl!
      expect(await blobBytes(blobs.get(url)!)).toEqual(
        Uint8Array.from(Buffer.from(PNG_B64, 'base64')),
      )
      expect(deck.slideNotes(0)).toContain('Note line one')
      deck.dispose()
    },
    SLOW,
  )
})

describe('render data', () => {
  const WIDTH = 640

  it.each([...FIXTURE_DECKS, 'built deck'])(
    'equals what Node builds for every slide of %s',
    async (name) => {
      const bytes = name === 'built deck' ? await deckBytes() : fixtureBytes(name)
      const expected = nodeRender(bytes, WIDTH)
      const deck = await openDeck(bytes)
      const ours = normalized(
        Array.from({ length: deck.slideCount }, (_, i) => deck.renderSlide(i, WIDTH)),
      )
      const theirs = normalized(expected)
      expect(ours).toHaveLength(theirs.length)
      // Spot checks first (clearer failures), then the whole tree
      for (const [i, slide] of ours.entries()) {
        const ref = theirs[i]!
        expect(slide.nodes.map((n) => n.id)).toEqual(ref.nodes.map((n) => n.id))
        expect(slide.nodes.map((n) => [n.box.x, n.box.y, n.box.w, n.box.h])).toEqual(
          ref.nodes.map((n) => [n.box.x, n.box.y, n.box.w, n.box.h]),
        )
        expect(slide.partPath).toBe(ref.partPath)
      }
      expect(ours).toEqual(theirs)
      deck.dispose()
    },
    SLOW,
  )

  it(
    'is cached per slide and width, and rebuilt after release',
    async () => {
      const deck = await openDeck(await deckBytes())
      const first = deck.renderSlide(0, WIDTH)
      expect(deck.renderSlide(0, WIDTH)).toBe(first)
      const wide = deck.renderSlide(0, WIDTH * 2)
      expect(wide).not.toBe(first)
      expect(wide.widthPx).toBe(WIDTH * 2)
      deck.releaseSlide(0)
      expect(deck.renderSlide(0, WIDTH * 2)).not.toBe(wide)
      expect(() => deck.renderSlide(99, WIDTH)).toThrow(RangeError)
      expect(() => deck.renderSlide(-1, WIDTH)).toThrow(RangeError)
      deck.dispose()
    },
    SLOW,
  )
})

describe('a built deck', () => {
  let deck: PptxDeck
  beforeEach(async () => {
    deck = await openDeck(await deckBytes())
  }, SLOW)
  afterEach(() => deck.dispose())

  it('has three slides, the second hidden', () => {
    expect(deck.slideCount).toBe(3)
    expect([0, 1, 2].map((i) => deck.isHidden(i))).toEqual([false, true, false])
    expect(deck.renderSlide(1, 320).hidden).toBe(true)
  })

  it('reads the speaker notes', () => {
    expect(deck.slideNotes(0)).toBe('Note line one\nNote line two')
    expect(deck.slideNotes(1)).toBe('')
  })

  it('gives the text of boxes, table cells and nested groups', () => {
    const text = deck.slideText(0).split('\n')
    expect(text).toEqual(
      expect.arrayContaining([
        'Title one',
        'Cell A1',
        'Cell B1',
        'Cell A2',
        'Cell B2',
        'Grouped words',
        'Deep words',
      ]),
    )
    expect(text.indexOf('Cell A1')).toBeLessThan(text.indexOf('Cell B2'))
    expect(deck.slideText(1)).toBe('Hidden slide')
    expect(deck.slideText(2)).toBe('')
  })

  it('collects the picture of a slide and its background and picture fill', () => {
    const s1 = deck.renderSlide(0, 320)
    const s2 = deck.renderSlide(1, 320)
    const s1Urls = slideImageUrls(s1)
    expect(s1Urls).toEqual([pictures(s1.nodes)[0]!.dataUrl])
    const bg = s2.background
    expect(bg.kind).toBe('image')
    const bgUrl = (bg as Extract<RenderFill, { kind: 'image' }>).dataUrl!
    const fillNode = s2.nodes.find((n) => n.type === 'shape' && n.fill.kind === 'image')
    expect(fillNode).toBeDefined()
    // Background and the shape's picture fill use the same part: one URL
    expect(slideImageUrls(s2)).toEqual([bgUrl])
  })

  it('marks the EMF picture so it is not loaded', () => {
    const urls = slideImageUrls(deck.renderSlide(2, 320))
    expect(urls).toHaveLength(2)
    expect(urls.filter(isMetafileUrl)).toHaveLength(1)
  })

  it('keeps a picture two slides share until both are released', () => {
    const s1 = deck.renderSlide(0, 320)
    const s3 = deck.renderSlide(2, 320)
    const shared = pictures(s1.nodes)[0]!.dataUrl!
    const s3Urls = slideImageUrls(s3)
    expect(s3Urls).toContain(shared)
    const emf = s3Urls.find(isMetafileUrl)!
    const bg = slideImageUrls(deck.renderSlide(1, 320))[0]!

    deck.releaseSlide(2)
    expect(isLive(emf)).toBe(false)
    expect(isLive(shared)).toBe(true)
    expect(isLive(bg)).toBe(true)

    deck.releaseSlide(0)
    expect(isLive(shared)).toBe(false)
    expect(isLive(bg)).toBe(true)
    expect(revoked).toEqual([baseUrl(emf), shared])
  })

  it('revokes every URL on dispose and refuses later calls', () => {
    for (let i = 0; i < deck.slideCount; i++) deck.renderSlide(i, 320)
    const live = [...blobs.keys()]
    expect(live.length).toBeGreaterThan(0)
    deck.dispose()
    expect(blobs.size).toBe(0)
    expect(revoked.sort()).toEqual(live.sort())
    expect(() => deck.renderSlide(0, 320)).toThrow(/disposed/)
    expect(() => deck.slideNotes(0)).toThrow(/disposed/)
    deck.releaseSlide(0)
    deck.dispose()
  })
})
