/**
 * Interleave merge for simplex duplex scans (PDF tools v2): combines an odd-pages
 * PDF and an even-pages PDF alternately (odd[0], even[0], odd[1], even[1], ...).
 * Reversing the even PDF defaults to on because scanning the back stack face-down
 * reverses page order. Extra pages from a longer input are appended at the end.
 */
import { PDFDocument } from 'pdf-lib'

export interface InterleaveOptions {
  /** reverse the even-pages PDF before interleaving (default: true) */
  reverseEven?: boolean
}

export interface InterleaveResult {
  bytes: Uint8Array
  oddCount: number
  evenCount: number
  totalPages: number
}

export async function interleavePdfBytes(
  oddBytes: Uint8Array,
  evenBytes: Uint8Array,
  options: InterleaveOptions = {},
): Promise<InterleaveResult> {
  const reverseEven = options.reverseEven ?? true
  const oddDoc = await PDFDocument.load(oddBytes, { updateMetadata: false })
  const evenDoc = await PDFDocument.load(evenBytes, { updateMetadata: false })
  const oddCount = oddDoc.getPageCount()
  const evenCount = evenDoc.getPageCount()

  const oddIndices = Array.from({ length: oddCount }, (_, i) => i)
  const evenIndices = Array.from({ length: evenCount }, (_, i) =>
    reverseEven ? evenCount - 1 - i : i,
  )

  const out = await PDFDocument.create()
  const copiedOdd = oddIndices.length > 0 ? await out.copyPages(oddDoc, oddIndices) : []
  const copiedEven = evenIndices.length > 0 ? await out.copyPages(evenDoc, evenIndices) : []

  const maxLen = Math.max(copiedOdd.length, copiedEven.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < copiedOdd.length) out.addPage(copiedOdd[i]!)
    if (i < copiedEven.length) out.addPage(copiedEven[i]!)
  }

  return {
    bytes: await out.save({ useObjectStreams: false }),
    oddCount,
    evenCount,
    totalPages: oddCount + evenCount,
  }
}
