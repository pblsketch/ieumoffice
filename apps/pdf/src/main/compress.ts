/**
 * Make a PDF smaller (the PDF tools window, decision 0030): large pictures
 * are shrunk and stored again as JPEG, duplicate images are unified, plain
 * Flate streams are recompressed at level 9, metadata/thumbnails can be
 * stripped, and the file is written with object streams. Text and vector
 * drawings are never rasterized so search and copy keep working.
 *
 * The picture work itself (decode, resize, JPEG/grayscale encode) is the
 * caller's: the app hands in Chromium's image code, which only the main
 * process has. This module decides which pictures to try, what to ask for,
 * and keeps a new picture only when it came out smaller.
 */
import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib'
import { readImageInfo } from './images-to-pdf'

export const COMPRESS_LEVELS = ['light', 'medium', 'strong'] as const
export type CompressLevel = (typeof COMPRESS_LEVELS)[number]

export const COMPRESS_MODES = ['lossless', 'light', 'medium', 'strong', 'target'] as const
export type CompressMode = (typeof COMPRESS_MODES)[number]

/** Longest side in pixels and JPEG quality each level asks for (tunable) */
export const LEVEL_TARGETS: Record<CompressLevel, { longSide: number; quality: number }> = {
  light: { longSide: 3000, quality: 85 },
  medium: { longSide: 2000, quality: 75 },
  strong: { longSide: 1400, quality: 60 },
}

/** Ordered quality steps from highest to lowest for target-size binary search (tunable) */
const TARGET_PROFILES: readonly { longSide: number; quality: number }[] = [
  { longSide: 2400, quality: 82 },
  { longSide: 2100, quality: 78 },
  { longSide: 1800, quality: 72 },
  { longSide: 1600, quality: 66 },
  { longSide: 1400, quality: 60 },
  { longSide: 1200, quality: 54 },
  { longSide: 1000, quality: 48 },
  { longSide: 800, quality: 42 },
]

/** Maximum binary-search recode passes for target-size mode (tunable) */
const TARGET_MAX_PASSES = 4

/** A picture to shrink: JPEG bytes, or 8-bit samples (1 = grey, 3 = RGB) */
export type SourceImage =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'raw'; samples: Uint8Array; width: number; height: number; components: 1 | 3 }

export interface RecodedImage {
  jpeg: Uint8Array
  width: number
  height: number
  /** true when the recoder produced a 1-channel DeviceGray JPEG */
  grayscale?: boolean
}

export interface RecodeTarget {
  longSide: number
  quality: number
  /** convert pixels to Rec.601 luminance grayscale while keeping text/vectors intact */
  grayscale?: boolean
}

/**
 * The caller's picture code: `image` shrunk to fit `longSide` (never grown)
 * and encoded as JPEG at `quality`; null when it cannot.
 */
export type ImageRecoder = (
  image: SourceImage,
  target: RecodeTarget,
) => Promise<RecodedImage | null>

export interface CompressResult {
  bytes: Uint8Array
  /** pictures stored again smaller */
  recoded: number
}

export interface CompressV2Options {
  mode: CompressMode
  /** required when mode === 'target' */
  targetBytes?: number
  /** ignored in lossless mode */
  grayscaleImages?: boolean
  /** remove Info dictionary fields, XMP /Metadata, and per-page /Thumb */
  stripMetadata?: boolean
}

export interface CompressV2Result {
  bytes: Uint8Array
  recoded: number
  deduped: number
  flateRecompressed: number
  /** always true outside target mode; in target mode, true iff bytes.length <= targetBytes */
  targetMet: boolean
}

export interface PdfSpaceAudit {
  totalBytes: number
  imagesBytes: number
  fontsBytes: number
  contentBytes: number
  otherBytes: number
  duplicateImageCount: number
  duplicateImageSavableBytes: number
}

/** pictures smaller than this are left as they are: little to win */
const MIN_STREAM_BYTES = 48 * 1024

const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** a stream's single filter name, '' for none, null for a chain */
function singleFilter(dict: PDFDict): string | null {
  const filter = dict.lookup(PDFName.of('Filter'))
  if (!filter) return ''
  if (filter instanceof PDFName) return filter.decodeText()
  if (filter instanceof PDFArray) {
    if (filter.size() === 0) return ''
    if (filter.size() !== 1) return null
    const only = filter.lookup(0)
    return only instanceof PDFName ? only.decodeText() : null
  }
  return null
}

