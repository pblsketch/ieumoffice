// @vitest-environment node
// HTML → Word and ODT in a real Chromium (spec 5.7, 9): the export module is bundled the way the
// app bundles it (Vite with the track plugins) and run in a headless test browser page, which has
// no Node globals, like the phone's web view. Skipped when Playwright's Chromium is not installed;
// nothing is downloaded. (jsdom has no layout, so web-html-export-driver only covers the plumbing.)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { trackAlias, trackDefine, trackPlugins } from '../config/tracks'

const CHROMIUM = (() => {
  try {
    const path = chromium.executablePath()
    return existsSync(path) ? path : null
  } catch {
    return null
  }
})()

const here = dirname(fileURLToPath(import.meta.url))
const slash = (path: string) => path.replace(/\\/g, '/')
const HTML_FOLDER = slash(resolve(here, '../src/renderer/editors/html'))

const ENTRY = `
import { htmlToDocx, htmlToOdt } from '${HTML_FOLDER}/htmlExport'
import { buildExportCopy, mapDocument } from '${HTML_FOLDER}/htmlPreview'

function base64(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return btoa(text)
}

window.runExport = async (source, format) => {
  const html = buildExportCopy(source, mapDocument(source, 0, null))
  const result = format === 'odt' ? await htmlToOdt(html) : await htmlToDocx(html)
  return {
    bytes: base64(result.bytes),
    lostCaptures: result.lostCaptures,
    report: result.report ?? null,
    framesLeft: document.querySelectorAll('iframe').length,
    nodeGlobals: typeof Buffer !== 'undefined' || typeof process !== 'undefined',
  }
}
window.ready = true
`

