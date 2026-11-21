import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib'
import { concatMat } from './form-text'
import type { FormChain, Mat } from './form-text'
import type { Pdfium } from './text-edit'

/**
 * Workaround for PDFium's CPDF_PageContentGenerator CTM-scale loss on stroked text.
 *
 * When PDFium parses a page whose content stream establishes a scaled CTM (e.g.
 * `0.12 0 0 0.12 0 0 cm` for 600 DPI HWP/Word/GDI PDFs or `0.24 0 0 0.24 0 0 cm`
 * for 300 DPI), each text object keeps its CTM scale inside its text state while
 * its graphics-state line width (`w` or ExtGState `/LW`) remains unscaled. When
 * `FPDFPage_GenerateContent` rewrites the page stream, path objects retain their
 * `cm` scale, but text objects emit a translation-only `cm` (`1 0 0 1 x y cm`)
 * and fold the CTM scale into `Tm` (`BT .12 0 0 .12 0 0 Tm`). Because PDF
 * transforms text stroke width (`1 Tr`, `2 Tr`, `5 Tr`, `6 Tr`) by the CTM and
 * NOT by `Tm`, every stroked text run on the page inflates by `1 / ctmScale`
 * (8.33x at 600 DPI, 4.17x at 300 DPI, 100x at 0.01 cm).
 *
 * Before mutating a page in PDFium, we parse the original page content stream to
 * recover each stroked text run's true CTM scale and pre-scale its stroke width
 * to page space. If a scaled stroked run inherited `/LW` from an ExtGState dict
 * (which PDFium emits after `w`, overriding the adjusted width), a post-save
 * pass clones that ExtGState without `/LW` for text blocks only so path objects
 * keep their original `/LW`.
 */

const FPDF_PAGEOBJ_TEXT = 1
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
const SCALE_EPS = 1e-4

/** PDF text rendering modes that stroke glyph outlines (Stroke, Fill+Stroke, and their Clip variants) */
export function isStrokedTextMode(mode: number): boolean {
  return mode === 1 || mode === 2 || mode === 5 || mode === 6
}

/** Geometric-mean linear scale of a 2D affine matrix `[a, b, c, d, e, f]` */
export function ctmScaleOf(m: readonly number[]): number {
  const det = Math.abs(m[0]! * m[3]! - m[1]! * m[2]!)
  return Math.sqrt(det)
}

type StreamToken =
  | { kind: 'num'; value: number; start: number; end: number }
  | { kind: 'name'; value: string; start: number; end: number }
  | { kind: 'str'; nonEmpty: boolean; start: number; end: number }
  | { kind: 'arr'; hasNonEmptyStr: boolean; start: number; end: number }
  | { kind: 'dict'; start: number; end: number }
  | { kind: 'op'; value: string; start: number; end: number }

const isWs = (b: number): boolean =>
  b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20

const isDelim = (b: number): boolean =>
  b === 0x28 ||
  b === 0x29 ||
  b === 0x3c ||
  b === 0x3e ||
  b === 0x5b ||
  b === 0x5d ||
  b === 0x7b ||
  b === 0x7d ||
  b === 0x2f ||
  b === 0x25

const isHexDigit = (b: number): boolean =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66)

function decodePdfName(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    const b = bytes[i]!
    if (b === 0x23 && i + 2 < end && isHexDigit(bytes[i + 1]!) && isHexDigit(bytes[i + 2]!)) {
      const hex = String.fromCharCode(bytes[i + 1]!, bytes[i + 2]!)
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 2
    } else {
      out += String.fromCharCode(b)
    }
  }
  return out
}

function skipComment(data: Uint8Array, i: number): number {
  const len = data.length
  while (i < len && data[i] !== 0x0a && data[i] !== 0x0d) i++
  return i
}

