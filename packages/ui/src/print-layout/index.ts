// Shared advanced print parts (decision 0141 + print upgrade). Renderer code;
// the only layout entry it reads is the renderer-safe `@genoffice/print-layout/plan`.
export {
  coupleDuplex,
  createDuplexCoupling,
  effectiveCollate,
  forcedDuplex,
  isCollateLocked,
  labelCellsOf,
  labelPresetText,
  layoutSchematic,
  normalizePanelOptions,
  parsePrintRanges,
  printLayoutIssueText,
  printLayoutProblem,
  PRINT_LAYOUT_SCHEMATIC_FACES,
  setDuplexByUser,
  showsLayoutSchematic,
  showsLivePrintPreview,
  takesNewPrintRoute,
  type DuplexCoupling,
  type PrintLayoutCapabilities,
  type PrintLayoutDuplex,
  type PrintLayoutProgress,
  type PrintPageRange,
  type SchematicCell,
  type SchematicFace,
  type SchematicView,
} from './model'
export {
  DEFAULT_PRINTER,
  destinationKindOf,
  SAVE_IMAGES_DEST,
  SAVE_PDF_DEST,
  SYSTEM_DIALOG,
  useArrangedPreview,
  useDuplexCoupling,
  usePrintJob,
  usePrintLayoutOptions,
  type ArrangedPreviewState,
  type PrintDestinationKind,
  type PrintJobSelection,
  type PrintJobState,
  type PrintLayoutPreviewRequest,
  type PrintPrinterInfo,
  type UsePrintJobConfig,
} from './hooks'
export { buildOverlayBundle, type OverlayBundle, type OverlayPlacement } from './overlay-render'
export { PrintJobFields, type PrintJobFieldsProps } from './PrintJobFields'
export {
  LivePrintPreview,
  type LivePreviewBatchResult,
  type LivePreviewFaceFetcher,
  type LivePreviewFaceResult,
  type LivePrintPreviewProps,
} from './LivePrintPreview'
export {
  PrintLayoutPanel,
  type PrintLabelSpecStore,
  type PrintLayoutJob,
  type PrintLayoutPanelProps,
} from './PrintLayoutPanel'
export { PrintLayoutSchematic, type PrintLayoutSchematicProps } from './PrintLayoutSchematic'
export {
  ArrangedPreview,
  PrintLayoutProgressLine,
  type ArrangedPreviewProps,
} from './ArrangedPreview'
export {
  SimplePrintDialog,
  type SimplePrintDialogProps,
  type SimplePrintPreviewFacesRequest,
  type SimplePrintRange,
  type SimplePrintRangeChoice,
} from './SimplePrintDialog'
export {
  defaultPrinterLabel,
  QUICK_PRINT_CONFIRM_THRESHOLD,
  QuickPrintButton,
  useQuickPrintPref,
  type QuickPrintButtonProps,
  type QuickPrintPrefStore,
} from './QuickPrintButton'
