/**
 * Visual Organize Pages assembly (PDF tools v2): reorders, rotates, deletes,
 * duplicates, inserts blank pages, interleaves pages from additional PDFs, or
 * extracts a selected subset of pages into a new PDF without mutating sources.
 */
import { PDFDocument, degrees } from 'pdf-lib'

export interface OrganizePageSpec {
  /** picked/inserted PDF input id, or 'blank' for an inserted blank page */
  sourceId: string | 'blank'
  /** 0-based page index in sourceId (ignored when sourceId === 'blank') */
  sourcePageIndex: number
  /** clockwise extra rotation added on top of the source page's /Rotate */
  extraRotation: 0 | 90 | 180 | 270
  /** page size in points for 'blank' pages (default: A4 595 x 842) */
  widthPt?: number
  heightPt?: number
}

const DEFAULT_BLANK_W = 595
const DEFAULT_BLANK_H = 842

export async function organizePdfBytes(
  sources: ReadonlyMap<string, Uint8Array>,
  plan: readonly OrganizePageSpec[],
): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error('empty-organize')

  const loaded = new Map<string, PDFDocument>()
  for (const item of plan) {
    if (item.sourceId === 'blank') continue
    if (!loaded.has(item.sourceId)) {
      const bytes = sources.get(item.sourceId)
      if (!bytes) throw new Error(`missing organize source: ${item.sourceId}`)
      loaded.set(item.sourceId, await PDFDocument.load(bytes, { updateMetadata: false }))
    }
    const srcDoc = loaded.get(item.sourceId)!
    const count = srcDoc.getPageCount()
    if (
      !Number.isInteger(item.sourcePageIndex) ||
      item.sourcePageIndex < 0 ||
      item.sourcePageIndex >= count
    ) {
      throw new Error(`page index out of range: ${item.sourcePageIndex}`)
    }
  }

  const out = await PDFDocument.create()
  for (const item of plan) {
    if (item.sourceId === 'blank') {
      const w = item.widthPt && item.widthPt > 0 ? item.widthPt : DEFAULT_BLANK_W
      const h = item.heightPt && item.heightPt > 0 ? item.heightPt : DEFAULT_BLANK_H
      const page = out.addPage([w, h])
      if (item.extraRotation) page.setRotation(degrees(item.extraRotation))
      continue
    }
    const srcDoc = loaded.get(item.sourceId)!
    const [copied] = await out.copyPages(srcDoc, [item.sourcePageIndex])
    const page = out.addPage(copied!)
    if (item.extraRotation) {
      const orig = page.getRotation().angle
      const next = (((orig + item.extraRotation) % 360) + 360) % 360
      page.setRotation(degrees(next))
    }
  }

  return out.save({ useObjectStreams: false })
}