/** 1 for grey, 3 for RGB (device or ICC based), null for anything else */
function componentsOf(dict: PDFDict): { components: 1 | 3; icc: boolean } | null {
  const cs = dict.lookup(PDFName.of('ColorSpace'))
  if (cs instanceof PDFName) {
    const name = cs.decodeText()
    if (name === 'DeviceRGB') return { components: 3, icc: false }
    if (name === 'DeviceGray') return { components: 1, icc: false }
    return null
  }
  if (cs instanceof PDFArray && cs.size() === 2) {
    const kind = cs.lookup(0)
    const profile = cs.lookup(1)
    if (!(kind instanceof PDFName) || kind.decodeText() !== 'ICCBased') return null
    const n = profile instanceof PDFRawStream ? profile.dict.lookup(PDFName.of('N')) : undefined
    const count = n instanceof PDFNumber ? n.asNumber() : 0
    if (count === 3) return { components: 3, icc: true }
    if (count === 1) return { components: 1, icc: true }
  }
  return null
}

const numberOf = (dict: PDFDict, key: string): number | null => {
  const v = dict.lookup(PDFName.of(key))
  return v instanceof PDFNumber ? v.asNumber() : null
}

function isImageStream(obj: PDFRawStream): boolean {
  const subtype = obj.dict.lookup(PDFName.of('Subtype'))
  return subtype instanceof PDFName && subtype.decodeText() === 'Image'
}

/** Deterministic string for a dictionary entry (dereferencing simple indirect objects) */
function canonicalEntry(doc: PDFDocument, value: unknown, depth = 0): string {
  if (value === undefined || value === null) return ''
  if (depth > 4) return String(value)
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value
  if (resolved instanceof PDFRawStream) {
    return `stream:${sha256Hex(resolved.getContents())}:${canonicalEntry(doc, resolved.dict.get(PDFName.of('N')), depth + 1)}`
  }
  if (resolved instanceof PDFArray) {
    const parts: string[] = []
    for (let i = 0; i < resolved.size(); i++) {
      parts.push(canonicalEntry(doc, resolved.get(i), depth + 1))
    }
    return `[${parts.join(',')}]`
  }
  if (resolved instanceof PDFDict) {
    const entries = resolved
      .entries()
      .map(([k, v]) => `${k.decodeText()}=${canonicalEntry(doc, v, depth + 1)}`)
      .sort()
    return `{${entries.join(';')}}`
  }
  return String(resolved)
}

/** Exact identity key for an image XObject: identical key means visually identical image */
function imageDedupKey(doc: PDFDocument, stream: PDFRawStream): string {
  const { dict } = stream
  const smask = dict.get(PDFName.of('SMask'))
  const smaskObj = smask instanceof PDFRef ? doc.context.lookup(smask) : smask
  const smaskKey =
    smaskObj instanceof PDFRawStream
      ? `smask:${sha256Hex(smaskObj.getContents())}:${canonicalEntry(doc, smaskObj.dict.get(PDFName.of('Width')))}x${canonicalEntry(doc, smaskObj.dict.get(PDFName.of('Height')))}`
      : ''
  return [
    sha256Hex(stream.getContents()),
    canonicalEntry(doc, dict.get(PDFName.of('Width'))),
    canonicalEntry(doc, dict.get(PDFName.of('Height'))),
    canonicalEntry(doc, dict.get(PDFName.of('BitsPerComponent'))),
    canonicalEntry(doc, dict.get(PDFName.of('ColorSpace'))),
    canonicalEntry(doc, dict.get(PDFName.of('Filter'))),
    canonicalEntry(doc, dict.get(PDFName.of('DecodeParms'))),
    smaskKey,
    canonicalEntry(doc, dict.get(PDFName.of('Mask'))),
    canonicalEntry(doc, dict.get(PDFName.of('ImageMask'))),
    canonicalEntry(doc, dict.get(PDFName.of('Decode'))),
  ].join('|')
}