function readLiteralString(data: Uint8Array, start: number): { nonEmpty: boolean; end: number } {
  const len = data.length
  let i = start + 1
  let depth = 1
  let nonEmpty = false
  while (i < len && depth > 0) {
    const b = data[i]!
    if (b === 0x5c) {
      // Backslash escape: \<EOL> is a zero-length line continuation; everything else emits a byte
      i++
      if (i >= len) break
      const next = data[i]!
      if (next === 0x0d) {
        i++
        if (i < len && data[i] === 0x0a) i++
      } else if (next === 0x0a) {
        i++
      } else {
        nonEmpty = true
        i++
      }
    } else if (b === 0x28) {
      depth++
      nonEmpty = true
      i++
    } else if (b === 0x29) {
      depth--
      if (depth > 0) nonEmpty = true
      i++
    } else {
      nonEmpty = true
      i++
    }
  }
  return { nonEmpty, end: i }
}

function readHexString(data: Uint8Array, start: number): { nonEmpty: boolean; end: number } {
  const len = data.length
  let i = start + 1
  let hexCount = 0
  while (i < len && data[i] !== 0x3e) {
    if (isHexDigit(data[i]!)) hexCount++
    i++
  }
  if (i < len && data[i] === 0x3e) i++
  return { nonEmpty: hexCount > 0, end: i }
}

function skipDict(data: Uint8Array, start: number): number {
  const len = data.length
  let i = start + 2
  let depth = 1
  while (i < len && depth > 0) {
    const b = data[i]!
    if (b === 0x25) {
      i = skipComment(data, i)
    } else if (b === 0x28) {
      i = readLiteralString(data, i).end
    } else if (b === 0x3c && i + 1 < len && data[i + 1] === 0x3c) {
      depth++
      i += 2
    } else if (b === 0x3e && i + 1 < len && data[i + 1] === 0x3e) {
      depth--
      i += 2
    } else if (b === 0x3c) {
      i = readHexString(data, i).end
    } else {
      i++
    }
  }
  return i
}

function readArray(data: Uint8Array, start: number): { hasNonEmptyStr: boolean; end: number } {
  const len = data.length
  let i = start + 1
  let depth = 1
  let hasNonEmptyStr = false
  while (i < len && depth > 0) {
    const b = data[i]!
    if (isWs(b)) {
      i++
    } else if (b === 0x25) {
      i = skipComment(data, i)
    } else if (b === 0x28) {
      const s = readLiteralString(data, i)
      if (depth === 1 && s.nonEmpty) hasNonEmptyStr = true
      i = s.end
    } else if (b === 0x3c && i + 1 < len && data[i + 1] === 0x3c) {
      i = skipDict(data, i)
    } else if (b === 0x3c) {
      const s = readHexString(data, i)
      if (depth === 1 && s.nonEmpty) hasNonEmptyStr = true
      i = s.end
    } else if (b === 0x5b) {
      depth++
      i++
    } else if (b === 0x5d) {
      depth--
      i++
    } else {
      i++
    }
  }
  return { hasNonEmptyStr, end: i }
}

