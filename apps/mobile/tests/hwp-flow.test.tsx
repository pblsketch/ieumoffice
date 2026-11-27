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
  normalizeClipboardBorderWidths,
  normalizeFlowParagraphStyle,
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

  it('shows the header once at the top of the section, picture included, read-only', () => {
    const body = flowOf('header-picture-and-text.hwpx')
    const hf = body.querySelector('.flow-hf')!
    expect(hf.textContent?.trim()).toBe('HEADER01')
    expect(hf.querySelector('img')).not.toBeNull()
    expect(hf).toBe(body.firstElementChild)
    expect(hf.getAttribute('contenteditable')).toBe('false')
    // nothing in it carries an address the flow editor would edit
    expect(hf.querySelector('.flow-p, [data-sec], [data-path], [data-cell-path]')).toBeNull()
  })

  it('shows a table inside a header or footer', () => {
    const body = flowOf('header-footer-paper-tables.hwpx')
    const [header, footer] = [...body.querySelectorAll('.flow-hf')]
    expect(header).toBe(body.firstElementChild)
    expect(header.querySelector('table')).not.toBeNull()
    expect(footer).toBe(body.lastElementChild)
    expect(footer.querySelector('table')).not.toBeNull()
    expect(header.querySelector('[data-sec], [data-cell-path]')).toBeNull()
  })

  it('strips the clipboard wrapper and builds a script-free frame document', () => {
    expect(
      stripClipboardFragment('<html><!--StartFragment--><p>a</p><!--EndFragment--></html>'),
    ).toBe('<p>a</p>')
    const page = buildFlowDocument('<div class="flow-p">x</div>', 1.3, 'ko')
    expect(page).toContain('--flow-zoom:1.3')
    expect(page).not.toContain('<script')
  })

  it('prevents negative hanging indents and side margins from clipping off the viewport', () => {
    // HWP hanging indent with no left margin: margin-left must compensate so line 1 starts >= 0
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;text-align:justify;text-indent:-51.0px;line-height:160%;"><span>김인호 본문</span></p>',
      ),
    ).toBe(
      '<p style="margin:0;text-align:justify;line-height:160%;margin-left:36px;text-indent:-36px;"><span>김인호 본문</span></p>',
    )

    // Small hanging indent already compensated by left margin stays non-negative
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;margin-left:20.0px;margin-right:20.0px;text-indent:-17.9px;"><span>항목</span></p>',
      ),
    ).toBe(
      '<p style="margin:0;margin-left:20px;margin-right:20px;text-indent:-17.9px;"><span>항목</span></p>',
    )

    // Negative side margins and desktop-wide indents are clamped to readable mobile bounds
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;margin-left:-24px;margin-right:-18px;text-indent:-90px;"><span>긴 내어쓰기</span></p>',
      ),
    ).toBe('<p style="margin:0;margin-left:36px;text-indent:-36px;"><span>긴 내어쓰기</span></p>')

    // Cell paragraphs use tighter caps so multi-column tables stay readable
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;margin-left:40px;margin-right:30px;text-indent:-28px;"><span>칸</span></p>',
        true,
      ),
    ).toBe(
      '<p style="margin:0;margin-left:20px;margin-right:12px;text-indent:-16px;"><span>칸</span></p>',
    )

    // Real rhwp fixture with negative hanging indents never places line 1 left of 0
    const body = flowOf('stale-table-width-pushed-boundary.hwpx')
    let hangingCount = 0
    for (const p of body.querySelectorAll('.flow-p p')) {
      const style = p.getAttribute('style') ?? ''
      const left = Number(/margin-left:([+-]?[\d.]+)px/.exec(style)?.[1] ?? 0)
      const right = Number(/margin-right:([+-]?[\d.]+)px/.exec(style)?.[1] ?? 0)
      const indent = Number(/text-indent:([+-]?[\d.]+)px/.exec(style)?.[1] ?? 0)
      if (indent < 0) hangingCount += 1
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(0)
      expect(left + indent).toBeGreaterThanOrEqual(0)
    }
    expect(hangingCount).toBeGreaterThan(0)
  })

  it('converts HWP border-width codes in clipboard table styles to real CSS pixels', () => {
    expect(
      normalizeClipboardBorderWidths(
        'border-top:1.0px solid #000;border-right:6.0px solid #000;border-bottom:7.0px solid #000;border-left:10.0px solid #000;',
      ),
    ).toBe(
      'border-top:1px solid #000;border-right:1.5px solid #000;border-bottom:1.9px solid #000;border-left:3.8px solid #000;',
    )
    // already-normalized widths and out-of-range codes are left untouched
    expect(
      normalizeClipboardBorderWidths('border-top:2px solid #000;border-bottom:20.0px solid #000;'),
    ).toBe('border-top:2px solid #000;border-bottom:20.0px solid #000;')
  })

  it('promotes cell-nested headers out of table cells and avoids duplicating inline cell tables', () => {
    const mockDoc: FlowEngineDocument = {
      getSectionCount: () => 1,
      getParagraphCount: () => 1,
      getParagraphLength: () => 0,
      getControlTextPositions: () => '[{"controlIndex":0}]',
      exportSelectionHtml: () => '',
      exportControlHtml: (_sec, _para, pathJson, ctrl) => {
        if (pathJson === '[]' && ctrl === 0) {
          return '<!--StartFragment--><table><tr><td style="border-top:6.0px solid #000"></td><td></td></tr></table><!--EndFragment-->'
        }
        if (pathJson === '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]' && ctrl === 0) {
          return '<!--StartFragment--><!-- rhwp: 셀 안 Header 컨트롤은 HTML 내보내기를 지원하지 않습니다 --><!--EndFragment-->'
        }
        if (pathJson === '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0}]' && ctrl === 0) {
          return '<!--StartFragment--><!-- rhwp: 셀 안 Shape 컨트롤은 HTML 내보내기를 지원하지 않습니다 --><!--EndFragment-->'
        }
        if (
          pathJson ===
            '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]' &&
          ctrl === 0
        ) {
          return '<!--StartFragment--><table><tr><td style="border-bottom:7.0px solid #000"></td></tr></table><!--EndFragment-->'
        }
        throw new Error('control out of range')
      },
      getCellParagraphCountByPath: (_sec, _para, pathJson) => {
        if (
          pathJson === '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]' ||
          pathJson === '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0}]'
        ) {
          return 1
        }
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return 2
        }
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return 1
        }
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return 1
        }
        return 0
      },
      getCellParagraphLengthByPath: (_sec, _para, pathJson) => {
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":1}]'
        ) {
          return 0
        }
        return 3
      },
      exportSelectionInCellHtmlByPath: (_sec, _para, pathJson) => {
        if (pathJson === '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]') {
          return '<!--StartFragment--><p><span>제목</span></p><!--EndFragment-->'
        }
        if (pathJson === '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0}]') {
          return '<!--StartFragment--><p><span>오른쪽</span></p><!--EndFragment-->'
        }
        // Header paragraph 0 has both text and an inline table appended by rhwp clipboard HTML
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return '<!--StartFragment--><p><span>결재란</span></p><table><tr><td>결재</td></tr></table><!--EndFragment-->'
        }
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return '<!--StartFragment--><p><span>글상자</span></p><!--EndFragment-->'
        }
        if (
          pathJson ===
          '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0},{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]'
        ) {
          return '<!--StartFragment--><p><span>결재</span></p><!--EndFragment-->'
        }
        return ''
      },
      getParaPropertiesAt: () => '{"headType":"None"}',
      getCellParaPropertiesAtByPath: () => '{"headType":"None"}',
      getBulletList: () => '[]',
      getFootnoteInfo: () => '{"ok":false}',
      getHeaderFooter: () => '{"ok":true,"exists":false}',
      getTableProperties: () => '{}',
      getCellParagraphCount: (_sec, _para, ctrl, cell) => (ctrl === 0 && cell <= 1 ? 1 : 0),
      getCellParagraphLength: (_sec, _para, ctrl, cell) => (ctrl === 0 && cell <= 1 ? 3 : 0),
      getTextInCell: () => '',
      getCellParaPropertiesAt: () => '{"headType":"None"}',
      getCellCharPropertiesAt: () => '{}',
      free: vi.fn(),
    }

    const html = buildFlowHtml(mockDoc)
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

    // Cell-nested header is promoted once to the top as read-only .flow-header
    const headers = body.querySelectorAll('.flow-hf.flow-header')
    expect(headers).toHaveLength(1)
    expect(headers[0]).toBe(body.firstElementChild)
    expect(headers[0].getAttribute('contenteditable')).toBe('false')
    expect(headers[0].querySelector('[data-sec], [data-path]')).toBeNull()
    // Inline table inside the header is not duplicated, and its 7.0px border code is normalized
    const headerTables = headers[0].querySelectorAll('table')
    expect(headerTables).toHaveLength(1)
    expect(headerTables[0].querySelector('td')?.getAttribute('style')).toContain('1.9px')
    // Trailing empty paragraph in the promoted header is omitted
    expect(headers[0].querySelectorAll('p')).toHaveLength(2)

    // Outer table cell 0 has no leaked .flow-box for Header, and its 6.0px border is normalized
    const outerTable = body.querySelector(':scope > .flow-obj > table')!
    const [cell0, cell1] = outerTable.querySelectorAll(':scope > tbody > tr > td')
    expect(cell0.getAttribute('style')).toContain('1.5px')
    expect(cell0.querySelector('.flow-box')).toBeNull()
    // Outer table cell 1 keeps its real Shape text box as .flow-box
    expect(cell1.querySelector('.flow-box')?.textContent).toContain('글상자')
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
