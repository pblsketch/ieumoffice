// Pure rules of the Text box tool (spec 2.3, 3.7): the PC text insert and text edit
// inputs built from a draft, the font coverage checks against the engine, and the
// page text the tool hit-tests. No React here; useTextFeature.tsx owns the state.
import { viewToPdf, type PageGeom } from '../../../../../../../pdf/src/renderer/annotations'
import { hexTo255, rgb255ToHex } from '../../../../../../../pdf/src/renderer/color-presets'
import type { Op } from '../../../../../../../pdf/src/renderer/edit-ops'
import { isScannedText } from '../../../../../../../pdf/src/renderer/ocr-layer'
import type { PageEntry } from '../../../../../../../pdf/src/renderer/search'
import {
  reflowOverflows,
  type BlockLine,
  type TextBlock,
} from '../../../../../../../pdf/src/renderer/text-block'
import type {
  LocalTextEdit,
  LocalTextInsert,
} from '../../../../../../../pdf/src/renderer/text-edit-preview'
import {
  joinBlockLines,
  measurePt,
  wrapText,
} from '../../../../../../../pdf/src/renderer/text-wrap'
import type { TextEditInput, TextInsertInput } from '../../../../../../../pdf/src/shared/ipc'
import { keepsStandardFace } from './pageFonts'

export { isScannedText }

/** The PC edit-font ids; on the phone each one is an app font (spec 2.1, 2.3). */
export type TextFontId = 'arial' | 'times' | 'courier'

export interface TextFontChoice {
  readonly id: TextFontId
  /** The app font's own name, shown as is (a font name, not a sentence). */
  readonly label: string
  /** CSS family of the bundled face (assets/fonts/fonts.css). */
  readonly css: string
}

export const TEXT_FONTS: readonly TextFontChoice[] = [
  { id: 'arial', label: 'GenOffice Sans KR', css: "'GenOffice Sans KR', sans-serif" },
  { id: 'times', label: 'GenOffice Serif KR', css: "'GenOffice Serif KR', serif" },
  { id: 'courier', label: 'GenOffice Gothic KR', css: "'GenOffice Gothic KR', sans-serif" },
]

/** New text starts in Sans (spec 2.3). */
export const DEFAULT_TEXT_FONT: TextFontId = 'arial'
/** PC static text dialog defaults (App.tsx staticTextSize / staticTextColor). */
export const DEFAULT_TEXT_SIZE = 14
export const DEFAULT_TEXT_COLOR = '#111111'

/** Font sizes the size buttons step through (pt). */
export const TEXT_SIZES: readonly number[] = [
  6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72,
]

export const fontCss = (id: string | undefined): string | undefined =>
  TEXT_FONTS.find((f) => f.id === id)?.css

export const isTextFontId = (v: unknown): v is TextFontId => TEXT_FONTS.some((f) => f.id === v)

/** The next size up or down from `size` in TEXT_SIZES (sizes between steps snap). */
export function stepTextSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return TEXT_SIZES.find((s) => s > size + 0.01) ?? TEXT_SIZES[TEXT_SIZES.length - 1]!
  for (let i = TEXT_SIZES.length - 1; i >= 0; i--)
    if (TEXT_SIZES[i]! < size - 0.01) return TEXT_SIZES[i]!
  return TEXT_SIZES[0]!
}

// ── drafts ──────────────────────────────────────────────────────────────────

/** A new text box, or a pending insert reopened (`insertId`). */
export interface InsertDraft {
  readonly kind: 'insert'
  readonly pageIndex: number
  /** First baseline, PDF user space (PC TextInsertInput.origin). */
  readonly origin: [number, number]
  readonly value: string
  readonly fontSize: number
  /** CSS hex. */
  readonly color: string
  readonly font: TextFontId
  readonly bold: boolean
  readonly insertId?: string
}

/** Paragraph geometry a block draft reflows into (PC TextDraft.block). */
export interface BlockGeometry {
  readonly leftPt: number
  readonly firstBaseline: number
  readonly widthPt: number
  readonly lineHeight: number
  readonly align: 'left' | 'center' | 'right'
  readonly bottomPt: number
}