const STRUCTURE = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>보고서</title>
<style>body{font-family:sans-serif;margin:40px} table{border-collapse:collapse} td,th{border:1px solid #888;padding:4px 8px}</style></head>
<body>
<h1>분기 보고서 제목</h1>
<h2>첫째 절</h2>
<p>이 문단은 <strong>굵은 글</strong>을 담고 있습니다.</p>
<ul><li>첫 항목</li><li>둘째 항목</li></ul>
<table><thead><tr><th>이름</th><th>값</th></tr></thead>
<tbody><tr><td>사과</td><td>12</td></tr><tr><td>배</td><td>34</td></tr></tbody></table>
<p>마지막 문단.</p>
</body></html>`

const VISUAL = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Visual</title>
<style>
body{background:#eef2f7;font-family:sans-serif;margin:32px}
.hero{background:linear-gradient(135deg,#4f46e5,#06b6d4);color:white;padding:40px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.card{background:white;border-radius:12px;padding:16px;margin-top:16px}
</style></head>
<body>
<div class="hero"><h1>Gradient Hero Heading</h1><p>Hero tagline</p></div>
<div class="card"><h2>Card Heading</h2><p>Card paragraph text.</p>
<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" rx="20" fill="#3355aa"/><circle cx="100" cy="50" r="30" fill="#ffcc00"/></svg>
<p><img alt="red dot" width="40" height="40" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="></p>
</div>
<p>Closing paragraph after visuals.</p>
</body></html>`

const SCRIPTED = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Script</title>
<meta http-equiv="refresh" content="0;url=https://example.com/">
<script>document.addEventListener('DOMContentLoaded',function(){document.body.insertAdjacentHTML('beforeend','<p>SCRIPT-RAN-MARKER</p>')});window.parent.__pwned = true;</script>
</head>
<body>
<h1>Static heading stays</h1>
<p>Static paragraph.</p>
<img src="data:," onerror="document.body.insertAdjacentHTML('beforeend','<p>ONERROR-RAN-MARKER</p>');window.parent.__pwned=true" alt="broken alt">
<script>document.write('<p>WRITE-RAN-MARKER</p>')</script>
</body></html>`

interface ExportRun {
  readonly bytes: string
  readonly lostCaptures: number
  readonly report: Array<{ kind: string; feature: string; count: number }> | null
  readonly framesLeft: number
  readonly nodeGlobals: boolean
}

let work = ''
let server: Server | null = null
let browser: Browser | null = null
let page: Page | null = null

async function run(source: string, format: 'docx' | 'odt') {
  const result = await page!.evaluate(
    ([html, kind]) => (window as any).runExport(html, kind) as Promise<ExportRun>,
    [source, format] as const,
  )
  const zip = await JSZip.loadAsync(Buffer.from(result.bytes, 'base64'))
  const part = format === 'docx' ? 'word/document.xml' : 'content.xml'
  const xml = await zip.file(part)!.async('string')
  const media = Object.keys(zip.files).filter(
    (name) => /^(word\/media|Pictures)\//.test(name) && !name.endsWith('/'),
  )
  return { ...result, xml, media }
}

describe.skipIf(!CHROMIUM)('HTML export in a real Chromium', () => {
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'web-html-export-'))
    writeFileSync(
      join(work, 'index.html'),
      '<!doctype html><meta charset="utf-8"><script type="module" src="./entry.js"></script>',
    )
    writeFileSync(join(work, 'entry.js'), ENTRY)
    const { build } = await import('vite')
    await build({
      configFile: false,
      root: work,
      base: './',
      logLevel: 'silent',
      plugins: trackPlugins,
      resolve: { alias: trackAlias },
      define: trackDefine,
      build: { outDir: join(work, 'dist'), emptyOutDir: true, target: 'es2022' },
    })
    const dist = join(work, 'dist')
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' }
    server = createServer((req, res) => {
      const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
      try {
        const body = readFileSync(path)
        res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    browser = await chromium.launch({ executablePath: CHROMIUM!, headless: true })
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
    await page.goto(`http://127.0.0.1:${port}/index.html`)
    await page.waitForFunction(() => (window as any).ready === true)
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()))
    if (work) rmSync(work, { recursive: true, force: true })
  })

  it('runs where there are no Node globals, and leaves no frame behind', async () => {
    const result = await run(STRUCTURE, 'docx')
    expect(result.nodeGlobals).toBe(false)
    expect(result.framesLeft).toBe(0)
  }, 60_000)

  it('carries headings, paragraphs, lists and tables into Word and ODT', async () => {
    const docx = await run(STRUCTURE, 'docx')
    for (const text of [
      '분기 보고서 제목',
      '첫째 절',
      '굵은 글',
      '첫 항목',
      '사과',
      '34',
      '마지막 문단.',
    ]) {
      expect(docx.xml).toContain(text)
    }
    expect(docx.xml).toContain('<w:tbl>')
    expect(docx.lostCaptures).toBe(0)

    const odt = await run(STRUCTURE, 'odt')
    expect(odt.xml).toContain('분기 보고서 제목')
    expect(odt.xml).toContain('<table:table ')
    expect(odt.report).toEqual([])
  }, 60_000)

  it('keeps the text around pictures, draws plain images, and counts what it cannot capture', async () => {
    const docx = await run(VISUAL, 'docx')
    expect(docx.xml).toContain('Card Heading')
    expect(docx.xml).toContain('Closing paragraph after visuals.')
    // the gradient banner and the drawing have no capture on the phone (owner, 11-26 Q3)
    expect(docx.lostCaptures).toBeGreaterThan(0)
    // the data: image is drawn from its pixels; the page color is painted as a PNG
    expect(docx.media.length).toBeGreaterThanOrEqual(2)
    expect(docx.xml).toContain('<w:background ')

    const odt = await run(VISUAL, 'odt')
    expect(odt.xml).toContain('Card Heading')
    expect(odt.lostCaptures).toBe(docx.lostCaptures)
    expect(odt.report?.some((item) => item.feature === 'page_color')).toBe(true)
  }, 60_000)

  it('never runs the document’s scripts, handlers or refresh', async () => {
    const docx = await run(SCRIPTED, 'docx')
    expect(docx.xml).toContain('Static heading stays')
    expect(docx.xml).toContain('Static paragraph.')
    for (const marker of ['SCRIPT-RAN-MARKER', 'ONERROR-RAN-MARKER', 'WRITE-RAN-MARKER']) {
      expect(docx.xml).not.toContain(marker)
    }
    expect(await page!.evaluate(() => (window as any).__pwned === true)).toBe(false)
    expect(page!.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/index\.html$/)
  }, 60_000)
})
