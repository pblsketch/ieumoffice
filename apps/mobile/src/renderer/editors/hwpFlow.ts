/**
 * HWP flow (reading) view: rebuilds the document as HTML that reflows to the
 * screen width (design system 5.3, decision 0165).
 *
 * The rhwp engine has no reflow layout, but it can export a paragraph range as
 * HTML (the copy format) and each table or picture as HTML. The flow view puts
 * them together paragraph by paragraph.
 *
 * Every text block carries its engine address so edits can go back to the
 * engine at the same place:
 * - a body paragraph: `.flow-p[data-sec][data-para]`
 * - a paragraph inside a table cell (any depth): the same plus `data-path`, the
 *   engine's cell path `[{controlIndex, cellIndex, cellParaIndex}, ...]` from the
 *   body paragraph down to that cell paragraph.
 *
 * Tables keep the engine's own skeleton (borders, widths, fills, merged cells);
 * each cell's contents are rebuilt paragraph by paragraph, because the exported
 * table HTML drops empty paragraphs and so cannot be mapped back.
 */

/** One step of an engine cell path. */
export interface CellStep {
  readonly controlIndex: number
  readonly cellIndex?: number
  readonly cellParaIndex?: number
}

/** The part of the rhwp `HwpDocument` API the flow builder needs. */
export interface FlowSourceDocument {
  getSectionCount(): number
  getParagraphCount(sectionIdx: number): number
  getParagraphLength(sectionIdx: number, paraIdx: number): number
  getControlTextPositions(sectionIdx: number, paraIdx: number): string
  exportSelectionHtml(
    sectionIdx: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
  ): string
  exportControlHtml(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    controlIdx: number,
  ): string
  getCellParagraphCountByPath(sectionIdx: number, paraIdx: number, pathJson: string): number
  getCellParagraphLengthByPath(sectionIdx: number, paraIdx: number, pathJson: string): number
  exportSelectionInCellHtmlByPath(
    sectionIdx: number,
    paraIdx: number,
    pathJson: string,
    startCellPara: number,
    startOffset: number,
    endCellPara: number,
    endOffset: number,
  ): string
}

/** Keeps only what sits between the clipboard fragment markers. */
export function stripClipboardFragment(html: string): string {
  const start = html.indexOf('<!--StartFragment-->')
  const end = html.indexOf('<!--EndFragment-->')
  if (start < 0 || end < start) return html
  return html.slice(start + '<!--StartFragment-->'.length, end).trim()
}

function controlCount(positionsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(positionsJson)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/** Path to a paragraph inside a cell: the cell path with that paragraph's index. */
export function cellParaPath(cell: readonly CellStep[], cellParaIndex: number): CellStep[] {
  const last = cell[cell.length - 1]
  return [...cell.slice(0, -1), { ...last, cellParaIndex }]
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
}

function blockDiv(sec: number, para: number, path: readonly CellStep[] | null, inner: string) {
  const pathAttr = path ? ` data-path='${escapeAttr(JSON.stringify(path))}'` : ''
  return `<div class="flow-p" data-sec="${sec}" data-para="${para}"${pathAttr}>${inner || '<p><br></p>'}</div>`
}

/** HTML of one body paragraph's text. */
export function bodyParagraphHtml(doc: FlowSourceDocument, sec: number, para: number): string {
  const length = doc.getParagraphLength(sec, para)
  return length > 0
    ? stripClipboardFragment(doc.exportSelectionHtml(sec, para, 0, para, length))
    : ''
}

/** HTML of one cell paragraph's text (`path` ends at that paragraph). */
export function cellParagraphHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[],
): string {
  const json = JSON.stringify(path)
  const length = doc.getCellParagraphLengthByPath(sec, para, json)
  if (length === 0) return ''
  const k = path[path.length - 1].cellParaIndex ?? 0
  return stripClipboardFragment(
    doc.exportSelectionInCellHtmlByPath(sec, para, json, k, 0, k, length),
  )
}

/** Exports control `ctrl` of a paragraph; null when there is no such control. */
function exportControl(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): string | null {
  try {
    return stripClipboardFragment(doc.exportControlHtml(sec, para, JSON.stringify(hostPath), ctrl))
  } catch {
    return null
  }
}

