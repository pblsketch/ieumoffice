import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { convertHtmlToDocx } from '@genoffice/html2docx'
import {
  EXPORT_DOCUMENT_URL,
  EXPORT_SANDBOX,
  SandboxFrameDriver,
} from '../src/renderer/editors/html/htmlExportDriver'
import { buildExportCopy, mapDocument } from '../src/renderer/editors/html/htmlPreview'
import zlib, {
  Buffer as PngBuffer,
  crc32,
  deflateSync,
} from '../src/renderer/editors/html/html2docxNode'
import { Packer } from '../src/renderer/editors/html/html2docxPacker'

// jsdom does not load srcdoc: in this file, setting it writes the text into the frame's own
// document (jsdom runs no scripts) once jsdom's own about:blank load is over, then fires load,
// as a browser would. jsdom's about:blank load is kept from the driver.
const srcdocDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')
beforeAll(() => {
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return this.getAttribute('srcdoc') ?? ''
    },
    set(this: HTMLIFrameElement, value: string) {
      this.setAttribute('srcdoc', value)
      this.addEventListener(
        'load',
        (event) => {
          event.stopImmediatePropagation()
          const doc = this.contentDocument!
          doc.open()
          doc.write(value)
          doc.close()
          // jsdom has no font loading API; a browser's document always has one
          Object.defineProperty(doc, 'fonts', {
            configurable: true,
            value: { ready: Promise.resolve() },
          })
          setTimeout(() => this.dispatchEvent(new Event('load')), 0)
        },
        { capture: true, once: true },
      )
    },
  })
})
afterAll(() => {
  if (srcdocDescriptor) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', srcdocDescriptor)
  }
})

const drivers: SandboxFrameDriver[] = []
afterEach(async () => {
  while (drivers.length > 0) await drivers.pop()?.close()
  delete (window as unknown as Record<string, unknown>).__probe
})

async function loaded(html: string): Promise<SandboxFrameDriver> {
  const driver = new SandboxFrameDriver({ html })
  drivers.push(driver)
  await driver.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
  await driver.goto(EXPORT_DOCUMENT_URL, { timeoutMs: 5000 })
  return driver
}

const PAGE = `<!DOCTYPE html><html><head><title>안쪽 문서</title></head><body>
<h1 id="frame">안쪽 제목</h1><div id="arguments">a</div><div id="timers">t</div><div id="setTimeout">s</div>
<p>문단</p></body></html>`