/** Document text being changed: a clustered block, or one line (PC TextDraft). */
export interface EditDraft {
  readonly kind: 'edit'
  readonly pageIndex: number
  readonly rect: [number, number, number, number]
  readonly oldText: string
  /** The run's own size (PDF pt). */
  readonly fontSize: number
  readonly value: string
  /** Style overrides; undefined keeps the document's own. */
  readonly size?: number
  readonly color?: string
  readonly font?: TextFontId
  readonly bold?: true
  /** Present for multi-line paragraphs: the commit reflows into this. */
  readonly block?: BlockGeometry
  /** The pending edit this draft reopened. */
  readonly editId?: string
  /** Pending line edits inside the block folded into `value` (the commit replaces them). */
  readonly foldedIds?: readonly string[]
  /** `value` as the fold opened it: committing it untouched keeps those line edits. */
  readonly foldBase?: string
  /** Ink bounds from the dry run (preview cover). */
  readonly cover?: [number, number, number, number]
  /** The run's own ink (display only). */
  readonly seedInk?: string
  /** Characters the document's embedded face is known to draw (see knownCharsFor). */
  readonly knownChars: string
  /** BaseFont names of the run's fonts (async, from PDF.js); see predictEditFont. */
  readonly runFontNames?: readonly string[]
  /** The line under the tap: the fallback when the block cannot be matched as a whole. */
  readonly tapLine?: BlockLine
}

export type TextDraft = InsertDraft | EditDraft

export const blockGeometry = (block: TextBlock): BlockGeometry => ({
  leftPt: block.rect[0],
  firstBaseline: block.lines[0]!.y,
  widthPt: block.rect[2] - block.rect[0],
  lineHeight: block.lineHeight,
  align: block.align,
  bottomPt: block.rect[1],
})

// ── page text ───────────────────────────────────────────────────────────────

/** Whether the page has a text layer to edit (PC isScannedText: under 8 characters). */
export const pageHasText = (entry: PageEntry | undefined): boolean =>
  !!entry && !isScannedText(entry.text)

/** The block under a PDF point, `slop` pt of finger tolerance around each block. */
export function blockAt(
  blocks: readonly TextBlock[],
  px: number,
  py: number,
  slop = 0,
): TextBlock | undefined {
  const inside = (b: TextBlock, s: number) =>
    px >= b.rect[0] - s && px <= b.rect[2] + s && py >= b.rect[1] - s && py <= b.rect[3] + s
  return (
    blocks.find((b) => inside(b, 0)) ?? (slop > 0 ? blocks.find((b) => inside(b, slop)) : undefined)
  )
}

/** The line of `block` nearest to a PDF y. */
export function lineAt(block: TextBlock, py: number): BlockLine {
  let best = block.lines[0]!
  let bestD = Infinity
  for (const l of block.lines) {
    const d = py < l.rect[1] ? l.rect[1] - py : py > l.rect[3] ? py - l.rect[3] : 0
    if (d < bestD) {
      bestD = d
      best = l
    }
  }
  return best
}

/**
 * The characters the page already draws in the fonts of `rect`: an embedded subset
 * holds exactly the glyphs the document uses, so these are the ones the run's own
 * face provably draws (the same evidence PC text-edit.ts canReuseFont relies on).
 */
export function knownCharsFor(
  entry: PageEntry | undefined,
  rect: readonly [number, number, number, number],
  fallbackText: string,
): string {
  const known = new Set<string>()
  for (const ch of fallbackText) known.add(ch)
  if (!entry) return [...known].join('')
  const fonts = new Set(fontIdsIn(entry, rect))
  for (const it of entry.items) {
    if (!it.font || !fonts.has(it.font)) continue
    for (const ch of entry.text.slice(it.start, it.end)) known.add(ch)
  }
  return [...known].join('')
}

/** PDF.js font ids of the text items centered inside `rect`. */
export function fontIdsIn(
  entry: PageEntry | undefined,
  rect: readonly [number, number, number, number],
): string[] {
  const fonts = new Set<string>()
  for (const it of entry?.items ?? []) {
    const cx = it.x + it.w / 2
    const cy = it.y + it.h / 2
    if (it.font && cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3])
      fonts.add(it.font)
  }
  return [...fonts]
}