/** Skip an inline image `BI ... ID <binary> EI` so binary bytes are never tokenized as operators */
function skipInlineImage(data: Uint8Array, start: number): number {
  const len = data.length
  let i = start
  // Scan dictionary tokens until the `ID` keyword
  while (i < len) {
    const b = data[i]!
    if (isWs(b)) {
      i++
    } else if (b === 0x25) {
      i = skipComment(data, i)
    } else if (b === 0x28) {
      i = readLiteralString(data, i).end
    } else if (b === 0x3c && i + 1 < len && data[i + 1] === 0x3c) {
      i = skipDict(data, i)
    } else if (b === 0x3c) {
      i = readHexString(data, i).end
    } else if (b === 0x5b) {
      i = readArray(data, i).end
    } else if (b === 0x2f) {
      i++
      while (i < len && !isWs(data[i]!) && !isDelim(data[i]!)) i++
    } else {
      const wStart = i
      while (i < len && !isWs(data[i]!) && !isDelim(data[i]!)) i++
      if (i - wStart === 2 && data[wStart] === 0x49 && data[wStart + 1] === 0x44) {
        // Single whitespace byte separates `ID` from raw image data
        if (i < len && isWs(data[i]!)) i++
        break
      }
      if (i === wStart) i++
    }
  }
  // Scan raw image bytes for `<ws>EI<ws|delim|eof>`
  while (i + 2 <= len) {
    if (
      data[i] === 0x45 &&
      data[i + 1] === 0x49 &&
      (i === 0 || isWs(data[i - 1]!)) &&
      (i + 2 === len || isWs(data[i + 2]!) || isDelim(data[i + 2]!))
    ) {
      return i + 2
    }
    i++
  }
  return len
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

function tokenizeContentStream(data: Uint8Array): StreamToken[] {
  const tokens: StreamToken[] = []
  const len = data.length
  let i = 0
  while (i < len) {
    const b = data[i]!
    if (isWs(b)) {
      i++
    } else if (b === 0x25) {
      i = skipComment(data, i)
    } else if (b === 0x28) {
      const s = readLiteralString(data, i)
      tokens.push({ kind: 'str', nonEmpty: s.nonEmpty, start: i, end: s.end })
      i = s.end
    } else if (b === 0x3c && i + 1 < len && data[i + 1] === 0x3c) {
      const end = skipDict(data, i)
      tokens.push({ kind: 'dict', start: i, end })
      i = end
    } else if (b === 0x3c) {
      const s = readHexString(data, i)
      tokens.push({ kind: 'str', nonEmpty: s.nonEmpty, start: i, end: s.end })
      i = s.end
    } else if (b === 0x5b) {
      const arr = readArray(data, i)
      tokens.push({ kind: 'arr', hasNonEmptyStr: arr.hasNonEmptyStr, start: i, end: arr.end })
      i = arr.end
    } else if (b === 0x2f) {
      const start = i
      i++
      while (i < len && !isWs(data[i]!) && !isDelim(data[i]!)) i++
      tokens.push({ kind: 'name', value: decodePdfName(data, start + 1, i), start, end: i })
    } else if (isDelim(b)) {
      // Stray delimiter (e.g. closing `)` / `]` in malformed input): advance safely
      i++
    } else {
      const start = i
      while (i < len && !isWs(data[i]!) && !isDelim(data[i]!)) i++
      const word = Buffer.from(data.subarray(start, i)).toString('latin1')
      if (NUMBER_RE.test(word)) {
        tokens.push({ kind: 'num', value: Number(word), start, end: i })
      } else if (word === 'BI') {
        i = skipInlineImage(data, i)
      } else {
        tokens.push({ kind: 'op', value: word, start, end: i })
      }
    }
  }
  return tokens
}

export interface StreamTextEntry {
  ctmScale: number
  lineWidth: number
  renderMode: number
  hasGsLw: boolean
  x: number
  y: number
}

interface GState {
  ctm: Mat
  lineWidth: number
  hasGsLw: boolean
  renderMode: number
}

/** Walk a decoded PDF content stream and record each text-show operator's CTM scale and stroke state */
export function analyzeStreamStrokedText(
  streamBytes: Uint8Array,
  gsLineWidths: ReadonlyMap<string, number>,
): StreamTextEntry[] {
  const tokens = tokenizeContentStream(streamBytes)
  const out: StreamTextEntry[] = []
  const stack: GState[] = []
  let state: GState = { ctm: IDENTITY, lineWidth: 1, hasGsLw: false, renderMode: 0 }
  let tm: Mat = IDENTITY
  let tlm: Mat = IDENTITY
  let leading = 0
  let ops: StreamToken[] = []

  const numAt = (idx: number): number | null => {
    const t = ops[idx]
    return t && t.kind === 'num' && Number.isFinite(t.value) ? t.value : null
  }

  const recordText = () => {
    const x = state.ctm[0] * tm[4] + state.ctm[2] * tm[5] + state.ctm[4]
    const y = state.ctm[1] * tm[4] + state.ctm[3] * tm[5] + state.ctm[5]
    out.push({
      ctmScale: ctmScaleOf(state.ctm),
      lineWidth: state.lineWidth,
      renderMode: state.renderMode,
      hasGsLw: state.hasGsLw,
      x,
      y,
    })
  }

  for (const tok of tokens) {
    if (tok.kind !== 'op') {
      ops.push(tok)
      continue
    }
    const op = tok.value
    switch (op) {
      case 'q':
        stack.push({
          ctm: state.ctm,
          lineWidth: state.lineWidth,
          hasGsLw: state.hasGsLw,
          renderMode: state.renderMode,
        })
        break
      case 'Q':
        if (stack.length > 0) state = stack.pop()!
        break
      case 'cm':
        if (ops.length >= 6) {
          const base = ops.length - 6
          const a = numAt(base)
          const b = numAt(base + 1)
          const c = numAt(base + 2)
          const d = numAt(base + 3)
          const e = numAt(base + 4)
          const f = numAt(base + 5)
          if (a !== null && b !== null && c !== null && d !== null && e !== null && f !== null) {
            state.ctm = concatMat([a, b, c, d, e, f], state.ctm)
          }
        }
        break
      case 'w': {
        const lw = numAt(ops.length - 1)
        if (lw !== null && lw >= 0) {
          state.lineWidth = lw
          state.hasGsLw = false
        }
        break
      }
      case 'gs': {
        const nameTok = ops[ops.length - 1]
        if (nameTok?.kind === 'name') {
          const lw = gsLineWidths.get(nameTok.value)
          if (lw !== undefined && lw >= 0) {
            state.lineWidth = lw
            state.hasGsLw = true
          }
        }
        break
      }
      case 'Tr': {
        const mode = numAt(ops.length - 1)
        if (mode !== null) state.renderMode = Math.trunc(mode)
        break
      }
      case 'BT':
        tm = IDENTITY
        tlm = IDENTITY
        break
      case 'Tm':
        if (ops.length >= 6) {
          const base = ops.length - 6
          const a = numAt(base)
          const b = numAt(base + 1)
          const c = numAt(base + 2)
          const d = numAt(base + 3)
          const e = numAt(base + 4)
          const f = numAt(base + 5)
          if (a !== null && b !== null && c !== null && d !== null && e !== null && f !== null) {
            tm = [a, b, c, d, e, f]
            tlm = tm
          }
        }
        break
      case 'Td':
      case 'TD':
        if (ops.length >= 2) {
          const tx = numAt(ops.length - 2)
          const ty = numAt(ops.length - 1)
          if (tx !== null && ty !== null) {
            if (op === 'TD') leading = -ty
            tlm = concatMat([1, 0, 0, 1, tx, ty], tlm)
            tm = tlm
          }
        }
        break
      case 'TL': {
        const tl = numAt(ops.length - 1)
        if (tl !== null) leading = tl
        break
      }
      case 'T*':
        tlm = concatMat([1, 0, 0, 1, 0, -leading], tlm)
        tm = tlm
        break
      case 'Tj': {
        const arg = ops[ops.length - 1]
        if (arg?.kind === 'str' && arg.nonEmpty) recordText()
        break
      }
      case "'": {
        tlm = concatMat([1, 0, 0, 1, 0, -leading], tlm)
        tm = tlm
        const arg = ops[ops.length - 1]
        if (arg?.kind === 'str' && arg.nonEmpty) recordText()
        break
      }
      case '"': {
        tlm = concatMat([1, 0, 0, 1, 0, -leading], tlm)
        tm = tlm
        const arg = ops[ops.length - 1]
        if (arg?.kind === 'str' && arg.nonEmpty) recordText()
        break
      }
      case 'TJ': {
        const arg = ops[ops.length - 1]
        if (arg?.kind === 'arr' && arg.hasNonEmptyStr) recordText()
        break
      }
      default:
        break
    }
    ops = []
  }
  return out
}

function decodePdfStreamBytes(stream: PDFStream): Uint8Array | null {
  try {
    return stream instanceof PDFRawStream
      ? decodePDFRawStream(stream).decode()
      : stream.getContents()
  } catch {
    return null
  }
}

function concatStreams(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const total = parts.reduce((sum, p) => sum + p.length + 1, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    merged.set(p, off)
    off += p.length
    merged[off++] = 0x0a
  }
  return merged
}

function readExtGStateLineWidths(resources: PDFDict | undefined): Map<string, number> {
  const out = new Map<string, number>()
  const gsDict = resources?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)
  if (!gsDict) return out
  for (const key of gsDict.keys()) {
    const entry = gsDict.lookupMaybe(key, PDFDict)
    const lw = entry?.lookupMaybe(PDFName.of('LW'), PDFNumber)
    if (lw) out.set(key.decodeText(), lw.asNumber())
  }
  return out
}

