import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { EditorShell } from '../src/renderer/shell/EditorShell'
import { bundledFaceSpecs, loadFace } from '../src/renderer/editors/sheets/pdf/fonts'
import {
  assembleImagesToPdf,
  expandSharedSvgImages,
  injectSvgFonts,
  markdownToPrintHtml,
  renderHtmlToPdfBytes,
  stripMarkdownRedactionMarkup,
} from '../src/renderer/editors/shared/pdfExport'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = []

afterEach(() => {
  while (roots.length > 0) {
    const entry = roots.pop()
    if (!entry) continue
    act(() => {
      entry.root.unmount()
    })
    entry.container.remove()
  }
})

function mountShell(props: {
  docFormat?: 'hwp' | 'pdf' | 'epub' | 'md' | 'xlsx'
  onPrint?: () => void
  onSharePdf?: () => void
  printScope?: 'document' | 'chapter' | 'sheet'
}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <EditorShell
            docTitle="sample.hwp"
            docFormat={props.docFormat ?? 'hwp'}
            saveState="saved"
            mode="view"
            canEdit={true}
            aiEnabled={false}
            quickActions={[]}
            aiPanelContent={null}
            onBack={() => {}}
            onEnterEdit={() => {}}
            onDone={() => {}}
            onExitEdit={() => {}}
            onSave={() => {}}
            onShare={() => {}}
            onPrint={props.onPrint}
            onSharePdf={props.onSharePdf}
            printScope={props.printScope}
            onFitToWidth={() => {}}
            onOpenBackups={() => {}}
          >
            <div>doc</div>
          </EditorShell>
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  return { container, root }
}

function openMore(container: HTMLElement) {
  const btn = container.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]')
  expect(btn).toBeTruthy()
  act(() => {
    btn?.click()
  })
}

// Valid 1x1 PNG bytes.
const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