/** A draft over a whole block (multi-line) or over one of its lines. */
export function editDraftFor(
  pageIndex: number,
  block: TextBlock,
  entry: PageEntry | undefined,
  tapY?: number,
): EditDraft {
  const multi = block.lines.length > 1
  const tapLine = tapY !== undefined ? lineAt(block, tapY) : undefined
  if (!multi) {
    const line = block.lines[0]!
    return lineDraftFor(pageIndex, line, entry)
  }
  const oldText = joinBlockLines(block.lines.map((l) => l.text))
  const rect: [number, number, number, number] = [...block.rect]
  return {
    kind: 'edit',
    pageIndex,
    rect,
    oldText,
    fontSize: block.fontSize,
    value: oldText,
    block: blockGeometry(block),
    knownChars: knownCharsFor(entry, rect, oldText),
    ...(tapLine ? { tapLine } : {}),
  }
}

/** A line-level draft (PC openLineEdit): the line's own rect and text, no origin. */
export function lineDraftFor(
  pageIndex: number,
  line: BlockLine,
  entry: PageEntry | undefined,
): EditDraft {
  const rect: [number, number, number, number] = [...line.rect]
  const oldText = line.text.trim()
  return {
    kind: 'edit',
    pageIndex,
    rect,
    oldText,
    fontSize: line.fontSize,
    value: oldText,
    knownChars: knownCharsFor(entry, rect, oldText),
  }
}

/** Reopen a pending edit: paragraph edits carry their logical text and geometry. */
export function draftFromPendingEdit(te: LocalTextEdit, entry: PageEntry | undefined): EditDraft {
  const e = te.input
  const ratio = e.newFontSize !== undefined && e.fontSize > 0 ? e.newFontSize / e.fontSize : 1
  const block: BlockGeometry | undefined =
    e.blockSource !== undefined && e.origin
      ? {
          leftPt: e.origin[0],
          firstBaseline: e.origin[1],
          widthPt: e.rect[2] - e.rect[0],
          lineHeight: (e.lineLeading ?? e.fontSize * 1.2) / ratio,
          align: e.align ?? 'left',
          bottomPt: e.rect[1],
        }
      : undefined
  return {
    kind: 'edit',
    pageIndex: e.pageIndex,
    rect: [...e.rect],
    oldText: e.oldText,
    fontSize: e.fontSize,
    value: e.blockSource ?? e.newText,
    ...(e.newFontSize !== undefined ? { size: e.newFontSize } : {}),
    ...(e.newColor ? { color: rgb255ToHex(e.newColor) } : {}),
    ...(isTextFontId(e.newFont) ? { font: e.newFont } : {}),
    ...(e.newBold ? { bold: true as const } : {}),
    ...(block ? { block } : {}),
    editId: te.id,
    ...(te.cover ? { cover: te.cover } : {}),
    ...(te.baseInk ? { seedInk: te.baseInk } : {}),
    knownChars: knownCharsFor(entry, e.rect, e.oldText),
  }
}

export function insertDraftAt(
  pageIndex: number,
  geom: PageGeom,
  vx: number,
  vy: number,
  style: Pick<InsertDraft, 'fontSize' | 'color' | 'font' | 'bold'>,
): InsertDraft {
  // The tap is the top-left of the box; the baseline sits one font size below it,
  // where the PC insert preview (textInsertPreviewStyle) puts the box top.
  return {
    kind: 'insert',
    pageIndex,
    origin: viewToPdf(geom, vx, vy + style.fontSize),
    value: '',
    ...style,
  }
}

export function draftFromPendingInsert(insert: LocalTextInsert): InsertDraft {
  const e = insert.input
  return {
    kind: 'insert',
    pageIndex: e.pageIndex,
    origin: [e.origin[0], e.origin[1]],
    value: e.text,
    fontSize: e.fontSize,
    color: rgb255ToHex(e.color),
    font: isTextFontId(e.font) ? e.font : DEFAULT_TEXT_FONT,
    bold: !!e.bold,
    insertId: insert.id,
  }
}

// ── inputs (PC shapes) ──────────────────────────────────────────────────────

const normRot = (r: number) => ((r % 360) + 360) % 360