/** Walk every /Resources /XObject dictionary reachable from pages and nested Form XObjects */
function collectXObjectDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = []
  const visitedForms = new Set<string>()
  const visitedDicts = new Set<PDFDict>()

  const visitResources = (resources: PDFDict | undefined): void => {
    if (!resources) return
    const xobj = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobj || visitedDicts.has(xobj)) return
    visitedDicts.add(xobj)
    out.push(xobj)
    for (const [, val] of xobj.entries()) {
      const refKey = val instanceof PDFRef ? val.toString() : null
      if (refKey && visitedForms.has(refKey)) continue
      const target = val instanceof PDFRef ? doc.context.lookup(val) : val
      if (target instanceof PDFRawStream) {
        const sub = target.dict.lookup(PDFName.of('Subtype'))
        if (sub instanceof PDFName && sub.decodeText() === 'Form') {
          if (refKey) visitedForms.add(refKey)
          visitResources(target.dict.lookupMaybe(PDFName.of('Resources'), PDFDict))
        }
      }
    }
  }

  for (const page of doc.getPages()) {
    visitResources(page.node.lookupMaybe(PDFName.of('Resources'), PDFDict))
  }
  return out
}

/**
 * Unify identical image XObjects across all pages and Form XObjects to a single
 * canonical PDFRef, deleting unreferenced duplicate objects from the context.
 */
export function deduplicateImages(doc: PDFDocument): { removed: number; savedBytes: number } {
  const xobjDicts = collectXObjectDicts(doc)
  const canonicalByKey = new Map<string, PDFRef>()
  const replacedRefs = new Map<string, { ref: PDFRef; size: number }>()

  // Collect all refs referenced as SMasks so we never delete an SMask still in use
  const smaskRefs = new Set<string>()
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const mask = obj.dict.get(PDFName.of('SMask'))
    if (mask instanceof PDFRef) smaskRefs.add(mask.toString())
  }

  for (const xobj of xobjDicts) {
    for (const [name, val] of xobj.entries()) {
      if (!(val instanceof PDFRef)) continue
      const obj = doc.context.lookup(val)
      if (!(obj instanceof PDFRawStream) || !isImageStream(obj)) continue
      const key = imageDedupKey(doc, obj)
      const canonical = canonicalByKey.get(key)
      if (!canonical) {
        canonicalByKey.set(key, val)
      } else if (canonical.toString() !== val.toString()) {
        xobj.set(name, canonical)
        replacedRefs.set(val.toString(), { ref: val, size: obj.getContentsSize() })
      }
    }
  }

  // Delete duplicate image objects only if no longer referenced anywhere in XObjects or SMasks
  const stillReferenced = new Set<string>(smaskRefs)
  for (const xobj of xobjDicts) {
    for (const [, val] of xobj.entries()) {
      if (val instanceof PDFRef) stillReferenced.add(val.toString())
    }
  }
  let removed = 0
  let savedBytes = 0
  for (const [key, entry] of replacedRefs) {
    if (stillReferenced.has(key)) continue
    doc.context.delete(entry.ref)
    removed++
    savedBytes += entry.size
  }
  return { removed, savedBytes }
}

/** Recompress plain FlateDecode non-image streams (without predictors) at zlib level 9 */
export function recompressFlateStreams(doc: PDFDocument): number {
  let count = 0
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (isImageStream(obj)) continue
    if (singleFilter(obj.dict) !== 'FlateDecode') continue
    if (obj.dict.get(PDFName.of('DecodeParms')) !== undefined) continue
    try {
      const raw = obj.getContents()
      const inflated = inflateSync(Buffer.from(raw))
      const packed = new Uint8Array(deflateSync(inflated, { level: 9 }))
      if (packed.length >= raw.length) continue
      const dict = obj.dict.clone()
      dict.set(PDFName.of('Length'), PDFNumber.of(packed.length))
      doc.context.assign(ref, PDFRawStream.of(dict, packed))
      count++
    } catch {
      // Leave unreadable streams untouched
    }
  }
  return count
}

/** Remove Info dictionary metadata, XMP /Metadata stream, and per-page /Thumb streams */
export function stripDocumentMetadata(doc: PDFDocument): void {
  const infoRef = doc.context.trailerInfo.Info
  const infoObj = infoRef instanceof PDFRef ? doc.context.lookup(infoRef) : infoRef
  if (infoObj instanceof PDFDict) {
    for (const key of [
      'Title',
      'Author',
      'Subject',
      'Keywords',
      'Creator',
      'Producer',
      'CreationDate',
      'ModDate',
    ]) {
      infoObj.delete(PDFName.of(key))
    }
  }
  const metaRef = doc.catalog.get(PDFName.of('Metadata'))
  doc.catalog.delete(PDFName.of('Metadata'))
  if (metaRef instanceof PDFRef) doc.context.delete(metaRef)
  for (const page of doc.getPages()) {
    const thumbRef = page.node.get(PDFName.of('Thumb'))
    page.node.delete(PDFName.of('Thumb'))
    if (thumbRef instanceof PDFRef) doc.context.delete(thumbRef)
  }
}