describe('the export frame', () => {
  it('loads the given document into a hidden frame sandboxed with allow-same-origin only', async () => {
    const driver = await loaded(PAGE)
    const frame = driver.frameElement
    expect(frame).not.toBeNull()
    expect(EXPORT_SANDBOX).toBe('allow-same-origin')
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toBe(PAGE)
    expect(frame?.style.width).toBe('794px')
    expect(frame?.style.height).toBe('1123px')
    const holder = document.querySelector<HTMLElement>(
      '[data-testid="web-html-export-frame-holder"]',
    )
    expect(holder?.getAttribute('aria-hidden')).toBe('true')
    expect(holder?.style.opacity).toBe('0')
    expect(holder?.style.pointerEvents).toBe('none')
    expect(holder?.contains(frame!)).toBe(true)
  })

  it('loads nothing but the document it was given', async () => {
    const driver = new SandboxFrameDriver({ html: PAGE })
    drivers.push(driver)
    await expect(driver.goto('https://example.com/', { timeoutMs: 100 })).rejects.toThrow()
    await expect(driver.goto('file:///etc/passwd', { timeoutMs: 100 })).rejects.toThrow()
    expect(driver.frameElement).toBeNull()
  })

  it('resizes the frame when the converter changes the viewport', async () => {
    const driver = await loaded(PAGE)
    await driver.setViewport({ width: 1024, height: 1448, deviceScaleFactor: 2 })
    expect(driver.frameElement?.style.width).toBe('1024px')
    await driver.goto(EXPORT_DOCUMENT_URL, { timeoutMs: 5000 })
    expect(document.querySelectorAll('[data-testid="web-html-export-frame"]')).toHaveLength(1)
    expect(driver.frameElement?.style.width).toBe('1024px')
  })

  it('runs the converter’s code against the frame’s document and window', async () => {
    const driver = await loaded(PAGE)
    const frameWindow = driver.frameElement!.contentWindow!
    expect(await driver.evaluate(() => document.title)).toBe('안쪽 문서')
    expect(await driver.evaluate(() => document.querySelector('h1')?.textContent)).toBe('안쪽 제목')
    expect(document.querySelector('h1')).toBeNull()
    expect(
      await driver.evaluate((selector: string) => document.querySelectorAll(selector).length, 'p'),
    ).toBe(1)
    // a string is an expression, as in the desktop driver
    expect(await driver.evaluate<number>('document.body.children.length')).toBe(5)
    // bare globals are the frame's: its constructors, getComputedStyle, globalThis and window
    expect(await driver.evaluate(() => document.body instanceof HTMLElement)).toBe(true)
    expect(
      await driver.evaluate(() => document.body.firstElementChild!.nodeType === Node.ELEMENT_NODE),
    ).toBe(true)
    expect(await driver.evaluate(() => typeof getComputedStyle(document.body).display)).toBe(
      'string',
    )
    await driver.evaluate(() => {
      ;(globalThis as any).__probe = 'g'
      ;(window as any).__probe2 = 'w'
    })
    expect((frameWindow as any).__probe).toBe('g')
    expect((frameWindow as any).__probe2).toBe('w')
    expect((window as any).__probe).toBeUndefined()
  })

  it('injects helper scripts into the frame’s globals, not this window’s', async () => {
    const driver = await loaded(PAGE)
    await driver.addScript(
      '(function install(global) { global.__probe = { twice: (n) => n * 2 } })(globalThis)',
    )
    expect((driver.frameElement!.contentWindow as any).__probe.twice(2)).toBe(4)
    expect((window as any).__probe).toBeUndefined()
    expect(await driver.evaluate<number>('globalThis.__probe.twice(21)')).toBe(42)
  })

  it('uses this window’s timers and waits for promises', async () => {
    const driver = await loaded(PAGE)
    const value = await driver.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return document.querySelectorAll('div').length
    })
    expect(value).toBe(3)
  })

  it('element ids in the document do not stand in for the driver’s own names', async () => {
    // PAGE has elements named frame, arguments, timers and setTimeout
    const driver = await loaded(PAGE)
    expect(await driver.evaluate((n: number) => n + 1, 1)).toBe(2)
    expect(
      await driver.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return 'waited'
      }),
    ).toBe('waited')
  })

  it('hands back copies, and nothing for values that cannot be copied', async () => {
    const driver = await loaded(PAGE)
    const ir = await driver.evaluate(() => [{ type: 'para', runs: [{ text: 'x' }] }])
    expect(ir).toEqual([{ type: 'para', runs: [{ text: 'x' }] }])
    const frameBody = driver.frameElement!.contentDocument!.body
    expect(await driver.evaluate(() => document.body)).not.toBe(frameBody)
  })

  it('has no page capture: a clip shot fails and counts, a missing element is no loss', async () => {
    const driver = await loaded(PAGE)
    await expect(
      driver.screenshot({ clip: { x: 0, y: 0, width: 10, height: 10 } }),
    ).rejects.toThrow()
    expect(driver.lostCaptures).toBe(1)
    expect(await driver.screenshotElement('#nothing', {})).toBeNull()
    expect(driver.lostCaptures).toBe(1)
    expect(await driver.elementExists('#frame')).toBe(true)
    expect(await driver.elementExists('#nothing')).toBe(false)
  })

  it('init scripts are ignored and closing removes the frame', async () => {
    const driver = await loaded(PAGE)
    await driver.addInitScript('globalThis.__probe = 1')
    expect((driver.frameElement!.contentWindow as any).__probe).toBeUndefined()
    await driver.close()
    expect(document.querySelector('[data-testid="web-html-export-frame"]')).toBeNull()
    expect(document.querySelector('[data-testid="web-html-export-frame-holder"]')).toBeNull()
    await expect(driver.goto(EXPORT_DOCUMENT_URL, { timeoutMs: 100 })).rejects.toThrow()
  })
})

