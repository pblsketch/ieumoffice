/**
 * Enhanced PDF merge (PDF tools v2): per-file page ranges, automatic top-level
 * filename bookmarks with preserved source outlines nested underneath, and
 * optional uniform paper sizing. Keeps save-pdf.ts untouched.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'

export interface MergeV2Input {
  bytes: Uint8Array
  /** display filename (used for top-level bookmark title after stripping extension) */
  name: string
  /** 0-based page indices to include; omitted = all pages in order */
  pages?: number[]
}

export interface MergeV2Options {
  /** add top-level bookmarks from input filenames and nest source outlines (default: true) */
  addBookmarks?: boolean
  /** portrait target paper size in points; null/omitted keeps original page sizes */
  unifyPaper?: { w: number; h: number } | null
}

export interface MergeV2Result {
  bytes: Uint8Array
  totalPages: number
  bookmarkCount: number
}

interface OutlineNode {
  title: string
  /** target page index in the merged document */
  targetPageIndex: number
  children: OutlineNode[]
}

function stripFileExtension(name: string): string {
  const cleaned = name.replace(/\.(drawio\.(svg|png)|[a-z0-9]{1,10})$/i, '').trim()
  return cleaned || name || 'Document'
}

function decodeOutlineTitle(value: unknown): string {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  return ''
}

/** Resolve an outline item's destination to a 0-based page index in `srcDoc`, or -1 */
function resolveOutlinePageIndex(
  srcDoc: PDFDocument,
  item: PDFDict,
  pageRefToIndex: Map<string, number>,
): number {
  let dest: unknown = item.get(PDFName.of('Dest'))
  if (!dest) {
    const action = item.lookupMaybe(PDFName.of('A'), PDFDict)
    if (action) {
      const s = action.lookup(PDFName.of('S'))
      if (s instanceof PDFName && s.decodeText() === 'GoTo') {
        dest = action.get(PDFName.of('D'))
      }
    }
  }
  const resolved = dest instanceof PDFRef ? srcDoc.context.lookup(dest) : dest
  if (resolved instanceof PDFArray && resolved.size() > 0) {
    const first = resolved.get(0)
    if (first instanceof PDFRef) return pageRefToIndex.get(first.toString()) ?? -1
    if (first instanceof PDFNumber) return first.asNumber()
  }
  return -1
}

/** Extract source document outlines mapped onto merged page indices */
function extractMappedOutlines(
  srcDoc: PDFDocument,
  sourceIndexToMerged: Map<number, number>,
): OutlineNode[] {
  const outlines = srcDoc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!outlines) return []

  const pageRefToIndex = new Map<string, number>()
  const pages = srcDoc.getPages()
  for (let i = 0; i < pages.length; i++) {
    pageRefToIndex.set(pages[i]!.ref.toString(), i)
  }

  const visited = new Set<string>()
  const walkSiblings = (firstRef: unknown): OutlineNode[] => {
    const nodes: OutlineNode[] = []
    let cur: unknown = firstRef
    while (cur instanceof PDFRef) {
      const key = cur.toString()
      if (visited.has(key)) break
      visited.add(key)
      const dict = srcDoc.context.lookup(cur)
      if (!(dict instanceof PDFDict)) break
      const title = decodeOutlineTitle(dict.lookup(PDFName.of('Title'))).trim()
      const srcIdx = resolveOutlinePageIndex(srcDoc, dict, pageRefToIndex)
      const mergedIdx = sourceIndexToMerged.get(srcIdx)
      const children = walkSiblings(dict.get(PDFName.of('First')))
      if (title && mergedIdx !== undefined) {
        nodes.push({ title, targetPageIndex: mergedIdx, children })
      } else if (children.length > 0) {
        // Hoist valid children whose parent pointed to an excluded page
        nodes.push(...children)
      }
      cur = dict.get(PDFName.of('Next'))
    }
    return nodes
  }

  return walkSiblings(outlines.get(PDFName.of('First')))
}

