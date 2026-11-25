// Link targets and the ops that place them (spec 3.10). The rules follow PC
// `apps/pdf/src/renderer/LinkDialog.tsx` (exactly one of an address or a page of
// this document; "www." becomes https; the page number is a visible position mapped
// to its original page) with one narrowing for mobile: only http, https and mailto
// addresses are accepted, the same set the viewer ever follows.
import { viewToPdf, type PageGeom } from '../../../../../../../pdf/src/renderer/annotations'
import type { LocalDrawing } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { DrawingInput } from '../../../../../../../pdf/src/shared/ipc'
import type { EditSnapshot, Op } from '../../edit/types'

type Rect = [number, number, number, number]

/** What a link jumps to: an outside address, or a 1-based original page number. */
export type PdfLinkTarget = { readonly url: string } | { readonly destPage: number }

export type PdfLinkTargetError = 'empty' | 'url' | 'page'

export type PdfLinkTargetResult =
  | { readonly ok: true; readonly target: PdfLinkTarget }
  | { readonly ok: false; readonly error: PdfLinkTargetError }

type LinkInput = Extract<DrawingInput, { kind: 'link' }>

/** A pending link drawing of the edit buckets. */
export type PdfPendingLink = LocalDrawing & { readonly input: LinkInput }

const ALLOWED_URL = /^(https?:\/\/|mailto:)\S+$/i

/** The typed address as it is saved, or null when it is not http, https or mailto. */
export function parseLinkUrl(input: string): string | null {
  let text = input.trim()
  if (/^www\./i.test(text)) text = `https://${text}`
  return ALLOWED_URL.test(text) ? text : null
}

/** The typed page as a 1-based visible position, or null when outside 1..pageCount. */
export function parseLinkPage(input: string, pageCount: number): number | null {
  const text = input.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return Number.isInteger(n) && n >= 1 && n <= pageCount ? n : null
}

/**
 * The pages as the person sees them (PC App `visList`): position → original page
 * index, with the pending order and pending blank pages, deleted pages left out.
 */
export function visiblePageOrder(edits: EditSnapshot, originalPageCount: number): number[] {
  const total = originalPageCount + edits.blankPages.length
  const base = edits.order ?? Array.from({ length: total }, (_, i) => i)
  return base.filter((i) => !edits.deleted.has(i))
}

/**
 * The two fields of the link sheet → the target. The sheet clears one field when
 * the other is typed (PC), so at most one is filled; an address wins if both are.
 */
export function resolveLinkTarget(
  url: string,
  page: string,
  visible: readonly number[],
): PdfLinkTargetResult {
  if (url.trim() !== '') {
    const address = parseLinkUrl(url)
    return address ? { ok: true, target: { url: address } } : { ok: false, error: 'url' }
  }
  if (page.trim() !== '') {
    const position = parseLinkPage(page, visible.length)
    if (position === null) return { ok: false, error: 'page' }
    // PC: (visList[n - 1] ?? n - 1) + 1, the original page under that position
    return { ok: true, target: { destPage: (visible[position - 1] ?? position - 1) + 1 } }
  }
  return { ok: false, error: 'empty' }
}

/** The page field of an existing link: its visible position, empty when that page is gone. */
export function pageFieldOf(destPage: number | undefined, visible: readonly number[]): string {
  if (destPage === undefined) return ''
  const position = visible.indexOf(destPage - 1)
  return position < 0 ? '' : String(position + 1)
}

/** A finger drag in page CSS px → the PDF user-space box, or null for a tap (PC: under 3pt both ways). */
export function dragToPdfRect(
  geom: PageGeom,
  scale: number,
  from: readonly [number, number],
  to: readonly [number, number],
): Rect | null {
  const [ax, ay] = viewToPdf(geom, from[0] / scale, from[1] / scale)
  const [bx, by] = viewToPdf(geom, to[0] / scale, to[1] / scale)
  const rect: Rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
  if (rect.some((n) => !Number.isFinite(n))) return null
  if (rect[2] - rect[0] < 3 && rect[3] - rect[1] < 3) return null
  return rect
}

function linkDrawing(pageIndex: number, rect: Rect, target: PdfLinkTarget): LinkInput {
  return {
    kind: 'link',
    pageIndex,
    rect,
    ...('destPage' in target ? { destPage: target.destPage } : { url: target.url }),
  }
}

/** PC: the drawn box joins the edits once it has its target. */
export function addLinkOps(pageIndex: number, rect: Rect, target: PdfLinkTarget): Op[] {
  return [{ op: 'addDrawing', drawing: linkDrawing(pageIndex, rect, target) }]
}

/** A new target for a pending link: one undo step, same record id and box. */
export function retargetLinkOps(link: PdfPendingLink, target: PdfLinkTarget): Op[] {
  const { pageIndex, rect } = link.input
  return [
    { op: 'removeDrawing', id: link.id },
    { op: 'addDrawing', id: link.id, drawing: linkDrawing(pageIndex, rect, target) },
  ]
}

export function removeLinkOps(link: PdfPendingLink): Op[] {
  return [{ op: 'removeDrawing', id: link.id }]
}

/** The pending links on one original page, in edit order. */
export function pendingLinksOn(edits: EditSnapshot, pageIndex: number): PdfPendingLink[] {
  return edits.drawings.filter(
    (d): d is PdfPendingLink => d.input.kind === 'link' && d.input.pageIndex === pageIndex,
  )
}