/** Non-destructive space breakdown for a PDF before compression */
export async function auditPdfSpace(bytes: Uint8Array): Promise<PdfSpaceAudit> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const fontStreamRefs = new Set<string>()
  const contentStreamRefs = new Set<string>()

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const ref = obj.get(PDFName.of(key))
      if (ref instanceof PDFRef) fontStreamRefs.add(ref.toString())
    }
  }
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'))
    if (contents instanceof PDFRef) {
      contentStreamRefs.add(contents.toString())
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const item = contents.get(i)
        if (item instanceof PDFRef) contentStreamRefs.add(item.toString())
      }
    }
  }

  let imagesBytes = 0
  let fontsBytes = 0
  let contentBytes = 0
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const size = obj.getContentsSize()
    if (isImageStream(obj)) {
      imagesBytes += size
    } else if (fontStreamRefs.has(ref.toString())) {
      fontsBytes += size
    } else if (contentStreamRefs.has(ref.toString())) {
      contentBytes += size
    }
  }

  // Estimate duplicate image savings from reachable XObjects without mutating anything
  const seenKeys = new Map<string, string>()
  const countedDuplicates = new Set<string>()
  let duplicateImageCount = 0
  let duplicateImageSavableBytes = 0
  for (const xobj of collectXObjectDicts(doc)) {
    for (const [, val] of xobj.entries()) {
      if (!(val instanceof PDFRef)) continue
      const obj = doc.context.lookup(val)
      if (!(obj instanceof PDFRawStream) || !isImageStream(obj)) continue
      const key = imageDedupKey(doc, obj)
      const refId = val.toString()
      const first = seenKeys.get(key)
      if (!first) {
        seenKeys.set(key, refId)
      } else if (first !== refId && !countedDuplicates.has(refId)) {
        countedDuplicates.add(refId)
        duplicateImageCount++
        duplicateImageSavableBytes += obj.getContentsSize()
      }
    }
  }

  const totalBytes = bytes.length
  const otherBytes = Math.max(0, totalBytes - imagesBytes - fontsBytes - contentBytes)
  return {
    totalBytes,
    imagesBytes,
    fontsBytes,
    contentBytes,
    otherBytes,
    duplicateImageCount,
    duplicateImageSavableBytes,
  }
}

/** A picture this module may try, read into what the recoder takes; null to leave it */
export function sourceOf(stream: PDFRawStream): SourceImage | null {
  const { dict } = stream
  const subtype = dict.lookup(PDFName.of('Subtype'))
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') return null
  if (dict.lookup(PDFName.of('ImageMask'))?.toString() === 'true') return null
  if (dict.has(PDFName.of('Mask')) || dict.has(PDFName.of('Decode'))) return null
  if (numberOf(dict, 'BitsPerComponent') !== 8) return null
  const width = numberOf(dict, 'Width')
  const height = numberOf(dict, 'Height')
  if (!width || !height || width < 1 || height < 1) return null
  if (stream.getContentsSize() < MIN_STREAM_BYTES) return null
  const colour = componentsOf(dict)
  if (!colour) return null
  const filter = singleFilter(dict)
  if (filter === 'DCTDecode') {
    const jpeg = stream.getContents()
    // a decoder may turn a JPEG by its EXIF orientation, which PDF ignores
    const info = readImageInfo(jpeg)
    if (!info || info.orientation !== 1) return null
    return { kind: 'jpeg', bytes: jpeg, width, height }
  }
  if (filter !== 'FlateDecode') return null
  const parms = dict.lookup(PDFName.of('DecodeParms'))
  const predictor =
    parms instanceof PDFDict
      ? parms.lookup(PDFName.of('Predictor'))
      : parms instanceof PDFArray
        ? parms.lookupMaybe(0, PDFDict)?.lookup(PDFName.of('Predictor'))
        : undefined
  if (predictor instanceof PDFNumber && predictor.asNumber() > 1) return null
  const samples = decodePDFRawStream(stream).decode()
  if (samples.length < width * height * colour.components) return null
  return { kind: 'raw', samples, width, height, components: colour.components }
}

