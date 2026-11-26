// The form feature's rules without React (spec 3.8): the PC form catalog per document,
// the PC FormLayer value rules, the op context the catalog feeds, the file's saved
// static form fills, and where a check/cross mark lands (PC App.tsx placeFormMark).
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  geomDispSize,
  pdfToView,
  viewToPdf,
  type PageGeom,
} from '../../../../../../../pdf/src/renderer/annotations'
import type { LocalDrawing } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { LocalImageEdit } from '../../../../../../../pdf/src/renderer/ImageEditLayer'
import {
  buildFormCatalog,
  type FormCatalog,
  type FormWidget,
} from '../../../../../../../pdf/src/renderer/form-catalog'
import { collectDetectInput } from '../../../../../../../pdf/src/renderer/form-detect'
import {
  checkboxWidgetAt,
  markRectForBox,
  printedBoxAt,
  type Rect,
} from '../../../../../../../pdf/src/renderer/form-mark-target'
import type {
  FormValueInput,
  FormWidgetEditInput,
  StaticFormFillRecord,
} from '../../../../../../../pdf/src/shared/ipc'
import type { Op, PdfSignatureTarget } from '../../edit/types'

export type { FormCatalog, FormWidget }

export type FormMarkKind = 'check' | 'cross'

/** A painted mark (PC `renderStaticFormMark` output: transparent PNG, base64, size in points). */
export interface FormMarkImage {
  readonly kind: 'image'
  readonly image: string
  readonly width: number
  readonly height: number
}

export type FormMarkPainter = (kind: FormMarkKind, size?: number) => FormMarkImage | null

/** PC STATIC_FORM_MARK_SIZE: the mark dropped where no box is found, in points. */
export const FORM_MARK_SIZE = 12

export const emptyFormCatalog = (): FormCatalog => ({
  widgets: [],
  fields: new Map(),
  byPage: new Map(),
  otherFieldNames: new Set(),
})

const catalogs = new WeakMap<PDFDocumentProxy, Promise<FormCatalog>>()

/**
 * The PC form catalog of a document, read once per PDF.js document (also for the AI
 * task). A document without AcroForm fields skips the per-page annotation walk: no
 * fillable field can exist and the PC save writes form values through the AcroForm.
 * A failed read is an empty catalog, as on the PC.
 */
export function loadFormCatalog(doc: PDFDocumentProxy): Promise<FormCatalog> {
  let pending = catalogs.get(doc)
  if (!pending) {
    pending = (async () => {
      const fields = await doc.getFieldObjects().catch(() => null)
      if (!fields || Object.keys(fields).length === 0) return emptyFormCatalog()
      return buildFormCatalog(doc)
    })().catch(() => emptyFormCatalog())
    catalogs.set(doc, pending)
  }
  return pending
}

const shapeCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<readonly Rect[]>>>()

/** Drawn path boxes of one page (PC App.tsx `pageBoxShapes`), read on first need. */
export function pageBoxShapes(doc: PDFDocumentProxy, pageIndex: number): Promise<readonly Rect[]> {
  let byPage = shapeCache.get(doc)
  if (!byPage) {
    byPage = new Map()
    shapeCache.set(doc, byPage)
  }
  let pending = byPage.get(pageIndex)
  if (!pending) {
    pending = doc
      .getPage(pageIndex + 1)
      .then((page) => collectDetectInput(page))
      .then((input) => input.shapes)
      .catch(() => [])
    byPage.set(pageIndex, pending)
  }
  return pending
}

/** PC App.tsx `liveFormCatalog`: the file's widgets with pending Form Design edits applied. */
export function liveFormCatalog(
  catalog: FormCatalog | null,
  widgetEdits: ReadonlyMap<string, FormWidgetEditInput>,
): FormCatalog | null {
  if (!catalog || widgetEdits.size === 0) return catalog
  const widgets = catalog.widgets.flatMap((w) => {
    const e = widgetEdits.get(w.id)
    if (!e) return [w]
    if (e.remove) return []
    return [{ ...w, rect: e.rect ?? w.rect, required: e.required ?? w.required }]
  })
  const byPage = new Map<number, FormWidget[]>()
  for (const w of widgets) byPage.set(w.pageIndex, [...(byPage.get(w.pageIndex) ?? []), w])
  return { ...catalog, widgets, byPage }
}

/** PC App.tsx `liveFieldNames`: names a new field must not take, field groups included. */
export function liveFieldNames(
  catalog: FormCatalog | null,
  widgetEdits: ReadonlyMap<string, FormWidgetEditInput>,
): string[] {
  if (!catalog) return []
  const alive = new Set<string>()
  for (const w of catalog.widgets) if (!widgetEdits.get(w.id)?.remove) alive.add(w.fieldName)
  const names = [
    ...[...catalog.fields.keys()].filter((name) => alive.has(name)),
    ...catalog.otherFieldNames,
  ]
  // every ancestor of a dotted name is a field group: generators and validation treat it as taken
  const groups = names.flatMap((name) => {
    const parts = name.split('.')
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'))
  })
  return [...names, ...groups]
}

