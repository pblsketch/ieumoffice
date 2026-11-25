// Pending edits → the PC save request (apps/pdf/src/shared/ipc.ts `SavePdfRequest`),
// built the way the PC editor builds it (App.tsx `editsPayload`, `staticFormFills`,
// `visList`), and the PC main-process guards of annotation handling (pdf-main.ts).
import type { EditSnapshot } from '../../../../../../pdf/src/renderer/edit-state'
import type {
  AnnotDeleteInput,
  NoteEditInput,
  SavePdfRequest,
  StaticFormFillRecord,
} from '../../../../../../pdf/src/shared/ipc'
import type { PdfOpenedDocument } from '../view'
import type { PdfAnnotationChoice, PdfRequestExtras } from './types'

/** Visible pages in order (PC `visList`): original indices, pending blank pages included, deleted left out. */
export function visiblePageList(edits: EditSnapshot, documentPages: number): number[] {
  const all = documentPages + edits.blankPages.length
  const base = edits.order ?? Array.from({ length: all }, (_, i) => i)
  return base.filter((i) => !edits.deleted.has(i))
}

/** PC `staticFormFills`: the saved set with the image edits' fills applied; undefined while the saved set is unknown. */
export function resultingStaticFormFills(
  edits: EditSnapshot,
  saved: readonly StaticFormFillRecord[] | undefined,
): StaticFormFillRecord[] | undefined {
  if (saved === undefined) return undefined
  const records = new Map(saved.map((record) => [record.id, record]))
  for (const edit of edits.imageEdits) {
    if (!edit.staticFill) continue
    if (edit.input.kind === 'deleteImage') {
      records.delete(edit.staticFill.id)
      continue
    }
    records.set(edit.staticFill.id, {
      ...edit.staticFill,
      pageIndex: edit.input.pageIndex,
      rect: edit.input.rect,
    })
  }
  return [...records.values()]
}

/**
 * The save request of `edits` over `model` (no path: the mobile engine saves bytes).
 * A protected session keeps the file's own /Encrypt entries (`protectionDirty: false`)
 * and opens the source with the password the document was opened with.
 */
export function buildSavePdfRequest(
  edits: EditSnapshot,
  model: Pick<PdfOpenedDocument, 'pages' | 'encrypted' | 'password'>,
  extras: PdfRequestExtras = {},
): SavePdfRequest {
  const staticFormFills = resultingStaticFormFills(edits, extras.savedStaticFormFills)
  return {
    path: '',
    markups: edits.markups.map(({ id: _id, ...rest }) => rest),
    ...(extras.annotationAuthor ? { annotationAuthor: extras.annotationAuthor } : {}),
    annotDeletes: edits.annotDeletes.map((d): AnnotDeleteInput => ({
      pageIndex: d.annot.pageIndex,
      objNum: d.annot.objNum,
      subtype: d.annot.type,
      rect: d.annot.rect,
      // A note thread's comments all share the root's rect; contents disambiguates
      ...(d.annot.type === 'note' ? { contents: d.annot.contents } : {}),
    })),
    noteEdits: edits.noteEdits.map((e): NoteEditInput => ({
      pageIndex: e.annot.pageIndex,
      objNum: e.annot.objNum,
      rect: e.annot.rect,
      oldContents: e.annot.contents,
      contents: e.contents,
    })),
    drawings: edits.drawings.map((d) => d.input),
    textEdits: edits.textEdits.map((e) => e.input),
    textInserts: edits.textInserts.map((insert) => insert.input),
    imageEdits: edits.imageEdits.map((e) => e.input),
    ...(staticFormFills !== undefined ? { staticFormFills } : {}),
    // watermark/header-footer stamps are not part of the mobile editor (spec 4)
    stamps: [],
    formValues: [...edits.formEdits.values()],
    formFields: edits.formFields.map((f) => f.input),
    blankPages: edits.blankPages.map((b) => b.input),
    formWidgetEdits: [...edits.formWidgetEdits.values()],
    rotations: [...edits.rotations].map(([pageIndex, delta]) => ({ pageIndex, delta })),
    deletedPages: [...edits.deleted],
    ...(edits.order ? { pageOrder: visiblePageList(edits, model.pages.length) } : {}),
    ...(edits.metadata ? { metadata: edits.metadata } : {}),
    // false = keep the file's own /Encrypt entries (the mobile editor never changes protection)
    protectionDirty: false,
    ...(model.encrypted ? { decryption: { userPassword: model.password ?? '' } } : {}),
  }
}

/** Thrown when a save would break a PC main-process rule (pdf-main.ts save handler). */
export class PdfAnnotationChoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfAnnotationChoiceError'
  }
}

/**
 * PC guards of annotation handling: flattening or stripping is a copy operation
 * (never an in-place save), and a protected document's copy keeps them (they would
 * run on output the save has already encrypted again).
 */
export function assertAnnotationChoice(input: {
  readonly inPlace: boolean
  readonly encrypted: boolean
  readonly annotations: PdfAnnotationChoice
}): void {
  if (input.annotations === 'keep') return
  if (input.inPlace) throw new PdfAnnotationChoiceError('pdf: annotation handling requires Save As')
  if (input.encrypted) {
    throw new PdfAnnotationChoiceError(
      'pdf: annotation handling needs a document without a password',
    )
  }
}

/** The name a saved copy is offered under: always ending in .pdf. */
export function pdfFileName(name: string): string {
  const trimmed = name.trim() || 'document'
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed.replace(/\.[^./\\]*$/, '')}.pdf`
}