describe('mobile unified print and PDF share', () => {
  it('renders Print and Share as PDF in the More sheet and invokes handlers', () => {
    const onPrint = vi.fn()
    const onSharePdf = vi.fn()
    const { container } = mountShell({ docFormat: 'hwp', onPrint, onSharePdf })

    openMore(container)
    const sharePdfBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="editor-share-pdf-btn"]',
    )
    const printBtn = container.querySelector<HTMLButtonElement>('[data-testid="editor-print-btn"]')
    expect(sharePdfBtn?.textContent).toContain('PDF로 공유')
    expect(printBtn?.textContent).toContain('인쇄')

    act(() => {
      sharePdfBtn?.click()
    })
    expect(onSharePdf).toHaveBeenCalledTimes(1)

    openMore(container)
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="editor-print-btn"]')?.click()
    })
    expect(onPrint).toHaveBeenCalledTimes(1)
  })

  it('uses chapter-scoped labels for EPUB and hides duplicate Share as PDF for PDF documents', () => {
    const epub = mountShell({
      docFormat: 'epub',
      onPrint: () => {},
      onSharePdf: () => {},
      printScope: 'chapter',
    })
    openMore(epub.container)
    expect(epub.container.querySelector('[data-testid="editor-print-btn"]')?.textContent).toContain(
      '현재 장 인쇄',
    )
    expect(
      epub.container.querySelector('[data-testid="editor-share-pdf-btn"]')?.textContent,
    ).toContain('현재 장 PDF로 공유')

    act(() => {
      epub.root.render(
        <MobileLocaleProvider lang="ko">
          <BackStackProvider>
            <EditorShell
              docTitle="sample.pdf"
              docFormat="pdf"
              saveState="saved"
              mode="view"
              canEdit={true}
              aiEnabled={false}
              quickActions={[]}
              aiPanelContent={null}
              onBack={() => {}}
              onEnterEdit={() => {}}
              onDone={() => {}}
              onExitEdit={() => {}}
              onSave={() => {}}
              onShare={() => {}}
              onPrint={() => {}}
              onSharePdf={undefined}
              onFitToWidth={() => {}}
              onOpenBackups={() => {}}
            >
              <div>doc</div>
            </EditorShell>
          </BackStackProvider>
        </MobileLocaleProvider>,
      )
    })
    expect(epub.container.querySelector('[data-testid="editor-print-btn"]')).toBeTruthy()
    expect(epub.container.querySelector('[data-testid="editor-share-pdf-btn"]')).toBeNull()
  })

  it('uses sheet-scoped labels for spreadsheets', () => {
    const sheet = mountShell({
      docFormat: 'xlsx',
      onPrint: () => {},
      onSharePdf: () => {},
      printScope: 'sheet',
    })
    openMore(sheet.container)
    expect(
      sheet.container.querySelector('[data-testid="editor-print-btn"]')?.textContent,
    ).toContain('현재 시트 인쇄')
    expect(
      sheet.container.querySelector('[data-testid="editor-share-pdf-btn"]')?.textContent,
    ).toContain('현재 시트 PDF로 공유')
  })

  it('renders inline formatting and mixed Latin/Hangul code blocks with zero missing glyphs', async () => {
    const repo = resolve(__dirname, '../../..')
    const specs = bundledFaceSpecs({
      calibri: 'calibri.ttf',
      calibriBold: 'calibri-bold.ttf',
      arial: 'arial.ttf',
      arialBold: 'arial-bold.ttf',
      korean: 'korean.woff2',
    })
    const files: Record<string, string> = {
      calibri: 'packages/ui/src/fonts/Carlito-Regular.ttf',
      'calibri-bold': 'packages/ui/src/fonts/Carlito-Bold.ttf',
      arial: 'apps/docs/src/renderer/fonts/LiberationSans-Regular.ttf',
      'arial-bold': 'apps/docs/src/renderer/fonts/LiberationSans-Bold.ttf',
      korean: 'apps/mobile/src/renderer/assets/fonts/GenOfficeSansKR-Regular-subset.woff2',
    }
    const faces = specs.map((spec) =>
      loadFace(spec, new Uint8Array(readFileSync(resolve(repo, files[spec.id] as string)))),
    )
    const md = [
      '# 회의록 Summary',
      '',
      'Start **굵은 글씨** and `code 안녕` end.',
      '',
      '```ts',
      'const greeting = "안녕하세요"',
      '```',
    ].join('\n')
    const html = markdownToPrintHtml(md, 'notes.md')
    const result = await renderHtmlToPdfBytes(html, { title: 'notes.md', faces })
    expect(result.missingGlyphs).toBe(0)
    expect(result.pageCount).toBe(1)
    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe('%PDF-')
    const parsed = await PDFDocument.load(result.bytes)
    expect(parsed.getPageCount()).toBe(1)
  })

  it('strips AI redaction span markup from Markdown print HTML while keeping original text', () => {
    const md =
      '# Meeting\nContact <span class="redact-span" data-redaction="" data-label="phone">010-1234-5678</span> today.'
    expect(stripMarkdownRedactionMarkup(md)).toBe('# Meeting\nContact 010-1234-5678 today.')
    const html = markdownToPrintHtml(md, 'notes.md')
    expect(html).toContain('010-1234-5678')
    expect(html).not.toContain('redact-span')
    expect(html).not.toContain('data-redaction')
    expect(html).toContain('<h1>Meeting</h1>')
  })

  it('expands shared HWP SVG image refs and injects inline font CSS', () => {
    const svg = '<svg width="100" height="100"><image href="ieum-image:0"/></svg>'
    const expanded = expandSharedSvgImages(svg, ['data:image/png;base64,AAAA'])
    expect(expanded).toContain('href="data:image/png;base64,AAAA"')
    const withFonts = injectSvgFonts(expanded, '@font-face{font-family:"Test";}')
    expect(withFonts).toContain('<defs><style type="text/css"><![CDATA[@font-face')
  })

  it('assembles raster page images into a valid multi-page PDF', async () => {
    const pdfBytes = await assembleImagesToPdf([
      { bytes: TINY_PNG, mime: 'image/png', widthPt: 595, heightPt: 842 },
      { bytes: TINY_PNG, mime: 'image/png', widthPt: 792, heightPt: 446 },
    ])
    expect(new TextDecoder().decode(pdfBytes.subarray(0, 5))).toBe('%PDF-')
    const parsed = await PDFDocument.load(pdfBytes)
    expect(parsed.getPageCount()).toBe(2)
    expect(Math.round(parsed.getPage(1).getWidth())).toBe(792)
  })
})