/** The catalog's part of PC `editOpContext` (the frame adds the pending authored fields). */
export function formOpContext(
  catalog: FormCatalog | null,
  widgetEdits: ReadonlyMap<string, FormWidgetEditInput>,
): { fieldNames: Set<string>; radioGroups: Set<string> } {
  return {
    fieldNames: new Set(liveFieldNames(catalog, widgetEdits)),
    radioGroups: new Set(
      [...(catalog?.fields.values() ?? [])].filter((f) => f.kind === 'radio').map((f) => f.name),
    ),
  }
}

/** What a widget shows: its pending value, else the file's (PC FormLayer). */
export function widgetState(
  widget: FormWidget,
  formEdits: ReadonlyMap<string, FormValueInput>,
): { value: string; checked: boolean } {
  const edit = formEdits.get(widget.fieldName)
  if (widget.kind === 'checkbox') {
    return { value: '', checked: edit ? !!edit.checked : widget.checked }
  }
  const value = edit ? (edit.value ?? '') : widget.value
  return { value, checked: widget.kind === 'radio' && value === widget.buttonValue }
}

/**
 * The value a tap on a check box or radio button sets (PC FormLayer `onChange`): a
 * check box toggles; a radio button picks its export value for the whole group, and
 * a tap on the button already chosen changes nothing (a native radio fires no change).
 */
export function tapValue(
  widget: FormWidget,
  formEdits: ReadonlyMap<string, FormValueInput>,
): FormValueInput | null {
  const state = widgetState(widget, formEdits)
  if (widget.kind === 'checkbox') {
    return { name: widget.fieldName, kind: 'checkbox', checked: !state.checked }
  }
  if (widget.kind === 'radio') {
    return state.checked
      ? null
      : { name: widget.fieldName, kind: 'radio', value: widget.buttonValue }
  }
  return null
}

export interface ChoiceRow {
  readonly value: string
  readonly label: string
  readonly disabled: boolean
}

/**
 * Rows of a choice field (PC FormLayer): an unknown current value stays as a disabled
 * row showing the raw export value, so no blank row can re-commit a bogus value.
 */
export function choiceRows(widget: FormWidget, value: string): ChoiceRow[] {
  const known = widget.options.some((o) => o.exportValue === value)
  return [
    ...(known || value === '' ? [] : [{ value, label: value, disabled: true }]),
    ...widget.options.map((o) => ({
      value: o.exportValue,
      label: o.displayValue,
      disabled: false,
    })),
  ]
}

/** The label a choice field shows for its value. */
export function choiceLabel(widget: FormWidget, value: string): string {
  return widget.options.find((o) => o.exportValue === value)?.displayValue ?? value
}

/** Signature widgets already signed by a pending drawing (PC `signedFormWidgetIds`, by id or field). */
export function signedWidgetKeys(drawings: readonly LocalDrawing[]): {
  ids: Set<string>
  names: Set<string>
} {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const d of drawings) {
    if (d.formWidgetId !== undefined) ids.add(d.formWidgetId)
    const fieldName = (d.input as { formFieldName?: string }).formFieldName
    if (fieldName) names.add(fieldName)
  }
  return { ids, names }
}

/** The sign feature's target: the widget itself (PC `signatureDrawingForField` reads it). */
export function signatureTarget(widget: FormWidget): PdfSignatureTarget & FormWidget {
  return { ...widget, rect: [...widget.rect] }
}

// ── saved static form fills ─────────────────────────────────────────────────

const FILLS_KEY = 'GenOfficeStaticFormFills'
const FILLS_MARKER = new TextEncoder().encode(FILLS_KEY)

function containsMarker(bytes: Uint8Array): boolean {
  const first = FILLS_MARKER[0]!
  const last = bytes.length - FILLS_MARKER.length
  outer: for (
    let i = bytes.indexOf(first);
    i !== -1 && i <= last;
    i = bytes.indexOf(first, i + 1)
  ) {
    for (let k = 1; k < FILLS_MARKER.length; k++) {
      if (bytes[i + k] !== FILLS_MARKER[k]) continue outer
    }
    return true
  }
  return false
}

/** PC save-pdf.ts `validStaticFormFill`. */
function validStaticFormFill(value: unknown): value is StaticFormFillRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StaticFormFillRecord>
  return (
    typeof record.id === 'string' &&
    (record.kind === 'text' || record.kind === 'check' || record.kind === 'cross') &&
    Number.isInteger(record.pageIndex) &&
    Array.isArray(record.rect) &&
    record.rect.length === 4 &&
    record.rect.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  )
}

/**
 * The static form fills recorded in the file, read like PC `readStaticFormFills`
 * (save-pdf.ts, main process): the catalog's `/GenOfficeStaticFormFills` hex string
 * as JSON, invalid records dropped, any failure (an encrypted file, too) → [].
 * Files without the key's bytes skip the pdf-lib parse: every PC and mobile save
 * writes it uncompressed (no object streams), so a whole-document parse on the UI
 * thread is spent only where a record can be.
 */