/** 8-bit grey or RGB samples as the BGRA pixels a bitmap API takes */
export function samplesToBgra(
  samples: Uint8Array,
  components: 1 | 3,
  pixels: number,
  grayscale = false,
): Uint8Array {
  const out = new Uint8Array(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const r = samples[i * components]!
    const g = components === 3 ? samples[i * 3 + 1]! : r
    const b = components === 3 ? samples[i * 3 + 2]! : r
    if (grayscale && components === 3) {
      const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      out[i * 4] = y
      out[i * 4 + 1] = y
      out[i * 4 + 2] = y
      out[i * 4 + 3] = 255
    } else {
      out[i * 4] = b
      out[i * 4 + 1] = g
      out[i * 4 + 2] = r
      out[i * 4 + 3] = 255
    }
  }
  return out
}

/** Convert BGRA pixels in place to Rec.601 luminance grayscale */
export function bgraToGrayscaleInPlace(bgra: Uint8Array): void {
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    const b = bgra[i]!
    const g = bgra[i + 1]!
    const r = bgra[i + 2]!
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    bgra[i] = y
    bgra[i + 1] = y
    bgra[i + 2] = y
  }
}

/** Keep what the picture's dictionary says beyond its data and format */
const DROPPED = new Set([
  'Length',
  'Filter',
  'DecodeParms',
  'Width',
  'Height',
  'BitsPerComponent',
  'ColorSpace',
])

