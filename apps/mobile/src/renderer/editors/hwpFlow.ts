/**
 * HWP flow (reading) view: rebuilds the document as HTML that reflows to the
 * screen width (design system 5.3, decision 0163).
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
  getParaPropertiesAt(sectionIdx: number, paraIdx: number): string
  getCellParaPropertiesAtByPath(sectionIdx: number, paraIdx: number, pathJson: string): string
  getBulletList(): string
  getFootnoteInfo(sectionIdx: number, paraIdx: number, controlIdx: number): string
  getHeaderFooter(sectionIdx: number, isHeader: boolean, applyTo: number): string
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
  getTableProperties(sectionIdx: number, paraIdx: number, controlIdx: number): string
  getCellParagraphCount(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
  ): number
  getCellParagraphLength(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
  ): number
  getTextInCell(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    offset: number,
    count: number,
  ): string
  getCellParaPropertiesAt(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
  ): string
  getCellCharPropertiesAt(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    offset: number,
  ): string
}

/** Cell number the engine's flat cell calls use for a table's caption. */
export const TABLE_CAPTION_CELL = 65534

/**
 * A one-step path (a cell of a body-level table, a text box, a caption) as the
 * flat cell call arguments. Those calls are the only ones that reach table
 * captions and that split or join paragraphs in text boxes and captions; the
 * path calls handle only table cells there. Deeper paths return null.
 */
export function flatStep(
  path: readonly CellStep[],
): { ctrl: number; cell: number; cellPara: number } | null {
  if (path.length !== 1) return null
  const [step] = path
  return { ctrl: step.controlIndex, cell: step.cellIndex ?? 0, cellPara: step.cellParaIndex ?? 0 }
}

/** Number of paragraphs in the cell, caption or text box that `list` points to. */
export function listParagraphCount(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  list: readonly CellStep[],
): number {
  const flat = flatStep(list)
  return flat
    ? doc.getCellParagraphCount(sec, para, flat.ctrl, flat.cell)
    : doc.getCellParagraphCountByPath(sec, para, JSON.stringify(cellParaPath(list, 0)))
}

/** Length of the paragraph `path` points to inside a cell, caption or text box. */
export function listParagraphLength(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[],
): number {
  const flat = flatStep(path)
  return flat
    ? doc.getCellParagraphLength(sec, para, flat.ctrl, flat.cell, flat.cellPara)
    : doc.getCellParagraphLengthByPath(sec, para, JSON.stringify(path))
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

/** Private-use bullet glyphs need the document's symbol font; show a plain bullet instead. */
const FALLBACK_BULLET = '•'

const bulletCache = new WeakMap<FlowSourceDocument, Map<number, string>>()

function bulletChar(doc: FlowSourceDocument, id: number): string {
  let bullets = bulletCache.get(doc)
  if (!bullets) {
    bullets = new Map()
    try {
      const list = JSON.parse(doc.getBulletList()) as { id: number; char: string }[]
      for (const b of list) {
        const code = b.char.codePointAt(0) ?? 0
        const usable = b.char.trim() !== '' && !(code >= 0xe000 && code <= 0xf8ff)
        bullets.set(b.id, usable ? b.char : FALLBACK_BULLET)
      }
    } catch {
      // no bullet table: every bullet paragraph gets the plain bullet
    }
    bulletCache.set(doc, bullets)
  }
  return bullets.get(id) ?? FALLBACK_BULLET
}

/**
 * The bullet shown before a paragraph, or ''.
 *
 * Automatic numbers (1., 가., ①) are not shown: the engine works them out
 * while laying out pages and does not hand out the number text.
 */
function paragraphMarker(doc: FlowSourceDocument, propsJson: () => string): string {
  try {
    const props = JSON.parse(propsJson()) as { headType?: string; numberingId?: number }
    return props.headType === 'Bullet' ? bulletChar(doc, props.numberingId ?? 0) : ''
  } catch {
    return ''
  }
}

/**
 * Puts the bullet on the paragraph's first line. It is drawn by CSS
 * (`data-marker`), so it never becomes part of the editable text.
 */
function withMarker(html: string, marker: string): string {
  if (!marker) return html
  const attr = ` data-marker="${escapeAttr(marker).replace(/"/g, '&quot;')}"`
  if (!html) return `<p${attr}><br></p>`
  return /<p[\s>]/.test(html) ? html.replace(/<p(?=[\s>])/, `<p${attr}`) : html
}

/** HTML of one body paragraph's text. */
export function bodyParagraphHtml(doc: FlowSourceDocument, sec: number, para: number): string {
  const length = doc.getParagraphLength(sec, para)
  const html =
    length > 0 ? stripClipboardFragment(doc.exportSelectionHtml(sec, para, 0, para, length)) : ''
  return withMarker(
    html,
    paragraphMarker(doc, () => doc.getParaPropertiesAt(sec, para)),
  )
}

/** HTML of one cell paragraph's text (`path` ends at that paragraph). */
export function cellParagraphHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[],
): string {
  const json = JSON.stringify(path)
  const flat = flatStep(path)
  const length = listParagraphLength(doc, sec, para, path)
  const k = path[path.length - 1].cellParaIndex ?? 0
  const props = () =>
    flat
      ? doc.getCellParaPropertiesAt(sec, para, flat.ctrl, flat.cell, flat.cellPara)
      : doc.getCellParaPropertiesAtByPath(sec, para, json)
  let html = ''
  if (flat && flat.cell === TABLE_CAPTION_CELL) {
    // the engine cannot export a table caption as HTML: show its text with its alignment
    html = captionTextHtml(doc, sec, para, flat, length, props)
  } else if (length > 0) {
    html = stripClipboardFragment(
      doc.exportSelectionInCellHtmlByPath(sec, para, json, k, 0, k, length),
    )
  }
  return withMarker(html, paragraphMarker(doc, props))
}

function captionTextHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  flat: { ctrl: number; cell: number; cellPara: number },
  length: number,
  props: () => string,
): string {
  if (length === 0) return ''
  const text = doc.getTextInCell(sec, para, flat.ctrl, flat.cell, flat.cellPara, 0, length)
  let align = 'left'
  try {
    const value = (JSON.parse(props()) as { alignment?: string }).alignment
    if (value === 'center' || value === 'right' || value === 'justify') align = value
  } catch {
    // keep left
  }
  let font = ''
  try {
    const chars = JSON.parse(
      doc.getCellCharPropertiesAt(sec, para, flat.ctrl, flat.cell, flat.cellPara, 0),
    ) as { fontFamily?: string; fontSize?: number; bold?: boolean }
    // fontSize is in 1/100 pt
    if (chars.fontSize) font += `font-size:${chars.fontSize / 100}pt;`
    if (chars.fontFamily) font += `font-family:'${chars.fontFamily.replace(/['"\\<>]/g, '')}';`
    if (chars.bold) font += 'font-weight:bold;'
  } catch {
    // the frame's default font
  }
  return `<p style="margin:0;text-align:${align};"><span style="${escapeAttr(font)}">${escapeText(text)}</span></p>`
}

/**
 * Exports control `ctrl` of a paragraph; null when there is no such control.
 * Controls the engine cannot export (section settings, shapes, notes) come
 * back as a bare comment and are returned as ''.
 */
function exportControl(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): string | null {
  try {
    const html = stripClipboardFragment(
      doc.exportControlHtml(sec, para, JSON.stringify(hostPath), ctrl),
    )
    return html.replace(/<!--[\s\S]*?-->/g, '').trim()
  } catch {
    return null
  }
}

/**
 * Paragraph list held by a control other than a table: a text box's text or a
 * picture's caption. The engine reaches both as cell 0 of that control.
 */
function innerListPath(hostPath: readonly CellStep[], ctrl: number): CellStep[] {
  return [...hostPath, { controlIndex: ctrl, cellIndex: 0 }]
}

function hasInnerList(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  list: readonly CellStep[],
): boolean {
  try {
    return listParagraphCount(doc, sec, para, list) > 0
  } catch {
    return false
  }
}

/** Where a body-level table's caption sits: 'top', 'bottom', or null for none. */
function tableCaptionSide(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  ctrl: number,
): 'top' | 'bottom' | null {
  try {
    const props = JSON.parse(doc.getTableProperties(sec, para, ctrl)) as {
      hasCaption?: boolean
      captionDirection?: number
    }
    if (!props.hasCaption) return null
    // caption direction: 0 left, 1 right, 2 top, 3 bottom; left/right go above in the flow
    return props.captionDirection === 3 ? 'bottom' : 'top'
  } catch {
    return null
  }
}

function listContainer(
  className: string,
  sec: number,
  para: number,
  list: readonly CellStep[],
  inner: string,
): string {
  return `<div class="${className}" data-sec="${sec}" data-para="${para}" data-cell-path='${escapeAttr(JSON.stringify(list))}'>${inner}</div>`
}

/**
 * Renders one control of a paragraph (body or cell), or '' when there is nothing to show.
 * Tables keep the engine's skeleton; pictures come with their caption; text boxes show their text.
 */
function renderControl(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
  html: string,
): string {
  if (/<table[\s>]/i.test(html)) {
    const table = renderTable(doc, sec, para, hostPath, ctrl, html)
    // table captions are reachable only through the flat cell calls, so only for body-level tables
    const side = hostPath.length === 0 ? tableCaptionSide(doc, sec, para, ctrl) : null
    if (!side) return table
    const list: CellStep[] = [{ controlIndex: ctrl, cellIndex: TABLE_CAPTION_CELL }]
    const caption = listContainer(
      'flow-caption',
      sec,
      para,
      list,
      renderCellContents(doc, sec, para, list),
    )
    return side === 'top' ? caption + table : table + caption
  }
  const list = innerListPath(hostPath, ctrl)
  const inner = hasInnerList(doc, sec, para, list) ? list : null
  if (/<img[\s>]/i.test(html)) {
    if (!inner) return html
    const caption = listContainer(
      'flow-caption',
      sec,
      para,
      inner,
      renderCellContents(doc, sec, para, inner),
    )
    return captionOnTop(doc, sec, para, hostPath, ctrl) ? caption + html : html + caption
  }
  if (inner) {
    return listContainer('flow-box', sec, para, inner, renderCellContents(doc, sec, para, inner))
  }
  return html
}