export async function readSavedStaticFormFills(bytes: Uint8Array): Promise<StaticFormFillRecord[]> {
  if (!containsMarker(bytes)) return []
  try {
    const { PDFDocument, PDFHexString, PDFName } = await import('pdf-lib')
    const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false })
    const value = pdfDoc.catalog.get(PDFName.of(FILLS_KEY))
    if (!(value instanceof PDFHexString)) return []
    const parsed: unknown = JSON.parse(value.decodeText())
    return Array.isArray(parsed) ? parsed.filter(validStaticFormFill) : []
  } catch {
    return []
  }
}

// ── check / cross marks ─────────────────────────────────────────────────────

/** A pending check/cross the person placed (an `insertImage` edit tagged as a static fill). */
export interface PendingFormMark {
  readonly id: string
  readonly kind: FormMarkKind
  readonly pageIndex: number
  readonly rect: readonly [number, number, number, number]
  readonly image: string
}

export function pendingFormMarks(imageEdits: readonly LocalImageEdit[]): PendingFormMark[] {
  return imageEdits.flatMap((e) =>
    e.input.kind === 'insertImage' &&
    (e.staticFill?.kind === 'check' || e.staticFill?.kind === 'cross')
      ? [
          {
            id: e.id,
            kind: e.staticFill.kind,
            pageIndex: e.input.pageIndex,
            rect: e.input.rect,
            image: e.input.image,
          },
        ]
      : [],
  )
}

/** PC App.tsx `pdfRectFromView`: a display box at scale 1 → PDF rect. */
export function pdfRectFromView(
  geom: PageGeom,
  left: number,
  top: number,
  w: number,
  h: number,
): [number, number, number, number] {
  const [ax, ay] = viewToPdf(geom, left, top)
  const [bx, by] = viewToPdf(geom, left + w, top + h)
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

const normRot = (rot: number) => ((rot % 360) + 360) % 360

/** PC App.tsx `commitPlacedImage` for a mark: an insertImage above the text, tagged as a static fill. */
export function markOp(
  id: string,
  kind: FormMarkKind,
  pageIndex: number,
  geom: PageGeom,
  image: string,
  rect: [number, number, number, number],
): Op {
  return {
    op: 'addImageEdit',
    id,
    input: {
      kind: 'insertImage',
      pageIndex,
      image,
      rect,
      layer: 'aboveText',
      rotate: normRot(geom.rot),
    },
    staticFill: { id, kind, pageIndex, rect },
  }
}

export interface MarkPlacement {
  readonly kind: FormMarkKind
  readonly pageIndex: number
  readonly geom: PageGeom
  /** Tap point in display coordinates at scale 1 (page top-left, y down). */
  readonly vx: number
  readonly vy: number
  /** Live widgets of the page. */
  readonly widgets: readonly FormWidget[]
  readonly shapes: () => Promise<readonly Rect[]>
  readonly paint: FormMarkPainter
  readonly newId: () => string
}

/**
 * PC App.tsx `placeFormMark`: a mark on an interactive check box ticks that field; on
 * a printed box it fills the box; anywhere else it is centred on the tap and kept on
 * the page. The ops to dispatch, or null when no mark could be painted.
 */
export async function planFormMark(p: MarkPlacement): Promise<Op[] | null> {
  const [px, py] = viewToPdf(p.geom, p.vx, p.vy)
  const widget = checkboxWidgetAt(p.widgets, px, py)
  if (widget) {
    return [
      { op: 'setFormValue', value: { name: widget.fieldName, kind: 'checkbox', checked: true } },
    ]
  }
  const box = printedBoxAt(await p.shapes(), px, py)
  if (box) {
    const rect = markRectForBox(box)
    const image = p.paint(p.kind, rect[2] - rect[0])
    return image ? [markOp(p.newId(), p.kind, p.pageIndex, p.geom, image.image, rect)] : null
  }
  const pick = p.paint(p.kind)
  if (!pick) return null
  const disp = geomDispSize(p.geom)
  const left = Math.min(Math.max(p.vx - pick.width / 2, 0), Math.max(disp.width - pick.width, 0))
  const top = Math.min(Math.max(p.vy - pick.height / 2, 0), Math.max(disp.height - pick.height, 0))
  const rect = pdfRectFromView(p.geom, left, top, pick.width, pick.height)
  return [markOp(p.newId(), p.kind, p.pageIndex, p.geom, pick.image, rect)]
}

/** A mark's rect moved by a display delta at scale 1, kept on the page. */
export function movedMarkRect(
  geom: PageGeom,
  rect: readonly [number, number, number, number],
  dx: number,
  dy: number,
): [number, number, number, number] {
  const [ax, ay] = pdfToView(geom, rect[0], rect[1])
  const [bx, by] = pdfToView(geom, rect[2], rect[3])
  const w = Math.abs(bx - ax)
  const h = Math.abs(by - ay)
  const disp = geomDispSize(geom)
  const left = Math.min(Math.max(Math.min(ax, bx) + dx, 0), Math.max(disp.width - w, 0))
  const top = Math.min(Math.max(Math.min(ay, by) + dy, 0), Math.max(disp.height - h, 0))
  return pdfRectFromView(geom, left, top, w, h)
}