/** Write a complete /Outlines hierarchy into `outDoc` and return total item count */
function writeOutlines(outDoc: PDFDocument, roots: OutlineNode[]): number {
  if (roots.length === 0) return 0
  const { context } = outDoc
  const mergedPages = outDoc.getPages()
  const outlinesRef = context.nextRef()
  let totalItems = 0

  const buildLevel = (
    nodes: OutlineNode[],
    parentRef: PDFRef,
  ): { first: PDFRef; last: PDFRef; visibleCount: number } | null => {
    if (nodes.length === 0) return null
    const refs = nodes.map(() => context.nextRef())
    let visibleCount = 0

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const ref = refs[i]!
      const page = mergedPages[node.targetPageIndex]
      const childInfo = buildLevel(node.children, ref)
      const dict = context.obj({})
      dict.set(PDFName.of('Title'), PDFHexString.fromText(node.title))
      dict.set(PDFName.of('Parent'), parentRef)
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!)
      if (i + 1 < refs.length) dict.set(PDFName.of('Next'), refs[i + 1]!)
      if (page) {
        dict.set(PDFName.of('Dest'), context.obj([page.ref, PDFName.of('Fit')]))
      }
      if (childInfo) {
        dict.set(PDFName.of('First'), childInfo.first)
        dict.set(PDFName.of('Last'), childInfo.last)
        dict.set(PDFName.of('Count'), PDFNumber.of(childInfo.visibleCount))
      }
      context.assign(ref, dict)
      totalItems++
      visibleCount += 1 + (childInfo?.visibleCount ?? 0)
    }

    return { first: refs[0]!, last: refs[refs.length - 1]!, visibleCount }
  }

  const rootInfo = buildLevel(roots, outlinesRef)
  if (!rootInfo) return 0
  const rootDict = context.obj({
    Type: 'Outlines',
    First: rootInfo.first,
    Last: rootInfo.last,
    Count: PDFNumber.of(rootInfo.visibleCount),
  })
  context.assign(outlinesRef, rootDict)
  outDoc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  return totalItems
}

/** Scale and center every page to fit target paper, matching save-pdf.ts setPageSizeBytes */
function applyUniformPaper(doc: PDFDocument, targetW: number, targetH: number): void {
  for (const page of doc.getPages()) {
    const rot = ((page.getRotation().angle % 360) + 360) % 360
    const tw = rot === 90 || rot === 270 ? targetH : targetW
    const th = rot === 90 || rot === 270 ? targetW : targetH
    const { x, y, width: w, height: h } = page.getMediaBox()
    if (w === tw && h === th) continue
    const k = Math.min(tw / w, th / h)
    page.scaleContent(k, k)
    page.scaleAnnotations(k, k)
    const bx = x * k - (tw - w * k) / 2
    const by = y * k - (th - h * k) / 2
    page.setMediaBox(bx, by, tw, th)
    page.setCropBox(bx, by, tw, th)
  }
}

export async function mergePdfV2Bytes(
  inputs: readonly MergeV2Input[],
  options: MergeV2Options = {},
): Promise<MergeV2Result> {
  if (inputs.length === 0) throw new Error('no inputs to merge')
  const addBookmarks = options.addBookmarks ?? true
  const out = await PDFDocument.create()
  const roots: OutlineNode[] = []
  let mergedCursor = 0

  for (const input of inputs) {
    const src = await PDFDocument.load(input.bytes, { updateMetadata: false })
    const count = src.getPageCount()
    const indices =
      input.pages && input.pages.length > 0
        ? input.pages
        : Array.from({ length: count }, (_, i) => i)
    for (const idx of indices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
        throw new Error(`page index out of range: ${idx}`)
      }
    }
    const startMerged = mergedCursor
    const sourceToMerged = new Map<number, number>()
    const copied = await out.copyPages(src, indices)
    for (let i = 0; i < copied.length; i++) {
      out.addPage(copied[i]!)
      if (!sourceToMerged.has(indices[i]!)) {
        sourceToMerged.set(indices[i]!, mergedCursor)
      }
      mergedCursor++
    }
    if (addBookmarks && copied.length > 0) {
      const children = extractMappedOutlines(src, sourceToMerged)
      roots.push({
        title: stripFileExtension(input.name),
        targetPageIndex: startMerged,
        children,
      })
    }
  }

  if (mergedCursor === 0) throw new Error('merged document has zero pages')
  if (options.unifyPaper) {
    applyUniformPaper(out, options.unifyPaper.w, options.unifyPaper.h)
  }
  const bookmarkCount = addBookmarks ? writeOutlines(out, roots) : 0
  return {
    bytes: await out.save({ useObjectStreams: false }),
    totalPages: mergedCursor,
    bookmarkCount,
  }
}
