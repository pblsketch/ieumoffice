import { readdirSync, readFileSync } from 'node:fs'
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
  formatFlowTabs,
  normalizeClipboardBorderWidths,
  normalizeFlowFontFamily,
  normalizeFlowParagraphStyle,
  stripClipboardFragment,
  TABLE_CAPTION_CELL,
  type CellStep,
} from '../src/renderer/editors/hwpFlow'
import { paragraphText } from '../src/renderer/editors/flowEditing'
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

      // 6. Grouped shape TOC container: both title (cellIndex 0) and TOC list (cellIndex 1) render with dotted leaders
      const groupBox = body.querySelector('.flow-group-box')
      expect(groupBox).not.toBeNull()
      const groupItems = groupBox!.querySelectorAll(':scope > .flow-group-item')
      expect(groupItems).toHaveLength(2)
      expect(groupItems[0].textContent).toContain('순    서')
      expect(groupItems[1].textContent).toContain('Ⅰ. 추진 배경')
      expect(groupItems[1].textContent).toContain('Ⅱ. 추진 경과')
      expect(groupItems[1].textContent).toContain('맞춤형 예시 항목의 긴 목차 제목 줄바꿈 확인')
      const tabLines = groupItems[1].querySelectorAll('p.flow-tab-line')
      expect(tabLines).toHaveLength(3)
      expect(groupItems[1].querySelectorAll('.flow-tab-leader.flow-tab-dot')).toHaveLength(3)
      // Leading and trailing empty spacer paragraphs inside the grouped TOC item are marked for reading collapse
      expect(groupItems[1].querySelectorAll(':scope > .flow-edge-empty')).toHaveLength(2)
      // Every paragraph inside the grouped TOC keeps exact 1:1 textContent with the engine for flowEditing
      const tocBlocks = [...groupItems[1].querySelectorAll<HTMLElement>(':scope > .flow-p')]
      tocBlocks.forEach((el, k) => {
        const len = doc.getCellParagraphLength(0, 1, 0, 1, k)
        const expected = len > 0 ? doc.getTextInCell(0, 1, 0, 1, k, 0, len) : ''
        expect(paragraphText(el)).toBe(expected)
      })
    } finally {
      doc.free()
    }
  })

  it('formats tab leaders and right-aligned tabs without altering paragraph textContent', () => {
    const dotted = formatFlowTabs(
      '<p style="text-align:left;"><span style="font-weight:bold;">Ⅰ</span><span>. 추진배경 \t 1</span></p>',
      { tabStops: [{ position: 81688, type: 1, fill: 7 }] },
    )
    const dotP = new DOMParser().parseFromString(`<body>${dotted}</body>`, 'text/html').body
      .firstElementChild!
    expect(dotP.classList.contains('flow-tab-line')).toBe(true)
    expect(dotP.querySelector('.flow-tab-lead')?.textContent).toBe('Ⅰ. 추진배경 ')
    expect(dotP.querySelector('.flow-tab-leader.flow-tab-dot')?.textContent).toBe('\t')
    expect(dotP.querySelector('.flow-tab-tail')?.textContent).toBe(' 1')
    expect(dotP.querySelector('.flow-tab-lead span')?.getAttribute('style')).toContain(
      'font-weight:bold',
    )
    // Exact textContent preserved for flowEditing character offsets
    expect(dotP.textContent).toBe('Ⅰ. 추진배경 \t 1')

    const dashed = formatFlowTabs('<p><span>항목\t12</span></p>', {
      tabStops: [{ position: 80000, type: 1, fill: 2 }],
    })
    expect(dashed).toContain('flow-tab-dash')

    const solid = formatFlowTabs('<p><span>항목\t12</span></p>', {
      tabStops: [{ position: 80000, type: 1, fill: 1 }],
    })
    expect(solid).toContain('flow-tab-solid')

    const autoRight = formatFlowTabs('<p><span>좌측\t우측</span></p>', { tabAutoRight: true })
    expect(autoRight).toContain('flow-tab-line')
    expect(autoRight).toContain('flow-tab-space')

    // Plain left tabs or multi-tab paragraphs wrap each tab without turning into a leader flex row
    const multi = formatFlowTabs('<p><span>A\tB\tC</span></p>', {
      tabStops: [{ position: 80000, type: 1, fill: 7 }],
    })
    const multiP = new DOMParser().parseFromString(`<body>${multi}</body>`, 'text/html').body
      .firstElementChild!
    expect(multiP.classList.contains('flow-tab-line')).toBe(false)
    expect(multiP.querySelectorAll('span.flow-tab')).toHaveLength(2)
    expect(multiP.textContent).toBe('A\tB\tC')
  })

  it('renders all child text boxes of a grouped shape plus equation and form controls', () => {
    const mockDoc: FlowEngineDocument = {
      getSectionCount: () => 1,
      getParagraphCount: () => 3,
      getParagraphLength: () => 0,
      getControlTextPositions: () => '[0]',
      exportSelectionHtml: () => '',
      exportControlHtml: (_sec, para, pathJson, ctrl) => {
        if (pathJson !== '[]' || ctrl !== 0) throw new Error('out of range')
        if (para === 0) {
          return '<!--StartFragment--><!-- rhwp: 셀 안 Shape 컨트롤은 클립보드 HTML 내보내기 미지원 --><!--EndFragment-->'
        }
        if (para === 1) {
          return '<!--StartFragment--><!-- rhwp: 셀 안 Equation 컨트롤은 클립보드 HTML 내보내기 미지원 --><!--EndFragment-->'
        }
        return '<!--StartFragment--><!-- rhwp: 셀 안 FormObject 컨트롤은 클립보드 HTML 내보내기 미지원 --><!--EndFragment-->'
      },
      getCellParagraphCount: (_sec, para, ctrl, cell) =>
        para === 0 && ctrl === 0 && cell >= 0 && cell <= 2 ? 1 : 0,
      getCellParagraphLength: (_sec, para, ctrl, cell) =>
        para === 0 && ctrl === 0 && cell >= 0 && cell <= 2 ? 4 : 0,
      getCellParagraphCountByPath: () => 0,
      getCellParagraphLengthByPath: () => 0,
      exportSelectionInCellHtmlByPath: (_sec, _para, pathJson) => {
        if (pathJson === '[{"controlIndex":0,"cellIndex":0,"cellParaIndex":0}]') {
          return '<!--StartFragment--><p><span>목차 제목</span></p><!--EndFragment-->'
        }
        if (pathJson === '[{"controlIndex":0,"cellIndex":1,"cellParaIndex":0}]') {
          return '<!--StartFragment--><p><span>1장\t1</span></p><!--EndFragment-->'
        }
        if (pathJson === '[{"controlIndex":0,"cellIndex":2,"cellParaIndex":0}]') {
          return '<!--StartFragment--><p><span>2장\t5</span></p><!--EndFragment-->'
        }
        return ''
      },
      getParaPropertiesAt: () => '{"headType":"None"}',
      getCellParaPropertiesAt: () =>
        '{"headType":"None","tabStops":[{"position":80000,"type":1,"fill":7}]}',
      getCellParaPropertiesAtByPath: () => '{"headType":"None"}',
      getBulletList: () => '[]',
      getFootnoteInfo: () => '{"ok":false}',
      getHeaderFooter: () => '{"ok":true,"exists":false}',
      getTableProperties: () => '{}',
      getEquationProperties: (_sec, para) =>
        para === 1 ? '{"script":"a^2 + b^2 = c^2","fontSize":1000,"color":0}' : '',
      renderEquationPreview: (script) => `<svg><text>${script}</text></svg>`,
      getFormObjectInfo: (_sec, para) =>
        para === 2 ? '{"ok":true,"formType":"checkbox","caption":"동의함"}' : '{"ok":false}',
      getTextInCell: () => '',
      getCellCharPropertiesAt: () => '{}',
      free: vi.fn(),
    }

    const html = buildFlowHtml(mockDoc)
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    const groupItems = body.querySelectorAll('.flow-group-box > .flow-group-item')
    expect(groupItems).toHaveLength(3)
    expect(groupItems[0].textContent).toBe('목차 제목')
    expect(groupItems[1].textContent).toBe('1장\t1')
    expect(groupItems[2].textContent).toBe('2장\t5')
    expect(groupItems[1].querySelector('p.flow-tab-line')).not.toBeNull()
    expect(body.querySelector('.flow-equation svg')?.textContent).toBe('a^2 + b^2 = c^2')
    expect(body.querySelector('.flow-form-obj')?.textContent).toBe('동의함')
  })

  it('omits zero engine-readable paragraphs across all HWP/HWPX test fixtures', () => {
    const norm = (s: string) => s.replace(/[\s\u00a0\u200b\ufeff]+/g, '')
    const UNSUPPORTED_RE = /<!--\s*rhwp:[^->]*\b([A-Za-z]+)\s+컨트롤은/

    function collectEngineParagraphTexts(doc: HwpDocument): string[] {
      const texts: string[] = []
      const pushText = (raw: string) => {
        const n = norm(raw)
        if (n.length > 0) texts.push(n)
      }

      const walkList = (sec: number, para: number, list: readonly CellStep[]) => {
        let count: number
        try {
          count =
            list.length === 1
              ? doc.getCellParagraphCount(sec, para, list[0].controlIndex, list[0].cellIndex ?? 0)
              : doc.getCellParagraphCountByPath(
                  sec,
                  para,
                  JSON.stringify([
                    ...list.slice(0, -1),
                    { ...list[list.length - 1], cellParaIndex: 0 },
                  ]),
                )
        } catch {
          return
        }
        for (let k = 0; k < count; k += 1) {
          const pPath: CellStep[] = [
            ...list.slice(0, -1),
            { ...list[list.length - 1], cellParaIndex: k },
          ]
          const pJson = JSON.stringify(pPath)
          let len: number
          try {
            len =
              list.length === 1
                ? doc.getCellParagraphLength(
                    sec,
                    para,
                    list[0].controlIndex,
                    list[0].cellIndex ?? 0,
                    k,
                  )
                : doc.getCellParagraphLengthByPath(sec, para, pJson)
          } catch {
            len = 0
          }
          if (len > 0) {
            try {
              const t =
                list.length === 1
                  ? doc.getTextInCell(
                      sec,
                      para,
                      list[0].controlIndex,
                      list[0].cellIndex ?? 0,
                      k,
                      0,
                      len,
                    )
                  : doc.getTextInCellByPath(sec, para, pJson, 0, len)
              pushText(t)
            } catch {
              // skip unreadable
            }
          }
          for (let ctrl = 0; ; ctrl += 1) {
            let raw: string
            try {
              raw = doc.exportControlHtml(sec, para, pJson, ctrl)
            } catch {
              break
            }
            walkControl(sec, para, pPath, ctrl, raw)
          }
        }
      }

      const walkControl = (
        sec: number,
        para: number,
        hostPath: readonly CellStep[],
        ctrl: number,
        raw: string,
      ) => {
        const kind = UNSUPPORTED_RE.exec(raw)?.[1] ?? null
        const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
        if (/<table[\s>]/i.test(cleaned)) {
          const cellCount = (cleaned.match(/<t[dh][\s>]/gi) ?? []).length
          for (let ci = 0; ci < cellCount; ci += 1) {
            walkList(sec, para, [...hostPath, { controlIndex: ctrl, cellIndex: ci }])
          }
          if (hostPath.length === 0) {
            try {
              const tp = JSON.parse(doc.getTableProperties(sec, para, ctrl)) as {
                hasCaption?: boolean
              }
              if (tp.hasCaption) {
                walkList(sec, para, [{ controlIndex: ctrl, cellIndex: TABLE_CAPTION_CELL }])
              }
            } catch {
              // no caption
            }
          }
          return
        }
        if (/<img[\s>]/i.test(cleaned)) {
          walkList(sec, para, [...hostPath, { controlIndex: ctrl, cellIndex: 0 }])
          return
        }
        if (kind === 'Shape') {
          for (let ci = 0; ci < 256; ci += 1) {
            const list = [...hostPath, { controlIndex: ctrl, cellIndex: ci }]
            let cnt: number
            try {
              cnt =
                list.length === 1
                  ? doc.getCellParagraphCount(sec, para, ctrl, ci)
                  : doc.getCellParagraphCountByPath(
                      sec,
                      para,
                      JSON.stringify([
                        ...hostPath,
                        { controlIndex: ctrl, cellIndex: ci, cellParaIndex: 0 },
                      ]),
                    )
            } catch {
              cnt = 0
            }
            if (cnt <= 0) break
            walkList(sec, para, list)
          }
          return
        }
        if (hostPath.length === 0) {
          try {
            const fn = JSON.parse(doc.getFootnoteInfo(sec, para, ctrl)) as {
              ok?: boolean
              texts?: string[]
            }
            if (fn.ok && fn.texts) {
              for (const t of fn.texts) pushText(t)
            }
          } catch {
            // not a note
          }
        }
      }

      for (let sec = 0; sec < doc.getSectionCount(); sec += 1) {
        for (let p = 0; p < doc.getParagraphCount(sec); p += 1) {
          const len = doc.getParagraphLength(sec, p)
          if (len > 0) pushText(doc.getTextRange(sec, p, 0, len))
          let ctrlCount: number
          try {
            const pos = JSON.parse(doc.getControlTextPositions(sec, p)) as unknown[]
            ctrlCount = Array.isArray(pos) ? pos.length : 0
          } catch {
            ctrlCount = 0
          }
          for (let c = 0; c < ctrlCount; c += 1) {
            try {
              const raw = doc.exportControlHtml(sec, p, '[]', c)
              walkControl(sec, p, [], c, raw)
            } catch {
              // ignore
            }
          }
        }
      }
      return texts
    }

    const mobileFixturesDir = join(__dirname, 'fixtures')
    const allFixtureFiles = [
      ...readdirSync(fixtures)
        .filter((f) => f.endsWith('.hwp') || f.endsWith('.hwpx'))
        .sort()
        .map((f) => ({ name: f, path: join(fixtures, f) })),
      ...readdirSync(mobileFixturesDir)
        .filter((f) => f.endsWith('.hwp') || f.endsWith('.hwpx'))
        .sort()
        .map((f) => ({ name: `mobile/${f}`, path: join(mobileFixturesDir, f) })),
    ]
    expect(allFixtureFiles.length).toBeGreaterThan(30)

    const omissions: Array<{ doc: string; text: string; expected: number; found: number }> = []
    for (const file of allFixtureFiles) {
      const doc = new HwpDocument(new Uint8Array(readFileSync(file.path)))
      try {
        const expectedTexts = collectEngineParagraphTexts(doc)
        const html = buildFlowHtml(doc as unknown as FlowEngineDocument)
        const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
        // Strip elements hidden in reading mode so hidden text cannot mask an omission.
        for (const el of parsed.body.querySelectorAll(
          '.flow-spacer-row, .flow-spacer-cell, .flow-box-empty, .flow-edge-empty, .flow-divider-row .flow-p',
        )) {
          el.remove()
        }
        const visibleFlowText = norm(parsed.body.textContent ?? '')

        const expectedCounts = new Map<string, number>()
        for (const t of expectedTexts) {
          expectedCounts.set(t, (expectedCounts.get(t) ?? 0) + 1)
        }
        for (const [t, expected] of expectedCounts) {
          let found = 0
          let pos = 0
          while (true) {
            const idx = visibleFlowText.indexOf(t, pos)
            if (idx < 0) break
            found += 1
            pos = idx + t.length
          }
          if (found < expected) {
            omissions.push({ doc: file.name, text: t.slice(0, 60), expected, found })
          }
        }
      } finally {
        doc.free()
      }
    }

    expect(omissions).toEqual([])
  }, 60_000)

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