function pageContentBytes(doc: PDFDocument, pageIndex: number): Uint8Array | null {
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) return null
  const page = doc.getPage(pageIndex)
  const contents = page.node.Contents()
  const parts =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : contents
        ? [contents]
        : []
  const decoded: Uint8Array[] = []
  for (const part of parts) {
    if (!(part instanceof PDFStream)) return null
    const bytes = decodePdfStreamBytes(part)
    if (bytes === null) return null
    decoded.push(bytes)
  }
  return decoded.length > 0 ? concatStreams(decoded) : null
}

/** Resolve a Form XObject stream by its `Do`-order ordinals from a page's content stream */
function resolveFormStreamByOrdinals(
  doc: PDFDocument,
  pageIndex: number,
  ordinals: readonly number[],
): PDFStream | null {
  if (ordinals.length === 0 || pageIndex < 0 || pageIndex >= doc.getPageCount()) return null
  const ctx = doc.context
  const formKids = (resources: PDFDict | undefined, streamBytes: Uint8Array | null): PDFRef[] => {
    if (!streamBytes) return []
    const xobjs = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjs) return []
    const tokens = tokenizeContentStream(streamBytes)
    const out: PDFRef[] = []
    let prevName: string | null = null
    for (const tok of tokens) {
      if (tok.kind === 'name') {
        prevName = tok.value
      } else if (tok.kind === 'op') {
        if (tok.value === 'Do' && prevName !== null) {
          const ref = xobjs.get(PDFName.of(prevName))
          if (ref instanceof PDFRef) {
            const obj = ctx.lookup(ref)
            if (
              obj instanceof PDFStream &&
              obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')
            ) {
              out.push(ref)
            }
          }
        }
        prevName = null
      } else {
        prevName = null
      }
    }
    return out
  }

  let curResources = doc.getPage(pageIndex).node.Resources()
  let curBytes = pageContentBytes(doc, pageIndex)
  let current: PDFStream | null = null
  for (const ordinal of ordinals) {
    const kids = formKids(curResources, curBytes)
    const ref = kids[ordinal]
    if (!ref) return null
    const s = ctx.lookup(ref)
    if (!(s instanceof PDFStream)) return null
    current = s
    curResources = s.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
    curBytes = decodePdfStreamBytes(s)
  }
  return current
}

