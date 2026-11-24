import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import {
  buildFlowDocument,
  buildFlowHtml,
  stripClipboardFragment,
} from '../src/renderer/editors/hwpFlow'
import { HwpFlowView } from '../src/renderer/editors/HwpFlowView'
import type { FlowEngineDocument } from '../src/renderer/editors/rhwpEngine'

const require = createRequire(import.meta.url)
const fixtures = join(__dirname, '../../hwp/tests/fixtures')

beforeAll(() => {
  const wasm = readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm'))
  initSync({ module: wasm })
})

const containers: HTMLElement[] = []
afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

describe('HWP flow builder (real rhwp engine)', () => {
  it('rebuilds a form with nested tables as tagged paragraphs and objects', () => {
    const doc = new HwpDocument(new Uint8Array(readFileSync(join(fixtures, 'nested-form.hwp'))))
    try {
      const html = buildFlowHtml(doc as unknown as FlowEngineDocument)
      expect(html).toContain('class="flow-p" data-sec="0" data-para="0"')
      expect(html).toContain('교과협의록')
      expect(html).toMatch(/class="flow-obj" data-sec="0" data-para="\d+" data-ctrl="0"/)
      expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(2)
      expect(html).not.toContain('StartFragment')
    } finally {
      doc.free()
    }
  })

  it('keeps pictures', () => {
    const doc = new HwpDocument(
      new Uint8Array(readFileSync(join(fixtures, 'square-picture-after-page-reset.hwpx'))),
    )
    try {
      expect(buildFlowHtml(doc as unknown as FlowEngineDocument)).toContain('<img')
    } finally {
      doc.free()
    }
  })

  const flowOf = (name: string) => {
    const doc = new HwpDocument(new Uint8Array(readFileSync(join(fixtures, name))))
    try {
      const html = buildFlowHtml(doc as unknown as FlowEngineDocument)
      return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    } finally {
      doc.free()
    }
  }

  it('shows bullets as markers outside the editable text', () => {
    const body = flowOf('title-table-zone-fill.hwpx')
    const marked = body.querySelectorAll('.flow-p p[data-marker="•"]')
    expect(marked.length).toBeGreaterThan(0)
    // the marker is an attribute drawn by CSS, not text
    expect(marked[0].textContent?.startsWith('•')).toBe(false)
  })

  it('shows footnotes after the paragraph that refers to them', () => {
    const body = flowOf('footnote-typed-number.hwpx')
    const notes = [...body.querySelectorAll('.flow-note')]
    expect(notes.length).toBeGreaterThanOrEqual(3)
    expect(notes[0].textContent).toMatch(/^1\) 가나다라/)
    expect(notes[0].getAttribute('contenteditable')).toBe('false')
  })

  it('shows picture captions as editable blocks next to the picture', () => {
    const body = flowOf('caption-footnote-flow.hwpx')
    const caption = body.querySelector('.flow-caption')!
    expect(caption.textContent).toContain('[그림 1]')
    expect(caption.getAttribute('data-cell-path')).toBe('[{"controlIndex":0,"cellIndex":0}]')
    expect(caption.querySelector('.flow-p[data-path]')).not.toBeNull()
    // the caption sits right after its picture
    expect(caption.previousElementSibling?.tagName).toBe('IMG')
  })

  it('shows table captions above the table as editable blocks', () => {
    const body = flowOf('caption-footnote-flow.hwpx')
    const caption = [...body.querySelectorAll('.flow-caption')].find((el) =>
      el.textContent?.startsWith('[표 1]'),
    )!
    expect(caption.getAttribute('data-cell-path')).toBe('[{"controlIndex":0,"cellIndex":65534}]')
    expect(caption.nextElementSibling?.tagName).toBe('TABLE')
    expect(caption.querySelector('p')?.getAttribute('style')).toContain('text-align:center')
  })

  it('shows text box contents, including a table inside the box', () => {
    const body = flowOf('textbox-table.hwp')
    const box = body.querySelector('.flow-box')!
    expect(box).not.toBeNull()
    expect(box.textContent).toContain('상자-0')
    expect(box.querySelector('table')).not.toBeNull()
  })

  it('shows header text once at the top of the section', () => {
    const body = flowOf('header-picture-and-text.hwpx')
    const hf = body.querySelector('.flow-hf')!
    expect(hf.textContent).toBe('HEADER01')
    expect(hf).toBe(body.firstElementChild)
    // a header that holds only a table has no top-level text: nothing is shown
    expect(flowOf('header-footer-paper-tables.hwpx').querySelector('.flow-hf')).toBeNull()
  })

  it('strips the clipboard wrapper and builds a script-free frame document', () => {
    expect(
      stripClipboardFragment('<html><!--StartFragment--><p>a</p><!--EndFragment--></html>'),
    ).toBe('<p>a</p>')
    const page = buildFlowDocument('<div class="flow-p">x</div>', 1.3, 'ko')
    expect(page).toContain('--flow-zoom:1.3')
    expect(page).not.toContain('<script')
  })
})

describe('HwpFlowView', () => {
  function render(node: React.ReactNode): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    containers.push(el)
    act(() => createRoot(el).render(node))
    return el
  }

  it('shows the flow in a frame that cannot run scripts', async () => {
    const fake: FlowEngineDocument = {
      getSectionCount: () => 1,
      getParagraphCount: () => 1,
      getParagraphLength: () => 3,
      getControlTextPositions: () => '[]',
      exportSelectionHtml: () => '<!--StartFragment--><p>본문</p><!--EndFragment-->',
      exportControlHtml: () => '',
      getCellParagraphCountByPath: () => 0,
      getCellParagraphLengthByPath: () => 0,
      exportSelectionInCellHtmlByPath: () => '',
      getParaPropertiesAt: () => '{"headType":"None"}',
      getCellParaPropertiesAtByPath: () => '{"headType":"None"}',
      getBulletList: () => '[]',
      getFootnoteInfo: () => '{"ok":false}',
      getHeaderFooter: () => '{"ok":true,"exists":false}',
      getTableProperties: () => '{}',
      getCellParagraphCount: () => 0,
      getCellParagraphLength: () => 0,
      getTextInCell: () => '',
      getCellParaPropertiesAt: () => '{"headType":"None"}',
      getCellCharPropertiesAt: () => '{}',
      free: vi.fn(),
    }
    const el = render(
      <HwpFlowView
        bytes={new Uint8Array([1])}
        title="문서.hwp"
        lang="ko"
        zoom={1.2}
        openDocument={async () => fake}
      />,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const frame = el.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toContain('<p>본문</p>')
    // the engine document stays open while the view is shown (for editing)
    expect(fake.free).not.toHaveBeenCalled()
  })

  it('reports when the engine cannot open the document', async () => {
    const onUnavailable = vi.fn()
    render(
      <HwpFlowView
        bytes={new Uint8Array([1])}
        title="잠긴.hwp"
        lang="ko"
        zoom={1.2}
        openDocument={async () => {
          throw new Error('password')
        }}
        onUnavailable={onUnavailable}
      />,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(onUnavailable).toHaveBeenCalledWith('password')
  })
})
