/**
 * HWP flow (reading) view: rebuilds the document as HTML that reflows to the
 * screen width (design system 5.3, decision 0165).
 *
 * The rhwp engine has no reflow layout, but it can export a paragraph range as
 * HTML (the copy format) and each table or picture as HTML. The flow view puts
 * them together paragraph by paragraph. Every body paragraph is tagged with its
 * section and paragraph index so later edits can be mapped back to the engine.
 */

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

function exportObjectHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  ctrl: number,
): string {
  try {
    return stripClipboardFragment(doc.exportControlHtml(sec, para, '[]', ctrl))
  } catch {
    return ''
  }
}

/** Builds the flow body HTML. Objects that fail to export are left out, never guessed. */
export function buildFlowHtml(doc: FlowSourceDocument): string {
  const parts: string[] = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec += 1) {
    const paras = doc.getParagraphCount(sec)
    for (let para = 0; para < paras; para += 1) {
      const length = doc.getParagraphLength(sec, para)
      const controls = controlCount(doc.getControlTextPositions(sec, para))
      const text =
        length > 0
          ? stripClipboardFragment(doc.exportSelectionHtml(sec, para, 0, para, length))
          : ''
      // A paragraph that only anchors a table or picture shows just that object.
      if (text || controls === 0) {
        parts.push(
          `<div class="flow-p" data-sec="${sec}" data-para="${para}">${text || '<p><br></p>'}</div>`,
        )
      }
      for (let ctrl = 0; ctrl < controls; ctrl += 1) {
        const html = exportObjectHtml(doc, sec, para, ctrl)
        if (html) {
          parts.push(
            `<div class="flow-obj" data-sec="${sec}" data-para="${para}" data-ctrl="${ctrl}">${html}</div>`,
          )
        }
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
.flow-p p { margin: 0; }
.flow-p, .flow-obj { margin: 0 0 4px; }
.flow-obj { overflow-x: auto; -webkit-overflow-scrolling: touch; }
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