/** Recode candidate pictures inside `doc` at `target`; returns number recoded */
async function recodeDocPictures(
  doc: PDFDocument,
  target: RecodeTarget,
  recode: ImageRecoder,
  options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<number> {
  const { context } = doc
  const objects = context.enumerateIndirectObjects()
  // a soft mask is a grey picture itself, and must stay one
  const masks = new Set<string>()
  for (const [, object] of objects) {
    const mask = object instanceof PDFRawStream ? object.dict.get(PDFName.of('SMask')) : undefined
    if (mask instanceof PDFRef) masks.add(mask.toString())
  }
  const pictures: [PDFRef, PDFRawStream, SourceImage][] = []
  for (const [ref, object] of objects) {
    if (!(object instanceof PDFRawStream) || masks.has(ref.toString())) continue
    let source: SourceImage | null
    try {
      source = sourceOf(object)
    } catch {
      // data that does not decode is left as it is
      source = null
    }
    if (source) pictures.push([ref, object, source])
  }
  let recoded = 0
  for (const [i, [ref, stream, source]] of pictures.entries()) {
    options.signal?.throwIfAborted()
    const made = await recode(source, target)
    if (made && (made.jpeg.length < stream.getContentsSize() || target.grayscale === true)) {
      const keep = target.grayscale ? undefined : colourKept(stream.dict)
      const dict = context.obj({})
      for (const [key, value] of stream.dict.entries()) {
        if (!DROPPED.has(key.decodeText())) dict.set(key, value)
      }
      dict.set(PDFName.of('Width'), PDFNumber.of(made.width))
      dict.set(PDFName.of('Height'), PDFNumber.of(made.height))
      dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
      dict.set(
        PDFName.of('ColorSpace'),
        made.grayscale ? PDFName.of('DeviceGray') : (keep ?? PDFName.of('DeviceRGB')),
      )
      dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
      context.assign(ref, PDFRawStream.of(dict, made.jpeg))
      recoded++
    }
    options.onProgress?.(i + 1, pictures.length)
  }
  return recoded
}

/**
 * `bytes` with its large pictures shrunk at `level`. The file is written with
 * object streams either way, so it may come out smaller with no picture
 * touched. `onProgress` counts the pictures tried; a throw from `signal`
 * stops the work.
 */
export async function compressPdfBytes(
  bytes: Uint8Array,
  level: CompressLevel,
  recode: ImageRecoder,
  options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<CompressResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const recoded = await recodeDocPictures(doc, LEVEL_TARGETS[level], recode, options)
  return { bytes: await doc.save({ useObjectStreams: true }), recoded }
}

/**
 * Full v2 local compression pipeline: image deduplication, Flate level-9
 * recompression, optional metadata/thumbnail stripping, optional image-only
 * grayscale reduction, and target-size binary search.
 */
export async function compressPdfV2Bytes(
  bytes: Uint8Array,
  compressOptions: CompressV2Options,
  recode: ImageRecoder,
  callbacks: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<CompressV2Result> {
  callbacks.signal?.throwIfAborted()
  const baseDoc = await PDFDocument.load(bytes, { updateMetadata: false })
  const dedup = deduplicateImages(baseDoc)
  const flateRecompressed = recompressFlateStreams(baseDoc)
  if (compressOptions.stripMetadata) stripDocumentMetadata(baseDoc)
  const losslessBytes = await baseDoc.save({ useObjectStreams: true })

  if (compressOptions.mode === 'lossless') {
    return {
      bytes: losslessBytes,
      recoded: 0,
      deduped: dedup.removed,
      flateRecompressed,
      targetMet: true,
    }
  }

  const grayscale = compressOptions.grayscaleImages === true

  if (compressOptions.mode !== 'target') {
    const target: RecodeTarget = { ...LEVEL_TARGETS[compressOptions.mode], grayscale }
    const recoded = await recodeDocPictures(baseDoc, target, recode, callbacks)
    const out = await baseDoc.save({ useObjectStreams: true })
    return {
      bytes: out.length <= losslessBytes.length || grayscale ? out : losslessBytes,
      recoded,
      deduped: dedup.removed,
      flateRecompressed,
      targetMet: true,
    }
  }

  const targetBytes = compressOptions.targetBytes ?? 0
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    throw new Error('invalid targetBytes')
  }
  if (losslessBytes.length <= targetBytes && !grayscale) {
    return {
      bytes: losslessBytes,
      recoded: 0,
      deduped: dedup.removed,
      flateRecompressed,
      targetMet: true,
    }
  }

  // Binary search TARGET_PROFILES (0 = highest quality, last = strongest compression)
  // to pick the highest-quality profile that satisfies <= targetBytes within TARGET_MAX_PASSES.
  let lo = 0
  let hi = TARGET_PROFILES.length - 1
  let bestMeeting: { bytes: Uint8Array; recoded: number } | null = null
  let smallest: { bytes: Uint8Array; recoded: number } = { bytes: losslessBytes, recoded: 0 }

  for (let pass = 0; pass < TARGET_MAX_PASSES && lo <= hi; pass++) {
    callbacks.signal?.throwIfAborted()
    const mid = Math.floor((lo + hi) / 2)
    const profile = TARGET_PROFILES[mid]!
    const passDoc = await PDFDocument.load(losslessBytes, { updateMetadata: false })
    const recoded = await recodeDocPictures(passDoc, { ...profile, grayscale }, recode, callbacks)
    const candidate = await passDoc.save({ useObjectStreams: true })
    if (candidate.length < smallest.bytes.length) {
      smallest = { bytes: candidate, recoded }
    }
    if (candidate.length <= targetBytes) {
      bestMeeting = { bytes: candidate, recoded }
      // Try higher quality (smaller index)
      hi = mid - 1
    } else {
      // Need stronger compression (larger index)
      lo = mid + 1
    }
  }

  // Ensure the strongest profile was tried if target is still unmet
  if (!bestMeeting && lo <= TARGET_PROFILES.length - 1) {
    callbacks.signal?.throwIfAborted()
    const strongest = TARGET_PROFILES[TARGET_PROFILES.length - 1]!
    const passDoc = await PDFDocument.load(losslessBytes, { updateMetadata: false })
    const recoded = await recodeDocPictures(passDoc, { ...strongest, grayscale }, recode, callbacks)
    const candidate = await passDoc.save({ useObjectStreams: true })
    if (candidate.length < smallest.bytes.length) {
      smallest = { bytes: candidate, recoded }
    }
    if (candidate.length <= targetBytes) {
      bestMeeting = { bytes: candidate, recoded }
    }
  }

  const chosen = bestMeeting ?? smallest
  return {
    bytes: chosen.bytes,
    recoded: chosen.recoded,
    deduped: dedup.removed,
    flateRecompressed,
    targetMet: chosen.bytes.length <= targetBytes,
  }
}

/** an RGB ICC profile stays with the picture; grey becomes RGB (the recoder writes RGB) */
function colourKept(dict: PDFDict) {
  const colour = componentsOf(dict)
  return colour?.icc && colour.components === 3 ? dict.get(PDFName.of('ColorSpace')) : undefined
}