/** The style part of an insert (PC App.tsx textInsertConfig, left-aligned) plus the
    font choice the phone always makes. */
export function insertStyleOf(d: InsertDraft): Omit<TextInsertInput, 'pageIndex' | 'origin'> {
  return {
    text: d.value,
    fontSize: d.fontSize,
    color: hexTo255(d.color),
    font: d.font,
    ...(d.bold ? { bold: true } : {}),
    lineLeading: d.fontSize * 1.2,
    lineXOffsets: d.value.split('\n').map(() => 0),
    align: 'left',
  }
}

/** PC placeTextInsert: the style, the page, the origin and the displayed rotation. */
export function insertInputOf(d: InsertDraft, geom: PageGeom): TextInsertInput {
  return {
    ...insertStyleOf(d),
    pageIndex: d.pageIndex,
    origin: d.origin,
    rotate: normRot(geom.rot),
  }
}

/** Whether a draft would change nothing (PC mergeTextDraft's no-op checks). */
export function editDraftUnchanged(d: EditDraft, existing: LocalTextEdit | undefined): boolean {
  if (existing) {
    const e = existing.input
    return (
      d.value === (e.blockSource ?? e.newText) &&
      d.size === e.newFontSize &&
      d.color === (e.newColor ? rgb255ToHex(e.newColor) : undefined) &&
      d.font === e.newFont &&
      d.bold === (e.newBold ? true : undefined)
    )
  }
  if (d.foldBase !== undefined) return d.value === d.foldBase && !editDraftHasStyle(d)
  return editDraftIsOriginal(d)
}

const editDraftHasStyle = (d: EditDraft): boolean =>
  d.size !== undefined || d.color !== undefined || d.font !== undefined || d.bold !== undefined

/** The draft reads exactly like the document again. */
export const editDraftIsOriginal = (d: EditDraft): boolean =>
  d.value === d.oldText && !editDraftHasStyle(d)

const BODY_FONT = () =>
  typeof document !== 'undefined' && document.body
    ? getComputedStyle(document.body).fontFamily
    : 'sans-serif'

/**
 * PC mergeTextDraft's input: a paragraph draft reflows its text into the block width
 * (greedy wrap in the face the preview uses) and anchors the lines at the block corner
 * with the block's leading; a line draft replaces the run in place. 'overflow' = the
 * reflow would run onto other text below (PC reflowOverflows).
 */
export function editInputOf(
  d: EditDraft,
  pageBlocks: readonly TextBlock[] | undefined,
): TextEditInput | 'overflow' {
  let newText = d.value.trim() === '' ? '' : d.value
  let origin: [number, number] | undefined
  let lineLeading: number | undefined
  let lineXOffsets: number[] | undefined
  if (d.block && newText !== '') {
    const block = d.block
    const size = d.size ?? d.fontSize
    const css = fontCss(d.font) ?? BODY_FONT()
    const cssStyle = d.bold && d.font ? 'bold' : ''
    lineLeading = block.lineHeight * (size / d.fontSize)
    const wrapped = d.value
      .split('\n')
      .flatMap((p) => (p.trim() ? wrapText(p, block.widthPt, size, css, cssStyle) : []))
    if (
      reflowOverflows(
        block,
        wrapped.length,
        lineLeading,
        size,
        pageBlocks ? [...pageBlocks] : undefined,
        d.rect,
      )
    )
      return 'overflow'
    newText = wrapped.join('\n')
    origin = [block.leftPt, block.firstBaseline]
    if (block.align !== 'left') {
      lineXOffsets = wrapped.map((l) => {
        const slack = block.widthPt - measurePt(l, size, css, cssStyle)
        return Math.max(0, block.align === 'center' ? slack / 2 : slack)
      })
    }
  }
  const input: TextEditInput = {
    pageIndex: d.pageIndex,
    rect: d.rect,
    oldText: d.oldText,
    newText,
    fontSize: d.fontSize,
  }
  if (d.size !== undefined) input.newFontSize = d.size
  if (d.color !== undefined) input.newColor = hexTo255(d.color)
  if (d.font !== undefined) input.newFont = d.font
  if (d.bold) input.newBold = true
  if (origin) input.origin = origin
  if (lineLeading !== undefined) input.lineLeading = lineLeading
  if (lineXOffsets) input.lineXOffsets = lineXOffsets
  if (d.block && d.block.align !== 'left') input.align = d.block.align
  if (d.block) input.blockSource = d.value
  return input
}