function captionOnTop(
  doc: FlowSourceDocument & Partial<CaptionSource>,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): boolean {
  try {
    const raw =
      hostPath.length === 0
        ? doc.getPictureProperties?.(sec, para, ctrl)
        : doc.getCellPicturePropertiesByPath?.(sec, para, JSON.stringify(hostPath), ctrl)
    return raw
      ? (JSON.parse(raw) as { captionDirection?: string }).captionDirection === 'Top'
      : false
  } catch {
    return false
  }
}

/** Optional: where a picture's caption sits. Without it, captions go below. */
interface CaptionSource {
  getPictureProperties(sectionIdx: number, paraIdx: number, controlIdx: number): string
  getCellPicturePropertiesByPath(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    controlIdx: number,
  ): string
}

/** Footnote or endnote text anchored on a body paragraph's control, or null. */
function noteHtml(doc: FlowSourceDocument, sec: number, para: number, ctrl: number): string | null {
  try {
    const info = JSON.parse(doc.getFootnoteInfo(sec, para, ctrl)) as {
      ok?: boolean
      texts?: string[]
    }
    if (!info.ok || !info.texts?.length) return null
    const body = info.texts.map((t) => `<p>${escapeText(t)}</p>`).join('')
    return `<div class="flow-note" contenteditable="false">${body}</div>`
  } catch {
    return null
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Header or footer text of a section (both-pages first, then odd, then even), or ''. */
function headerFooterHtml(doc: FlowSourceDocument, sec: number, isHeader: boolean): string {
  for (const applyTo of [0, 2, 1]) {
    try {
      const info = JSON.parse(doc.getHeaderFooter(sec, isHeader, applyTo)) as {
        exists?: boolean
        text?: string
      }
      const text = info.exists ? (info.text ?? '').replace(/\s+/g, ' ').trim() : ''
      if (text) {
        return `<div class="flow-hf" contenteditable="false">${escapeText(text)}</div>`
      }
    } catch {
      // no header/footer API answer for this section: leave it out
    }
  }
  return ''
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
  const count = listParagraphCount(doc, sec, para, cellPath)
  for (let k = 0; k < count; k += 1) {
    const path = cellParaPath(cellPath, k)
    const text = cellParagraphHtml(doc, sec, para, path)
    const objects: string[] = []
    for (let ctrl = 0; ; ctrl += 1) {
      const html = exportControl(doc, sec, para, path, ctrl)
      if (html === null) break
      const inner = renderControl(doc, sec, para, path, ctrl, html)
      if (inner) objects.push(`<div class="flow-obj">${inner}</div>`)
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
    const header = headerFooterHtml(doc, sec, true)
    if (header) parts.push(header)
    const paras = doc.getParagraphCount(sec)
    for (let para = 0; para < paras; para += 1) {
      const controls = controlCount(doc.getControlTextPositions(sec, para))
      const text = bodyParagraphHtml(doc, sec, para)
      // A paragraph that only anchors a table or picture shows just that object.
      if (text || controls === 0) parts.push(blockDiv(sec, para, null, text))
      const notes: string[] = []
      for (let ctrl = 0; ctrl < controls; ctrl += 1) {
        const html = exportControl(doc, sec, para, [], ctrl)
        if (html === null) continue
        const inner = renderControl(doc, sec, para, [], ctrl, html)
        if (inner) {
          parts.push(
            `<div class="flow-obj" data-sec="${sec}" data-para="${para}" data-ctrl="${ctrl}">${inner}</div>`,
          )
          continue
        }
        const note = noteHtml(doc, sec, para, ctrl)
        if (note) notes.push(note)
      }
      // notes follow the paragraph that refers to them
      parts.push(...notes)
    }
    const footer = headerFooterHtml(doc, sec, false)
    if (footer) parts.push(footer)
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
/* bullets are drawn here so they never become editable text */
.flow-p p[data-marker]::before { content: attr(data-marker); margin-right: 0.4em; }
.flow-caption { margin: 2px 0 4px; }
.flow-box { border: 1px solid #b0b0b0; border-radius: 4px; padding: 6px 8px; margin: 4px 0; }
.flow-note { font-size: 0.85em; color: #444444; padding-left: 1em; margin: 0 0 6px; }
.flow-note p { margin: 0; }
.flow-hf { font-size: 0.8em; color: #666666; text-align: center; margin: 0 0 8px; }
`

/** Builds the srcdoc for the sandboxed frame. `zoom` scales all text (document sizes are in pt). */
export function buildFlowDocument(bodyHtml: string, zoom: number, lang: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FLOW_FRAME_CSS}</style><style>:root{--flow-zoom:${zoom}}</style></head><body>${bodyHtml}</body></html>`
}
