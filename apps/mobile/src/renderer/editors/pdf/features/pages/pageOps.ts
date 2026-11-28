// Page operations of the organizer sheet (spec 3.9) as PC edit ops, and the rules of
// taking pages from another PDF. No React here: the sheet and the tests call these.
//
// Pages are named by their original index, as in the PC editor: a pending blank page
// is appended after the document's pages, the visible order is `order` without the
// deleted ones (PC `visList`), and `setPageOrder` lists every original page once with
// the deleted ones at the tail (PC `commitOrder`).
import { geomDispSize } from '../../../../../../../pdf/src/renderer/annotations'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../../../i18n/strings'
import { snapshotHasEdits } from '../../edit/editStore'
import { visiblePageList } from '../../edit/saveRequest'
import type { EditSnapshot, Op, PdfEditServices } from '../../edit/types'
import type { PageGeom, PdfOpenedDocument } from '../../view'

/** Original page count including pending blank pages (the op context's `pageCount`). */
export function allPageCount(edits: EditSnapshot, documentPages: number): number {
  return documentPages + edits.blankPages.length
}

/** Visible pages in order: original indices, pending blank pages included, deleted left out. */
export function visiblePages(edits: EditSnapshot, documentPages: number): number[] {
  return visiblePageList(edits, documentPages)
}

/** `pages` in visible order (pages that are not visible are dropped). */
export function inVisibleOrder(visible: readonly number[], pages: Iterable<number>): number[] {
  const wanted = new Set(pages)
  return visible.filter((p) => wanted.has(p))
}

/** Turn the pages a quarter clockwise (PC `rotatePages`, dir 90). */
export function rotateOps(pages: readonly number[]): Op[] {
  return pages.length === 0 ? [] : [{ op: 'rotatePages', pages: [...pages], dir: 90 }]
}

/** Delete the pages as one batch; null when that would leave no page (the last one stays). */
export function deleteOps(visible: readonly number[], pages: readonly number[]): Op[] | null {
  const gone = new Set(pages.filter((p) => visible.includes(p)))
  if (gone.size === 0) return []
  if (gone.size >= visible.length) return null
  return [...gone].map((pageIndex): Op => ({ op: 'deletePage', pageIndex }))
}

/**
 * The visible order after moving `moving` as one block into the gap `gap` of
 * `visible` (0 = before the first page, visible.length = after the last).
 */
export function reorderVisible(
  visible: readonly number[],
  moving: ReadonlySet<number>,
  gap: number,
): number[] {
  const kept: number[] = []
  let at = -1
  visible.forEach((page, i) => {
    if (i === gap) at = kept.length
    if (!moving.has(page)) kept.push(page)
  })
  if (at < 0) at = kept.length
  const block = visible.filter((p) => moving.has(p))
  return [...kept.slice(0, at), ...block, ...kept.slice(at)]
}

/** PC `commitOrder`: the new visible order, then every other original page (deleted) at the tail. */
export function pageOrderOp(nextVisible: readonly number[], allPages: number): Op {
  const listed = new Set(nextVisible)
  const tail = Array.from({ length: allPages }, (_, i) => i).filter((i) => !listed.has(i))
  return { op: 'setPageOrder', order: [...nextVisible, ...tail] }
}

/** The order op for a move, or null when the order does not change. */
export function moveOps(
  visible: readonly number[],
  moving: ReadonlySet<number>,
  gap: number,
  allPages: number,
): Op[] | null {
  const next = reorderVisible(visible, moving, gap)
  if (next.every((p, i) => p === visible[i])) return null
  return [pageOrderOp(next, allPages)]
}

/** Display size of an original page (pending rotation included), a blank page's own size for blank ones. */
export function pageDisplaySize(
  edits: EditSnapshot,
  documentPages: number,
  pageGeom: (pageIndex: number) => PageGeom,
  pageIndex: number,
): { width: number; height: number } {
  if (pageIndex < documentPages) return geomDispSize(pageGeom(pageIndex))
  const blank = edits.blankPages.find((b) => b.input.pageIndex === pageIndex)
  if (!blank) return { width: 595.28, height: 841.89 }
  const turned = ((edits.rotations.get(pageIndex) ?? 0) / 90) % 2 !== 0
  const { width, height } = blank.input
  return turned ? { width: height, height: width } : { width, height }
}

/**
 * A blank page before or after `anchor` (an original index), sized like the anchor
 * (PC `insertBlankPage`: the neighbor's displayed size). Its original index is the
 * next free one; null `after` puts it first.
 */
export function blankPageOp(
  edits: EditSnapshot,
  documentPages: number,
  pageGeom: (pageIndex: number) => PageGeom,
  anchor: number,
  side: 'before' | 'after',
): { op: Op; pageIndex: number } {
  const visible = visiblePages(edits, documentPages)
  const pos = visible.indexOf(anchor)
  const after = side === 'after' ? anchor : pos > 0 ? visible[pos - 1]! : null
  const size = pageDisplaySize(edits, documentPages, pageGeom, anchor)
  const pageIndex = allPageCount(edits, documentPages)
  return {
    op: { op: 'insertBlankPage', after, pageIndex, width: size.width, height: size.height },
    pageIndex,
  }
}

