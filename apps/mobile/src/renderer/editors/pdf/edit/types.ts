// Types of the mobile PDF edit frame and of the feature slots (PDF-T4).
//
// The seven feature tasks (annot, draw, sign, form, text, pages, link) fill only
// their own `editors/pdf/features/<id>/index.ts`; everything a feature may do goes
// through the context and services below.
import type { ReactNode } from 'react'
import type { Lang, Params } from '@genoffice/i18n'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { EditSnapshot } from '../../../../../../pdf/src/renderer/edit-state'
import type { Op, OpContext, PlanResult } from '../../../../../../pdf/src/renderer/edit-ops'
import type { StaticFormFillRecord } from '../../../../../../pdf/src/shared/ipc'
import type { ToastRequest } from '../../../components/Toast'
import type { MobileStringKey } from '../../../i18n/strings'
import type { EditorQuickActionItem } from '../../../shell/EditorShell'
import type { PdfEngine } from '../engine'
import type { PageGeom, PdfOpenedDocument, PdfPageOverlayContext, PdfViewerHandle } from '../view'

export type { EditSnapshot, Op, OpContext, PlanResult, StaticFormFillRecord }

/** The feature slots, one folder each under editors/pdf/features/. */
export type PdfFeatureId = 'annot' | 'draw' | 'sign' | 'form' | 'text' | 'pages' | 'link'

/** The four buttons of the floating edit bar (design system 5.6), in bar order. */
export type PdfToolId = 'pen' | 'highlighter' | 'textbox' | 'sign'

/** Bar button → the feature that answers it. */
export const PDF_TOOL_FEATURES: Readonly<Record<PdfToolId, PdfFeatureId>> = {
  pen: 'draw',
  highlighter: 'annot',
  textbox: 'text',
  sign: 'sign',
}

/** [⋯] entries the frame owns, in sheet order → the feature that answers them. */
export const PDF_MORE_FEATURES = ['pages', 'link'] as const
export type PdfMoreFeatureId = (typeof PDF_MORE_FEATURES)[number]

/** Annotation handling of a Save As copy (PC `SavePdfRequest.annotations`). */
export type PdfAnnotationChoice = 'keep' | 'flatten' | 'strip'

/** A signature field to sign into (the PC FormWidget fields `signatureDrawingForField` reads). */
export interface PdfSignatureTarget {
  /** 0-based original page index. */
  readonly pageIndex: number
  /** The widget rectangle, PDF user space [x1, y1, x2, y2]. */
  readonly rect: [number, number, number, number]
  /** AcroForm field name (written as `formFieldName` of the placed drawing). */
  readonly fieldName: string
}

export type PdfSignatureHandler = (target: PdfSignatureTarget) => void | Promise<void>

/** Request parts that are not pending edits; features set them (PC App state of the same name). */
export interface PdfRequestExtras {
  /** /T of new markups and drawings (spec 3.4); omitted → the PC default. */
  readonly annotationAuthor?: string
  /**
   * The static form fills already in the file (PC `savedStaticFormFills`). Once known,
   * every request carries the complete resulting set like the PC; unknown → omitted,
   * which keeps the file's own set (the form feature sets this before adding marks).
   */
  readonly savedStaticFormFills?: readonly StaticFormFillRecord[]
}

/** Op-context parts only a feature knows (the form catalog), merged into every plan. */
export type PdfOpContextProvider = () => Pick<OpContext, 'fieldNames' | 'radioGroups'>

export interface PdfDispatchOptions {
  /** Repeats with the same key fold into one undo step (PC `pushUndo(coalesceKey)`). */
  readonly coalesceKey?: string
}

/** What the frame lends every feature, also outside rendering (async work). */
export interface PdfEditServices {
  /** The PC op registry write path: validated as a batch, one undo step, marks the document unsaved. */
  dispatch(ops: Op[], options?: PdfDispatchOptions): PlanResult
  /** The pending edits right now. */
  getEdits(): EditSnapshot
  /** The open document right now (it is replaced after a save or `reopenFromBytes`). */
  getModel(): PdfOpenedDocument
  getSession(): MobileDocSession
  /** Writes the pending edits to the file (Save As for an untitled document); true when saved or nothing to save. */
  saveNow(): Promise<boolean>
  /** The file was already rewritten with `bytes`: reload this session from them, edits and undo cleared. */
  reopenFromBytes(bytes: Uint8Array): Promise<void>
  /** Writes bytes over the open file in place (never Save As); false when the write failed (a toast already said why). */
  writeFileBytes(bytes: Uint8Array): Promise<boolean>
  /** Asks the sign feature to sign into a signature field; a toast until it registered. */
  requestSignature(target: PdfSignatureTarget): Promise<void>
  /** The sign feature registers here; returns the unregister call. */
  registerSignatureHandler(handler: PdfSignatureHandler): () => void
  /** The system picker for one PDF (web view file input, never the app's document open); null when cancelled. */
  pickPdfFile(): Promise<Uint8Array | null>
  /** The PDF engine worker (PDF-T1). */
  engine(): PdfEngine
  setRequestExtras(patch: Partial<PdfRequestExtras>): void
  registerOpContext(provider: PdfOpContextProvider): () => void
  /** An id in the PC format for additive ops. */
  newId(): string
  showToast(input: ToastRequest | string): void
  translate(key: MobileStringKey, params?: Params): string
}

/** What a feature hook receives on every Workspace render. */
export interface PdfFeatureContext {
  readonly feature: PdfFeatureId
  readonly model: PdfOpenedDocument
  readonly mode: DocumentMode
  /** App's permission and the document's own read-only judgment together. */
  readonly canEdit: boolean
  /** Edit mode on an editable document: only then may the feature change anything. */
  readonly editing: boolean
  readonly lang: Lang
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly viewer: PdfViewerHandle | null
  /** The pending edits; the Workspace re-renders when they change. */
  readonly edits: EditSnapshot
  /** The bar tool that is on, if any. */
  readonly activeTool: PdfToolId | null
  /** This feature's bar tool is the one that is on. */
  readonly toolActive: boolean
  setActiveTool(tool: PdfToolId | null): void
  /** The page's geometry with its pending rotation (PC `PageGeom`, for pdfRectToCss/viewToPdf/pdfToView). */
  pageGeom(pageIndex: number): PageGeom
  readonly services: PdfEditServices
}

/** One page as a feature overlay sees it (mounted inside the page box, page CSS px). */
export type PdfFeaturePage = PdfPageOverlayContext

/** What a feature adds to the Workspace. Every field is optional. */
export interface PdfFeatureChrome {
  /** Its bar button was pressed; `active` is whether its tool is now on (the frame toggles it). */
  readonly onToolPress?: (active: boolean) => void
  /** Its More-sheet entry was pressed (pages: Organize pages, link: Insert link). */
  readonly onMorePress?: () => void
  /** Extra [⋯] rows, after the frame's own. */
  readonly moreItems?: readonly EditorQuickActionItem[]
  /** Drawn in the document stage above the pages: sheets (`Sheet`), floating bars. */
  readonly stageExtras?: ReactNode
  /** Drawn inside each page box above the bitmap, links and search hits. */
  readonly renderPageOverlay?: (page: PdfFeaturePage) => ReactNode
  /** PDF.js annotation mode of the page bitmaps (form: `AnnotationMode.ENABLE_FORMS`). */
  readonly annotationMode?: number
}

/** A feature slot. `useFeature` is a React hook called on every Workspace render. */
export interface PdfFeature {
  readonly id: PdfFeatureId
  readonly useFeature?: (ctx: PdfFeatureContext) => PdfFeatureChrome
}
