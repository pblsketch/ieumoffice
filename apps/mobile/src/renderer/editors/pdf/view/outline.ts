// Outline (bookmarks) for viewing: PC OutlinePanel's node shape and depth limit,
// flattened into rows for a phone list. Editing bookmarks is not part of the mobile editor.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  MAX_OUTLINE_DEPTH,
  type OutlineNode,
} from '../../../../../../pdf/src/renderer/OutlinePanel'

export interface PdfOutlineRow {
  readonly title: string
  /** 0 for top-level entries. */
  readonly depth: number
  readonly bold: boolean
  readonly italic: boolean
  readonly dest: unknown
  /** External address, only for http, https and mailto. */
  readonly url: string | null
}

const SAFE_URL = /^(https?:|mailto:)/i

/** An address the viewer may hand to the system browser; anything else is not followed. */
export function safeExternalUrl(url: unknown): string | null {
  return typeof url === 'string' && SAFE_URL.test(url.trim()) ? url.trim() : null
}

/** Document order, children after their parent; nesting deeper than the PC limit is dropped. */
export function flattenOutline(nodes: readonly OutlineNode[]): PdfOutlineRow[] {
  const rows: PdfOutlineRow[] = []
  const walk = (list: readonly OutlineNode[], depth: number) => {
    for (const node of list) {
      rows.push({
        title: node.title,
        depth,
        bold: node.bold === true,
        italic: node.italic === true,
        dest: node.dest ?? null,
        url: safeExternalUrl(node.url),
      })
      if (depth < MAX_OUTLINE_DEPTH && node.items?.length) walk(node.items, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}

export async function loadPdfOutline(doc: PDFDocumentProxy): Promise<PdfOutlineRow[]> {
  const outline = await doc.getOutline().catch(() => null)
  return outline ? flattenOutline(outline as OutlineNode[]) : []
}

/** PC `goToDest`: a named or explicit destination → 0-based page index, null when unresolvable. */
export async function resolveDestPageIndex(
  doc: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>,
  dest: unknown,
): Promise<number | null> {
  try {
    const arr = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(arr)) return null
    const ref = arr[0]
    if (typeof ref === 'number') return ref
    return await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
  } catch {
    // corrupted destination
    return null
  }
}