/** PC App.tsx textEditListOps: the ops turning the pending text-edit list into `next`. */
export function textEditListOps(
  prev: readonly LocalTextEdit[],
  next: readonly LocalTextEdit[],
): Op[] {
  const keep = new Set(next.map((e) => e.id))
  const before = new Map(prev.map((e) => [e.id, e]))
  return [
    ...prev.filter((e) => !keep.has(e.id)).map((e): Op => ({ op: 'removeTextEdit', id: e.id })),
    ...next
      .filter((e) => before.get(e.id) !== e)
      .map((e): Op => {
        const op: Op = { op: 'putTextEdit', id: e.id, input: e.input }
        if (e.cover) op.cover = e.cover
        if (e.moveBy) op.moveBy = e.moveBy
        if (e.baseInk) op.baseInk = e.baseInk
        if (e.paper) op.paper = e.paper
        return op
      }),
  ]
}

// ── font coverage (spec 2.3) ────────────────────────────────────────────────

/** The engine's PC canDrawText (font ids 'arial' | 'times' | 'courier'). */
export type CanDrawText = (
  text: string,
  font?: string,
  bold?: boolean,
  italic?: boolean,
) => Promise<boolean>

const uniqueChars = (text: string): string[] => {
  const seen = new Set<string>()
  for (const ch of text) if (ch.trim() !== '') seen.add(ch)
  return [...seen]
}

/**
 * The characters of `text` no face can draw: PC canDrawText on the whole text, and
 * only when that fails, character by character to name the offenders.
 */
export async function uncoverableChars(
  canDraw: CanDrawText,
  text: string,
  font?: string,
  bold = false,
): Promise<string[]> {
  const chars = uniqueChars(text)
  if (chars.length === 0) return []
  if (await canDraw(chars.join(''), font, bold)) return []
  const bad: string[] = []
  for (const ch of chars) if (!(await canDraw(ch, font, bold))) bad.push(ch)
  // One face must draw the whole run; when each char alone passes, name them all
  return bad.length > 0 ? bad : chars
}

export type EditFontOutcome =
  | { readonly kind: 'ok' }
  /** The document's own face lacks these; the save draws them in an app font. */
  | { readonly kind: 'substitute'; readonly chars: string[] }
  /** Not even the app fonts draw these: the edit cannot be saved. */
  | { readonly kind: 'blocked'; readonly chars: string[] }

/**
 * What the save will draw an edit with (PC text-edit.ts resolveRebuildFont): an
 * explicit edit font draws it, else a fallback; without one, the embedded face keeps
 * the characters it holds and the rest take the fallback, which on the phone is an
 * app font. The embedded subset is predicted from the characters the page already
 * draws in that face.
 */
export async function predictEditFont(
  canDraw: CanDrawText,
  newText: string,
  knownChars: string,
  font: string | undefined,
  bold: boolean,
  runFontNames: readonly string[] = [],
): Promise<EditFontOutcome> {
  if (font) {
    const bad = await uncoverableChars(canDraw, newText, font, bold)
    return bad.length > 0 ? { kind: 'blocked', chars: bad } : { kind: 'ok' }
  }
  // An unembedded base-14 face keeps drawing WinAnsi text (PC keptStandardFont)
  if (runFontNames.length > 0 && runFontNames.every((n) => keepsStandardFace(n, newText)))
    return { kind: 'ok' }
  const known = new Set(knownChars.normalize('NFKC'))
  const missing = uniqueChars(newText).filter(
    (ch) => !knownChars.includes(ch) && !known.has(ch.normalize('NFKC')),
  )
  if (missing.length === 0) return { kind: 'ok' }
  const bad = await uncoverableChars(canDraw, missing.join(''))
  return bad.length > 0 ? { kind: 'blocked', chars: bad } : { kind: 'substitute', chars: missing }
}

/** How offending characters are listed in a message. */
export const charList = (chars: readonly string[]): string => chars.join(' ')