describe('the converter over the export frame (jsdom: no layout, plumbing only)', () => {
  it('runs html2docx end to end into a Word document (text needs layout: see the Chromium test)', async () => {
    const source = `<!DOCTYPE html><html><head><title>t</title>
<script>document.write('<p>SCRIPT-RAN</p>')</script></head>
<body><h1>보고서 제목</h1><p>본문 문단</p><table><tr><td>칸 하나</td></tr></table></body></html>`
    const html = buildExportCopy(source, mapDocument(source, 0, null))
    const driver = new SandboxFrameDriver({ html })
    drivers.push(driver)
    const { docx } = await convertHtmlToDocx({ url: EXPORT_DOCUMENT_URL }, driver)
    const zip = await JSZip.loadAsync(docx)
    const xml = await zip.file('word/document.xml')!.async('string')
    // jsdom measures every box as 0×0, so the extractor sees nothing visible: the document is
    // empty here, and the real result is checked in a real browser (web-html-export-chromium)
    expect(xml).toContain('<w:body>')
    expect(xml).not.toContain('SCRIPT-RAN')
    // the converter closes nothing; the caller does
    expect(driver.frameElement).not.toBeNull()
  }, 60_000)
})

describe('the export copy', () => {
  it('is the source with the preview policy and no element ids', () => {
    const source =
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=https://e.com"></head><body><p>a</p></body></html>'
    const copy = buildExportCopy(source, mapDocument(source, 0, null))
    expect(copy).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(copy).toContain("script-src 'none'")
    expect(copy).not.toContain('data-gx-sid')
    expect(copy).not.toMatch(/\shttp-equiv="refresh"/)
    expect(copy).toContain('data-gx-http-equiv="refresh"')
    expect(copy).toContain('<p>a</p>')
  })
})

describe('the browser stand-ins for html2docx’s Node calls', () => {
  it('crc32 and a stored zlib stream match Node', async () => {
    const { crc32: nodeCrc32, inflateSync } = await import('node:zlib')
    const data = new Uint8Array([0, 0x12, 0x34, 0x56])
    expect(crc32(data)).toBe(nodeCrc32(data))
    expect(Array.from(inflateSync(deflateSync(data)))).toEqual(Array.from(data))
    const big = new Uint8Array(70_000).map((_, i) => i % 251)
    expect(Array.from(inflateSync(deflateSync(big)))).toEqual(Array.from(big))
    expect(zlib.crc32).toBe(crc32)
  })

  it('the Buffer calls of the page-color PNG behave as Node’s', () => {
    const type = PngBuffer.from('IHDR', 'ascii')
    expect(Array.from(type)).toEqual([73, 72, 68, 82])
    const body = PngBuffer.concat([type, PngBuffer.from([1, 2])])
    const out = PngBuffer.alloc(body.length + 8)
    out.writeUInt32BE(0x01020304, 0)
    body.copy(out, 4)
    expect(Array.from(out.subarray(0, 10))).toEqual([1, 2, 3, 4, 73, 72, 68, 82, 1, 2])
  })

  it('packs a Word document as bytes without Node buffers', async () => {
    const { Document, Paragraph } = await import('docx')
    const bytes = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph('x')] }] }),
    )
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x50, 0x4b])
  })
})

describe('no HTML editor file lets document scripts run', () => {
  it('the export files name no sandbox but the preview’s', () => {
    const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/editors/html')
    const files = readdirSync(folder).filter((name) => /^(htmlExport|html2docx)/.test(name))
    expect(files.length).toBeGreaterThanOrEqual(4)
    for (const name of files) {
      const text = readFileSync(join(folder, name), 'utf8')
      expect(text, name).not.toMatch(/allow-(scripts|forms|popups|top-navigation)/)
    }
  })
})
