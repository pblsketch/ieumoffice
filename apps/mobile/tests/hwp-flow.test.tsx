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
  cellStyleFromEngineProps,
  classifyFlowTable,
  FLOW_FRAME_CSS,
  normalizeClipboardBorderWidths,
  normalizeFlowFontFamily,
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

  it('strips the clipboard wrapper and builds a script-free light-paper frame document', () => {
    expect(
      stripClipboardFragment('<html><!--StartFragment--><p>a</p><!--EndFragment--></html>'),
    ).toBe('<p>a</p>')
    const page = buildFlowDocument('<div class="flow-p">x</div>', 1.3, 'ko', 128)
    expect(page).toContain('--flow-zoom:1.3')
    expect(page).toContain('--flow-bottom-pad:128px')
    expect(page).toContain('<meta name="color-scheme" content="light">')
    expect(FLOW_FRAME_CSS).toContain('color-scheme: light;')
    expect(FLOW_FRAME_CSS).toContain('calc(var(--flow-bottom-pad, 100px) / var(--flow-zoom, 1.2))')
    expect(page).not.toContain('<script')
  })

  it('prevents negative hanging indents and side margins from clipping off the viewport', () => {
    // HWP hanging indent with no left margin: margin-left must compensate so line 1 starts >= 0
    // and justify converts to left for narrow reflow screens
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;text-align:justify;text-indent:-51.0px;line-height:160%;"><span>김인호 본문</span></p>',
      ),
    ).toBe(
      '<p style="margin:0;text-align:left;line-height:160%;margin-left:36px;text-indent:-36px;"><span>김인호 본문</span></p>',
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

    // Centered and right-aligned paragraphs drop leftover hanging indents so headings stay centered
    expect(
      normalizeFlowParagraphStyle(
        '<p style="margin:0;text-align:center;text-indent:-39.9px;line-height:130%;"><span>제목</span></p>',
        true,
      ),
    ).toBe('<p style="margin:0;text-align:center;line-height:130%;"><span>제목</span></p>')

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

  it('normalizes rhwp letter-spacing, alignment, line-height, font-size, font-family, and charRatio guards', () => {
    // Real rhwp fragment with aggressive -15% HWP tracking (-3.0px at 15pt, -2.6px at 13pt)
    const rawCrushed =
      '<p style="margin:0;text-align:justify;text-indent:-39.1px;line-height:100%;">' +
      `<span style="font-family:'휴먼명조','Palatino Linotype';font-size:15.0pt;font-weight:bold;color:#000000;letter-spacing:-3.0px;">굵은 글자</span>` +
      `<span style="font-family:'휴먼명조','Palatino Linotype';font-size:13.0pt;color:#000000;letter-spacing:-2.6px;">(Sample Text)</span>` +
      '</p>'
    const norm = normalizeFlowParagraphStyle(rawCrushed)
    expect(norm).toContain('text-align:left;')
    expect(norm).toContain('line-height:135%;')
    expect(norm).toContain('letter-spacing:-0.02em;')
    expect(norm).not.toContain('letter-spacing:-3.0px')
    expect(norm).not.toContain('letter-spacing:-2.6px')
    expect(norm).toContain('font-weight:bold;')
    expect(norm).toContain('color:#000000;')

    // Subtle negative tracking (-0.6px at 15pt = -3% HWP -> -0.015em) stays proportional
    const subtle = normalizeFlowParagraphStyle(
      `<p style="margin:0;text-align:distribute;text-align-last:justify;line-height:250%;"><span style="font-size:15.0pt;letter-spacing:-0.6px;transform:scaleX(0.8);font-stretch:70%;">본문</span></p>`,
    )
    expect(subtle).toContain('text-align:left;')
    expect(subtle).not.toContain('text-align-last')
    expect(subtle).toContain('line-height:200%;')
    expect(subtle).toContain('letter-spacing:-0.015em;')
    expect(subtle).not.toContain('transform')
    expect(subtle).toContain('font-stretch:85%;')

    // Extreme font sizes clamp to readable bounds; positive tracking caps at +0.12em
    const extremes = normalizeFlowParagraphStyle(
      `<p style="margin:0;"><span style="font-size:40.0pt;letter-spacing:20.0px;">제목</span><span style="font-size:4.0pt;letter-spacing:-0.1px;">작은글</span></p>`,
      true,
    )
    expect(extremes).toContain('font-size:20pt;')
    expect(extremes).toContain('letter-spacing:0.12em;')
    expect(extremes).toContain('font-size:8pt;')
    expect(extremes).not.toContain('-0.1px')

    // Font family cleanup and generic fallbacks
    expect(normalizeFlowFontFamily("'T8,한컴바탕'")).toBe("'T8','한컴바탕',sans-serif")
    expect(normalizeFlowFontFamily("'Consolas'")).toBe("'Consolas',monospace")
    expect(normalizeFlowFontFamily("'맑은 고딕', sans-serif")).toBe("'맑은 고딕', sans-serif")
  })

  it('builds true cell styles from engine properties and omits NONE borders', () => {
    // Border type 0 (NONE) with non-zero width must not emit borders
    const borderless = cellStyleFromEngineProps({
      borderLeft: { type: 0, width: 1, color: '#000000' },
      borderRight: { type: 0, width: 1, color: '#000000' },
      borderTop: { type: 0, width: 2, color: '#0000ff' },
      borderBottom: { type: 0, width: 2, color: '#0000ff' },
      fillType: 'none',
      verticalAlign: 1,
    })
    expect(borderless).toBe('vertical-align:middle;')

    // Double blue top/bottom (type 8, width code 7) + solid fill
    const sectionBox = cellStyleFromEngineProps({
      borderLeft: { type: 0, width: 1, color: '#353535' },
      borderRight: { type: 0, width: 1, color: '#353535' },
      borderTop: { type: 8, width: 7, color: '#0000ff' },
      borderBottom: { type: 8, width: 7, color: '#0000ff' },
      fillType: 'solid',
      fillColor: '#dfe6f7',
      verticalAlign: 0,
    })
    expect(sectionBox).not.toContain('border-left')
    expect(sectionBox).not.toContain('border-right')
    expect(sectionBox).toContain('border-top:3px double #0000ff')
    expect(sectionBox).toContain('border-bottom:3px double #0000ff')
    expect(sectionBox).toContain('background-color:#dfe6f7')
  })

  it('classifies decorative layout/callout tables separately from structured data tables', () => {
    // 1-column cover or heading table -> layout
    expect(
      classifyFlowTable(5, 1, [
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 0,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
        {
          rowIdx: 1,
          colSpan: 1,
          textLen: 18,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
      ]),
    ).toBe('layout')

    // 1-row 2-col numbered section banner -> callout
    expect(
      classifyFlowTable(1, 2, [
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 1,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 24,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
      ]),
    ).toBe('callout')

    // 2-row 4-col reference box with empty gutters + spanning body -> callout
    expect(
      classifyFlowTable(2, 4, [
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 0,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 2,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 0,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 16,
          hasMediaOrTable: false,
          hasSolidFill: false,
          isGradientBar: false,
        },
        {
          rowIdx: 1,
          colSpan: 4,
          textLen: 80,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
      ]),
    ).toBe('callout')

    // 3-row 4-col data table -> data
    expect(
      classifyFlowTable(3, 4, [
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 2,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 4,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 4,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
        {
          rowIdx: 0,
          colSpan: 1,
          textLen: 2,
          hasMediaOrTable: false,
          hasSolidFill: true,
          isGradientBar: false,
        },
      ]),
    ).toBe('data')
  })

  it('renders the anonymized official-doc repro fixture with clean layout, tracking, alignment, and tables', () => {
    const reproPath = join(__dirname, 'fixtures/flow-fidelity-repro.hwpx')
    const doc = new HwpDocument(new Uint8Array(readFileSync(reproPath)))
    try {
      const html = buildFlowHtml(doc as unknown as FlowEngineDocument)
      const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

      const tables = [...body.querySelectorAll('table')]
      expect(tables).toHaveLength(4)

      // 1. Cover table: layout table, empty spacer rows collapsed, gradient bars detected, no phantom borders
      const cover = tables[0]
      expect(cover.getAttribute('data-table-kind')).toBe('layout')
      expect(cover.querySelectorAll('tr.flow-spacer-row').length).toBeGreaterThanOrEqual(2)
      expect(cover.querySelectorAll('tr.flow-divider-row')).toHaveLength(2)
      const titleCell = [...cover.querySelectorAll('td')].find((td) =>
        td.textContent?.includes('가나다 프로젝트'),
      )!
      expect(titleCell.getAttribute('style') ?? '').not.toContain('border-')
      expect(titleCell.innerHTML).toContain('font-size:20pt;')

      // 2. Section title banner: double blue top/bottom, no left/right phantom borders
      const secBanner = tables[1]
      expect(secBanner.getAttribute('data-table-kind')).toBe('layout')
      const secStyle = secBanner.querySelector('td')?.getAttribute('style') ?? ''
      expect(secStyle).toContain('border-top:3px double #0000ff')
      expect(secStyle).toContain('border-bottom:3px double #0000ff')
      expect(secStyle).not.toContain('border-left')
      expect(secStyle).not.toContain('border-right')

      // 3. Body paragraphs: no justify/distribute rivers, no crushed negative px letter-spacing, min line-height
      const bodyParas = [...body.querySelectorAll(':scope > .flow-p')]
      const crushedPara = bodyParas.find((el) => el.textContent?.includes('Sample Text'))!
      expect(crushedPara.innerHTML).toContain('text-align:left;')
      expect(crushedPara.innerHTML).toContain('letter-spacing:-0.02em;')
      expect(crushedPara.innerHTML).not.toMatch(/letter-spacing:-[\d.]+px/)

      const distPara = bodyParas.find((el) => el.textContent?.includes('배분 정렬'))!
      expect(distPara.innerHTML).toContain('text-align:left;')
      expect(distPara.innerHTML).toContain('line-height:135%;')

      // 4. Reference callout box: callout table with collapsed empty gutter cells and badge cell
      const callout = tables[2]
      expect(callout.getAttribute('data-table-kind')).toBe('callout')
      expect(callout.querySelectorAll('td.flow-spacer-cell').length).toBeGreaterThanOrEqual(2)
      expect(callout.querySelector('td.flow-badge-cell')?.textContent?.trim()).toBe('참고')

      // 5. Data table: data table with min-width for horizontal scroll
      const dataTable = tables[3]
      expect(dataTable.getAttribute('data-table-kind')).toBe('data')
      expect(dataTable.getAttribute('style') ?? '').toMatch(/min-width:\d+px/)
    } finally {
      doc.free()
    }
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
