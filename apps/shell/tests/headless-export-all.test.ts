import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HEADLESS_PDF_EXTENSIONS,
  headlessModuleFor,
  type HeadlessExportRequest,
} from '@genoffice/electron-utils'
import { openEpub } from '@genoffice/epub-engine'
import JSZip from 'jszip'
import { runExporterWithLegacyConversion, validateHeadlessPaths } from '../src/main/headless-export'
import {
  buildHeadlessExportArgs,
  parseHeadlessJsonEnvelope,
} from '../src/main/pdf-tools/headless-runner'
import { buildEpubPrintHtml } from '../../epub/src/main/epub-headless'

const requestFor = (input: string, outPath = '/out/result.pdf'): HeadlessExportRequest => ({
  input,
  targetFormat: 'pdf',
  outPath,
  json: true,
})

describe('headless all-format PDF export routing', () => {
  it('routes every supported document extension to its editor module and rejects .odp', () => {
    const expected: Record<string, string> = {
      '.docx': 'docs',
      '.doc': 'docs',
      '.odt': 'docs',
      '.xlsx': 'sheets',
      '.xlsm': 'sheets',
      '.xls': 'sheets',
      '.ods': 'sheets',
      '.csv': 'sheets',
      '.tsv': 'sheets',
      '.pptx': 'slides',
      '.ppt': 'slides',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.txt': 'markdown',
      '.html': 'html',
      '.htm': 'html',
      '.hwp': 'hwp',
      '.hwpx': 'hwp',
      '.drawio': 'diagram',
      '.dio': 'diagram',
      '.drawio.svg': 'diagram',
      '.drawio.png': 'diagram',
      '.whiteboard': 'whiteboard',
      '.xmind': 'mindmap',
      '.mm': 'mindmap',
      '.epub': 'epub',
    }
    const outDir = resolve('/out')
    const outFile = resolve('/out/result.pdf')
    for (const [ext, mod] of Object.entries(expected)) {
      const path = resolve(`/in/sample${ext}`)
      expect(headlessModuleFor(path)).toBe(mod)
      const checked = validateHeadlessPaths(requestFor(path, outFile), {
        exists: (p) => p === path || p === outDir,
        isFile: (p) => p === path,
      })
      expect(checked).toMatchObject({ ok: true, module: mod })
    }
    expect(HEADLESS_PDF_EXTENSIONS).toContain('epub')
    expect(HEADLESS_PDF_EXTENSIONS).toContain('xmind')
    expect(HEADLESS_PDF_EXTENSIONS).toContain('doc')
    expect(HEADLESS_PDF_EXTENSIONS).toContain('ppt')
    expect(headlessModuleFor('/in/deck.odp')).toBeNull()
  })

  it('converts legacy .doc/.ppt to a temp file and removes the temp directory afterward', async () => {
    let seenTempPath = ''
    let existedDuringRun = false
    await runExporterWithLegacyConversion(
      '/in/report.doc',
      '/out/report.pdf',
      'pdf',
      requestFor('/in/report.doc'),
      async (convertedInput) => {
        seenTempPath = convertedInput
        existedDuringRun = existsSync(convertedInput)
      },
      async () => ({
        ok: true,
        copy: {
          editor: 'docs',
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          fileName: 'report.docx',
          saveAsDefaultPath: '/in/report.docx',
          importedFrom: 'doc',
        },
      }),
    )
    expect(seenTempPath.endsWith('report.docx')).toBe(true)
    expect(existedDuringRun).toBe(true)
    expect(existsSync(seenTempPath)).toBe(false)
  })

  it('reports password-protected legacy binaries clearly', async () => {
    await expect(
      runExporterWithLegacyConversion(
        '/in/locked.ppt',
        '/out/locked.pdf',
        'pdf',
        requestFor('/in/locked.ppt'),
        async () => {},
        async () => ({
          ok: false,
          reason: 'encrypted',
          from: 'ppt',
          to: 'pptx',
          error: 'encrypted',
        }),
      ),
    ).rejects.toThrow(/password-protected/i)
  })
})

describe('headless runner argument and envelope helpers', () => {
  it('builds argv with --headless-export and parses JSON envelopes cleanly', () => {
    const args = buildHeadlessExportArgs('/in/doc.odt', '/out/doc.pdf')
    expect(args).toEqual([
      '--headless-export',
      '/in/doc.odt',
      '--to',
      'pdf',
      '--out',
      '/out/doc.pdf',
      '--json',
    ])
    expect(
      parseHeadlessJsonEnvelope('noise\n{"status":"ok","output_path":"/out/doc.pdf"}\n'),
    ).toEqual({
      status: 'ok',
      output_path: '/out/doc.pdf',
    })
    expect(parseHeadlessJsonEnvelope('{"status":"error","error":"boom"}')).toEqual({
      status: 'error',
      error: 'boom',
    })
  })
})

describe('buildEpubPrintHtml', () => {
  it('assembles chapters, inlines internal images/CSS, and strips scripts', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    )
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-book</dc:identifier>
    <dc:title>Print Test Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="book.css" media-type="text/css"/>
    <item id="img1" href="pic.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`,
    )
    zip.file('OEBPS/book.css', 'p { color: #222; }')
    // 1x1 PNG
    zip.file(
      'OEBPS/pic.png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2m8AAAAASUVORK5CYII=',
        'base64',
      ),
    )
    zip.file(
      'OEBPS/ch1.xhtml',
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><link rel="stylesheet" href="book.css"/><script>alert(1)</script></head>
  <body><h1>Chapter One</h1><p onclick="evil()">Hello</p><img src="pic.png"/><img src="https://example.com/tracker.png"/></body>
</html>`,
    )
    const epubBytes = await zip.generateAsync({ type: 'uint8array' })
    const opened = await openEpub(epubBytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const html = await buildEpubPrintHtml(opened.book)
    expect(html).toContain('Print Test Book')
    expect(html).toContain('Chapter One')
    expect(html).toContain('p { color: #222; }')
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('onclick=')
    expect(html).not.toContain('https://example.com/tracker.png')
  })
})