/** Renders a table: the engine's skeleton with each cell's contents rebuilt. */
function renderTable(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
  skeletonHtml: string,
): string {
  const parsed = new DOMParser().parseFromString(`<body>${skeletonHtml}</body>`, 'text/html')
  const table = parsed.body.querySelector('table')
  if (!table) return skeletonHtml
  const cells = [
    ...table.querySelectorAll<HTMLTableCellElement>(':scope > tbody > tr > td, :scope > tr > td'),
  ]
  cells.forEach((td, cellIndex) => {
    const cellPath: CellStep[] = [...hostPath, { controlIndex: ctrl, cellIndex }]
    td.setAttribute('data-sec', String(sec))
    td.setAttribute('data-para', String(para))
    td.setAttribute('data-cell-path', JSON.stringify(cellPath))
    td.innerHTML = renderCellContents(doc, sec, para, cellPath)
  })
  return table.outerHTML
}

/** Renders every paragraph of a cell, with nested tables and pictures in place. */
export function renderCellContents(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  cellPath: readonly CellStep[],
): string {
  const parts: string[] = []
  const count = doc.getCellParagraphCountByPath(
    sec,
    para,
    JSON.stringify(cellParaPath(cellPath, 0)),
  )
  for (let k = 0; k < count; k += 1) {
    const path = cellParaPath(cellPath, k)
    const text = cellParagraphHtml(doc, sec, para, path)
    const objects: string[] = []
    for (let ctrl = 0; ; ctrl += 1) {
      const html = exportControl(doc, sec, para, path, ctrl)
      if (html === null) break
      if (!html) continue
      objects.push(
        /<table[\s>]/i.test(html)
          ? `<div class="flow-obj">${renderTable(doc, sec, para, path, ctrl, html)}</div>`
          : `<div class="flow-obj">${html}</div>`,
      )
    }
    if (text || objects.length === 0) parts.push(blockDiv(sec, para, path, text))
    parts.push(...objects)
  }
  return parts.join('')
}

/** Builds the flow body HTML. Objects that fail to export are left out, never guessed. */
export function buildFlowHtml(doc: FlowSourceDocument): string {
  const parts: string[] = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec += 1) {
    const paras = doc.getParagraphCount(sec)
    for (let para = 0; para < paras; para += 1) {
      const controls = controlCount(doc.getControlTextPositions(sec, para))
      const text = bodyParagraphHtml(doc, sec, para)
      // A paragraph that only anchors a table or picture shows just that object.
      if (text || controls === 0) parts.push(blockDiv(sec, para, null, text))
      for (let ctrl = 0; ctrl < controls; ctrl += 1) {
        const html = exportControl(doc, sec, para, [], ctrl)
        if (!html) continue
        const inner = /<table[\s>]/i.test(html) ? renderTable(doc, sec, para, [], ctrl, html) : html
        parts.push(
          `<div class="flow-obj" data-sec="${sec}" data-para="${para}" data-ctrl="${ctrl}">${inner}</div>`,
        )
      }
    }
  }
  return parts.join('\n')
}

/** Reading styles inside the sandboxed flow frame. Document colors stay as the document set them. */
export const FLOW_FRAME_CSS = `
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 16px 16px 96px;
  background: #ffffff;
  color: #000000;
  word-break: keep-all;
  overflow-wrap: anywhere;
  zoom: var(--flow-zoom, 1.2);
}
body[contenteditable='true'] { outline: none; caret-color: #1a73e8; }
.flow-p p { margin: 0; }
.flow-p, .flow-obj { margin: 0 0 4px; }
td .flow-p, td .flow-obj { margin: 0; }
.flow-obj { overflow-x: auto; -webkit-overflow-scrolling: touch; }
td .flow-obj { overflow-x: visible; }
.flow-obj table { border-collapse: collapse; max-width: none; }
.flow-obj td, .flow-obj th { vertical-align: top; min-width: 3.2em; }
/* keep short labels (two or three syllables) on one line instead of one per line */
.flow-obj td p, .flow-obj th p { word-break: keep-all; }
img { max-width: 100%; height: auto; }
`

/** Builds the srcdoc for the sandboxed frame. `zoom` scales all text (document sizes are in pt). */
export function buildFlowDocument(bodyHtml: string, zoom: number, lang: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FLOW_FRAME_CSS}</style><style>:root{--flow-zoom:${zoom}}</style></head><body>${bodyHtml}</body></html>`
}