// ── pages from another PDF ──────────────────────────────────────────────────

/**
 * Why pages cannot be taken from another PDF into this document (PC: only a saved,
 * writable, unprotected file); null when they can. The keys are the toast texts.
 */
export function importBlockReason(
  model: Pick<PdfOpenedDocument, 'damaged' | 'encrypted' | 'readOnlyReason' | 'isUntitled'>,
  session: Pick<MobileDocSession, 'writable' | 'ephemeral'>,
): MobileStringKey | null {
  if (model.damaged || model.readOnlyReason === 'damaged') return 'pdfPagesImportDamaged'
  if (model.encrypted || model.readOnlyReason === 'encrypted') return 'pdfPagesImportEncrypted'
  if (model.isUntitled || session.ephemeral) return 'pdfPagesImportUntitled'
  if (model.readOnlyReason !== null || !session.writable) return 'pdfPagesImportReadOnly'
  return null
}

export type PickedPdfCheck =
  | { readonly ok: true; readonly pageCount: number }
  | { readonly ok: false; readonly reason: 'encrypted' | 'unreadable' }

/**
 * Reads the picked PDF's structure without decrypting it: an /Encrypt entry in the
 * trailer means it is locked (pdf-lib `isEncrypted` with `ignoreEncryption`).
 */
export async function checkPickedPdf(bytes: Uint8Array): Promise<PickedPdfCheck> {
  const { PDFDocument } = await import('pdf-lib')
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    if (doc.isEncrypted) return { ok: false, reason: 'encrypted' }
    const pageCount = doc.getPageCount()
    return pageCount > 0 ? { ok: true, pageCount } : { ok: false, reason: 'unreadable' }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** Where the taken pages go: before the first page, after an original page, or after the last. */
export type ImportPlace =
  | { readonly kind: 'front' }
  | { readonly kind: 'end' }
  | { readonly kind: 'after'; readonly page: number }

/**
 * The PC `afterPageIndex` of the insert. The pending edits are saved first, which
 * writes the visible order into the file, so an original page's place becomes its
 * visible position (PC `insertPdf`); -1 = in front.
 */
export function importAfterIndex(visible: readonly number[], place: ImportPlace): number {
  if (place.kind === 'front') return -1
  if (place.kind === 'after') {
    const pos = visible.indexOf(place.page)
    if (pos >= 0) return pos
  }
  return visible.length - 1
}

/**
 * The frame service the import writes with: the merged bytes over the open file in
 * place (client `saveFileBytes` with this session). Not in `PdfEditServices` of the
 * PDF-T4 frame yet; the feature offers the import only once the frame lends it.
 */
export interface PdfFileWriteService {
  writeFileBytes(bytes: Uint8Array): Promise<boolean>
}

export function fileWriterOf(
  services: PdfEditServices,
): ((bytes: Uint8Array) => Promise<boolean>) | null {
  const write = (services as PdfEditServices & Partial<PdfFileWriteService>).writeFileBytes
  return typeof write === 'function' ? (bytes) => write.call(services, bytes) : null
}

export type ImportOutcome = 'done' | 'blocked' | 'saveFailed' | 'insertFailed' | 'writeFailed'

/**
 * PC Import pages after the confirmation: save the pending edits (stop if that
 * fails), insert every page of `other` into the saved bytes with the PC code in the
 * engine, write the result over the file, then reload this session from it.
 */
export async function runPdfImport(input: {
  readonly services: PdfEditServices
  readonly write: (bytes: Uint8Array) => Promise<boolean>
  readonly other: Uint8Array
  readonly place: ImportPlace
}): Promise<{ outcome: ImportOutcome; count: number }> {
  const { services, write, other, place } = input
  const before = services.getModel()
  if (importBlockReason(before, services.getSession()) !== null) {
    return { outcome: 'blocked', count: 0 }
  }
  const afterIndex = importAfterIndex(visiblePages(services.getEdits(), before.pages.length), place)
  const hadEdits = snapshotHasEdits(services.getEdits())
  if (!(await services.saveNow())) return { outcome: 'saveFailed', count: 0 }
  const saved = services.getModel()
  // a save that could not reload the written file leaves the old bytes here: stop
  if (hadEdits && saved === before) return { outcome: 'saveFailed', count: 0 }
  let merged: Uint8Array
  let count: number
  try {
    ;({ merged, count } = await services.engine().insertPdf(saved.originalBytes, other, afterIndex))
  } catch {
    return { outcome: 'insertFailed', count: 0 }
  }
  if (!(await write(merged))) return { outcome: 'writeFailed', count: 0 }
  await services.reopenFromBytes(merged)
  return { outcome: 'done', count }
}