interface PdfiumTextInfo {
  obj: number
  mode: number
  strokeWidth: number
  x: number
  y: number
}

function collectDirectTextObjects(
  m: Pdfium,
  count: number,
  getObj: (i: number) => number,
): PdfiumTextInfo[] {
  const out: PdfiumTextInfo[] = []
  const ptr = m._malloc(28)
  try {
    for (let i = 0; i < count; i++) {
      const obj = getObj(i)
      if (m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue
      const mode = m._FPDFTextObj_GetTextRenderMode(obj)
      const strokeWidth = m._FPDFPageObj_GetStrokeWidth(obj, ptr) ? m.HEAPF32[ptr >> 2]! : 0
      const hasMat = m._FPDFPageObj_GetMatrix(obj, ptr + 4)
      const x = hasMat ? m.HEAPF32[((ptr + 4) >> 2) + 4]! : 0
      const y = hasMat ? m.HEAPF32[((ptr + 4) >> 2) + 5]! : 0
      out.push({ obj, mode, strokeWidth, x, y })
    }
  } finally {
    m._free(ptr)
  }
  return out
}

function matchAndScaleTextObjects(
  m: Pdfium,
  pdfiumTexts: PdfiumTextInfo[],
  streamTexts: StreamTextEntry[],
): boolean {
  const pdfiumStroked = pdfiumTexts.filter((t) => isStrokedTextMode(t.mode))
  const streamStroked = streamTexts.filter((s) => isStrokedTextMode(s.renderMode))
  if (pdfiumStroked.length === 0 || streamStroked.length === 0) return false

  const matched = new Map<PdfiumTextInfo, StreamTextEntry>()

  if (
    pdfiumTexts.length === streamTexts.length &&
    pdfiumTexts.every((t, i) => t.mode === streamTexts[i]!.renderMode)
  ) {
    // Tier 1: exact 1-to-1 stream order across all text objects
    for (let i = 0; i < pdfiumTexts.length; i++) {
      const t = pdfiumTexts[i]!
      if (isStrokedTextMode(t.mode)) matched.set(t, streamTexts[i]!)
    }
  } else if (
    pdfiumStroked.length === streamStroked.length &&
    pdfiumStroked.every((t, i) => t.mode === streamStroked[i]!.renderMode)
  ) {
    // Tier 2: exact 1-to-1 stream order across stroked text objects
    for (let i = 0; i < pdfiumStroked.length; i++) {
      matched.set(pdfiumStroked[i]!, streamStroked[i]!)
    }
  } else {
    const firstScale = streamStroked[0]!.ctmScale
    const uniformScale = streamStroked.every((s) => Math.abs(s.ctmScale - firstScale) <= SCALE_EPS)
    if (uniformScale) {
      // Tier 3: every stroked text run on the page shares the same CTM scale (typical 300/600 DPI PDF)
      const anyGsLw = streamStroked.some((s) => s.hasGsLw)
      for (const t of pdfiumStroked) {
        matched.set(t, {
          ctmScale: firstScale,
          lineWidth: t.strokeWidth,
          renderMode: t.mode,
          hasGsLw: anyGsLw,
          x: t.x,
          y: t.y,
        })
      }
    } else {
      // Tier 4: nearest match by renderMode, strokeWidth, and page-space anchor
      for (const t of pdfiumStroked) {
        let best: StreamTextEntry | null = null
        let bestScore = Infinity
        for (const s of streamStroked) {
          if (s.renderMode !== t.mode) continue
          const wDiff = Math.abs(s.lineWidth - t.strokeWidth)
          const dist = Math.hypot(s.x - t.x, s.y - t.y)
          const score = (wDiff > 0.05 ? 1e6 + wDiff * 1e3 : 0) + dist
          if (score < bestScore) {
            bestScore = score
            best = s
          }
        }
        if (best) matched.set(t, best)
      }
    }
  }

  let needsGsLwFix = false
  for (const [t, entry] of matched) {
    const scale = entry.ctmScale
    if (!Number.isFinite(scale) || scale <= 1e-6 || Math.abs(scale - 1) <= SCALE_EPS) continue
    if (t.strokeWidth > 0) {
      m._FPDFPageObj_SetStrokeWidth(t.obj, t.strokeWidth * scale)
      if (entry.hasGsLw) needsGsLwFix = true
    }
  }
  return needsGsLwFix
}

/**
 * Rewrite `q ... /GS gs ... BT ... ET Q` text blocks in a regenerated content stream so
 * any ExtGState containing `/LW` is swapped for a `/LW`-free clone. Path blocks (which
 * have no `BT`) keep the original ExtGState and its `/LW`.
 */
function stripLwFromTextExtGStatesInStream(
  doc: PDFDocument,
  resources: PDFDict | undefined,
  streamBytes: Uint8Array,
): Uint8Array | null {
  const gsDict = resources?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)
  if (!gsDict) return null
  const lwNames = new Set<string>()
  for (const key of gsDict.keys()) {
    const entry = gsDict.lookupMaybe(key, PDFDict)
    if (entry?.has(PDFName.of('LW'))) lwNames.add(key.decodeText())
  }
  if (lwNames.size === 0) return null

  const tokens = tokenizeContentStream(streamBytes)
  // Find `q ... Q` scopes that directly contain a `BT` operator (PDFium emits one per text object)
  interface Scope {
    hasBt: boolean
    gsNameTokens: { name: string; start: number; end: number }[]
  }
  const scopes: Scope[] = []
  const replacements: { start: number; end: number; name: string }[] = []

  let prevTok: StreamToken | null = null
  for (const tok of tokens) {
    if (tok.kind === 'op') {
      if (tok.value === 'q') {
        scopes.push({ hasBt: false, gsNameTokens: [] })
      } else if (tok.value === 'Q') {
        const closed = scopes.pop()
        if (closed?.hasBt) {
          for (const g of closed.gsNameTokens) replacements.push(g)
        }
      } else if (tok.value === 'BT') {
        const top = scopes[scopes.length - 1]
        if (top) top.hasBt = true
      } else if (tok.value === 'gs' && prevTok?.kind === 'name' && lwNames.has(prevTok.value)) {
        const top = scopes[scopes.length - 1]
        if (top)
          top.gsNameTokens.push({ name: prevTok.value, start: prevTok.start, end: prevTok.end })
      }
    }
    prevTok = tok
  }
  if (replacements.length === 0) return null

  const cloneNames = new Map<string, string>()
  const uniqueGsName = (base: string): string => {
    for (let n = 1; ; n++) {
      const candidate = `${base}_nolw${n === 1 ? '' : n}`
      if (!gsDict.has(PDFName.of(candidate))) return candidate
    }
  }
  for (const r of replacements) {
    if (cloneNames.has(r.name)) continue
    const origDict = gsDict.lookupMaybe(PDFName.of(r.name), PDFDict)
    if (!origDict) continue
    const cloned = origDict.clone(doc.context)
    cloned.delete(PDFName.of('LW'))
    const newName = uniqueGsName(r.name)
    gsDict.set(PDFName.of(newName), doc.context.register(cloned))
    cloneNames.set(r.name, newName)
  }

  replacements.sort((a, b) => a.start - b.start)
  const chunks: Uint8Array[] = []
  let cursor = 0
  for (const r of replacements) {
    const nextName = cloneNames.get(r.name)
    if (!nextName) continue
    chunks.push(streamBytes.subarray(cursor, r.start))
    chunks.push(Buffer.from(`/${nextName}`, 'latin1'))
    cursor = r.end
  }
  chunks.push(streamBytes.subarray(cursor))
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export interface StrokeCtmFixer {
  /** Normalize page-level stroked text objects before mutating a loaded PDFium page */
  preparePage(m: Pdfium, page: number, pageIndex: number): Promise<void>
  /** Normalize stroked text inside each Form XObject in `chain` before lifting an object out of it */
  prepareFormChain(
    m: Pdfium,
    pageIndex: number,
    chain: FormChain,
    ordinals: readonly number[],
  ): Promise<void>
  /** Post-save ExtGState `/LW` cleanup for pages whose stroked text inherited `/LW` via `gs` */
  fixSavedBytes(saved: Uint8Array): Promise<Uint8Array>
}

export function createStrokeCtmFixer(sourceBytes: Uint8Array): StrokeCtmFixer {
  let docPromise: Promise<PDFDocument | null> | null = null
  const preparedPages = new Set<number>()
  const preparedForms = new Set<number>()
  const pagesWithGsLw = new Set<number>()
  const formsWithGsLwPages = new Set<number>()

  const loadSource = (): Promise<PDFDocument | null> => {
    docPromise ??= PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    }).catch(() => null)
    return docPromise
  }

  return {
    async preparePage(m, page, pageIndex) {
      if (preparedPages.has(pageIndex)) return
      preparedPages.add(pageIndex)
      const count = m._FPDFPage_CountObjects(page)
      const pdfiumTexts = collectDirectTextObjects(m, count, (i) => m._FPDFPage_GetObject(page, i))
      if (!pdfiumTexts.some((t) => isStrokedTextMode(t.mode))) return

      const doc = await loadSource()
      if (!doc || pageIndex < 0 || pageIndex >= doc.getPageCount()) return
      const streamBytes = pageContentBytes(doc, pageIndex)
      if (!streamBytes) return
      const gsLw = readExtGStateLineWidths(doc.getPage(pageIndex).node.Resources())
      const streamTexts = analyzeStreamStrokedText(streamBytes, gsLw)
      if (matchAndScaleTextObjects(m, pdfiumTexts, streamTexts)) {
        pagesWithGsLw.add(pageIndex)
      }
    },

    async prepareFormChain(m, pageIndex, chain, ordinals) {
      if (chain.length === 0 || chain.length !== ordinals.length) return
      const doc = await loadSource()
      if (!doc) return
      for (let i = 0; i < chain.length; i++) {
        const form = chain[i]!
        if (preparedForms.has(form)) continue
        preparedForms.add(form)
        const count = m._FPDFFormObj_CountObjects(form)
        const pdfiumTexts = collectDirectTextObjects(m, count, (k) =>
          m._FPDFFormObj_GetObject(form, k),
        )
        if (!pdfiumTexts.some((t) => isStrokedTextMode(t.mode))) continue
        const formStream = resolveFormStreamByOrdinals(doc, pageIndex, ordinals.slice(0, i + 1))
        if (!formStream) continue
        const streamBytes = decodePdfStreamBytes(formStream)
        if (!streamBytes) continue
        const gsLw = readExtGStateLineWidths(
          formStream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict),
        )
        const streamTexts = analyzeStreamStrokedText(streamBytes, gsLw)
        if (matchAndScaleTextObjects(m, pdfiumTexts, streamTexts)) {
          formsWithGsLwPages.add(pageIndex)
        }
      }
    },

    async fixSavedBytes(saved) {
      if (pagesWithGsLw.size === 0 && formsWithGsLwPages.size === 0) return saved
      const doc = await PDFDocument.load(saved, { updateMetadata: false })
      let changed = false

      for (const pageIndex of pagesWithGsLw) {
        if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue
        const page = doc.getPage(pageIndex)
        const resources = page.node.Resources()
        const contents = page.node.Contents()
        const refs: PDFRef[] = []
        if (contents instanceof PDFArray) {
          for (let i = 0; i < contents.size(); i++) {
            const r = contents.get(i)
            if (r instanceof PDFRef) refs.push(r)
          }
        } else {
          const rawRef = page.node.get(PDFName.of('Contents'))
          if (rawRef instanceof PDFRef) refs.push(rawRef)
        }
        for (const ref of refs) {
          const s = doc.context.lookup(ref)
          if (!(s instanceof PDFStream)) continue
          const raw = decodePdfStreamBytes(s)
          if (!raw) continue
          const rewritten = stripLwFromTextExtGStatesInStream(doc, resources, raw)
          if (rewritten) {
            doc.context.assign(ref, doc.context.flateStream(rewritten))
            changed = true
          }
        }
      }

      for (const pageIndex of formsWithGsLwPages) {
        if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue
        const visited = new Set<string>()
        const walkResources = (res: PDFDict | undefined) => {
          const xobjs = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
          if (!xobjs) return
          for (const key of xobjs.keys()) {
            const ref = xobjs.get(key)
            if (!(ref instanceof PDFRef)) continue
            const id = ref.toString()
            if (visited.has(id)) continue
            visited.add(id)
            const s = doc.context.lookup(ref)
            if (!(s instanceof PDFStream)) continue
            if (s.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) continue
            const formRes = s.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
            const raw = decodePdfStreamBytes(s)
            if (raw) {
              const rewritten = stripLwFromTextExtGStatesInStream(doc, formRes, raw)
              if (rewritten) {
                const clonedDict = s.dict.clone(doc.context)
                clonedDict.delete(PDFName.of('Filter'))
                clonedDict.delete(PDFName.of('DecodeParms'))
                clonedDict.delete(PDFName.of('Length'))
                doc.context.assign(ref, PDFRawStream.of(clonedDict, rewritten))
                changed = true
              }
            }
            walkResources(formRes)
          }
        }
        walkResources(doc.getPage(pageIndex).node.Resources())
      }

      return changed ? doc.save({ useObjectStreams: false }) : saved
    },
  }
}

/** Scale a stroked text object's stroke width when a matrix transform (e.g. liftOutOfForms) is baked into it */
export function scaleTextStrokeForTransform(m: Pdfium, obj: number, mat: readonly number[]): void {
  if (m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) return
  if (!isStrokedTextMode(m._FPDFTextObj_GetTextRenderMode(obj))) return
  const scale = ctmScaleOf(mat)
  if (!Number.isFinite(scale) || scale <= 1e-6 || Math.abs(scale - 1) <= SCALE_EPS) return
  const p = m._malloc(4)
  try {
    if (!m._FPDFPageObj_GetStrokeWidth(obj, p)) return
    const w = m.HEAPF32[p >> 2]!
    if (w > 0) m._FPDFPageObj_SetStrokeWidth(obj, w * scale)
  } finally {
    m._free(p)
  }
}
