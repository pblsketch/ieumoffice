// Entry of the PDF edit frame (PDF-T4), loaded with the viewer chunk on the first PDF open.
// Feature slots import their types and helpers from here.
export { Sheet } from '../../../components/Sheet'
export { getPdfEngine, type PdfEngine } from '../engine'
export {
  createPdfEditSession,
  type PdfAnnotationPrompt,
  type PdfEditSession,
  type PdfEditSessionOptions,
} from './editSession'
export {
  createPdfEditStore,
  emptyEditSnapshot,
  newEditId,
  PDF_UNDO_LIMIT,
  snapshotHasEdits,
  type PdfEditStore,
} from './editStore'
export {
  PDF_FEATURE_ORDER,
  PDF_FEATURES,
  usePdfFeatureChromes,
  type PdfFeatureSet,
} from './features'
export { pickPdfFile } from './pickPdfFile'
export { createRecoveryGate, type RecoveryGate } from './recoveryGate'
export {
  assertAnnotationChoice,
  buildSavePdfRequest,
  PdfAnnotationChoiceError,
  pdfFileName,
  resultingStaticFormFills,
  visiblePageList,
} from './saveRequest'
export {
  startPdfEditDocument,
  type PdfEditDocument,
  type PdfEditDocumentOptions,
} from './startPdfEditDocument'
export { createPdfEditExtension } from './usePdfEditChrome'
export * from './types'
