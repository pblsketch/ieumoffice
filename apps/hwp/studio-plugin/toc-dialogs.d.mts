/** Type surface for studio-plugin/toc-dialogs.mjs (plain JS, bundled by Vite). */

export declare const TOC_CREATE_COMMAND: 'ext:ieum-toc-create'
export declare const TOC_REFRESH_COMMAND: 'ext:ieum-toc-refresh'
export declare const INDEX_MARK_COMMAND: 'ext:ieum-index-mark'
export declare const INDEX_CREATE_COMMAND: 'ext:ieum-index-create'
export declare const INDEX_REFRESH_COMMAND: 'ext:ieum-index-refresh'
export declare const TOC_REFRESH_CONTEXT_COMMAND: 'ext:ieum-toc-refresh-context'
export declare const INDEX_REFRESH_CONTEXT_COMMAND: 'ext:ieum-index-refresh-context'
export declare const TOC_DIALOG_STYLE_ID: 'ieum-toc-dialog-styles'

export interface TocIndexMenuItem {
  readonly id: string
  readonly labelKey: keyof TocIndexDialogLabels
  readonly opensDialog: boolean
}

export declare const TOC_INDEX_MENU_ITEMS: readonly TocIndexMenuItem[]

export interface TocIndexDialogLabels {
  tocMenuCreate: string
  tocMenuRefresh: string
  indexMenuMark: string
  indexMenuCreate: string
  indexMenuRefresh: string
  tocDialogCancel: string
  tocDialogClose: string
  tocLayoutLabel: string
  tocLayoutDottedTab: string
  tocLayoutTable: string
  tocCreateTitle: string
  tocCreateConfirm: string
  tocKindLabel: string
  tocKindBody: string
  tocKindTable: string
  tocKindFigure: string
  tocKindEquation: string
  tocTitleLabel: string
  tocTitlePlaceholder: string
  tocDefaultTitleBody: string
  tocDefaultTitleTable: string
  tocDefaultTitleFigure: string
  tocDefaultTitleEquation: string
  tocMaxLevelLabel: string
  tocLevelOption: string
  tocLinksLabel: string
  tocLegacyConfirmTitle: string
  tocLegacyConfirmMessage: string
  tocLegacyConfirmHint: string
  tocLegacyReplaceConfirm: string
  tocExistsConfirmTitle: string
  tocExistsConfirmMessage: string
  manualEditConfirmTitle: string
  manualEditConfirmMessage: string
  manualEditOverwriteConfirm: string
  manualEditBeforeLabel: string
  manualEditAfterLabel: string
  manualEditMoreLines: string
  tocCreatedToast: string
  tocRefreshedToast: string
  tocObjectCaptionsUnavailable: string
  tocRefreshNotFound: string
  tocErrorInTable: string
  tocErrorUnsupportedPlace: string
  tocErrorHasObjects: string
  tocErrorMultiSection: string
  tocErrorNoHeadings: string
  tocErrorNoCaptions: string
  tocErrorGeneric: string
  indexMarkTitle: string
  indexMarkConfirm: string
  indexMarkTermLabel: string
  indexMarkTermPlaceholder: string
  indexMarkSubTermLabel: string
  indexMarkSubTermPlaceholder: string
  indexMarkAllLabel: string
  indexMarkAllPreviewTitle: string
  indexMarkAllPreviewMessage: string
  indexMarkAllPreviewParticlesNote: string
  indexMarkAllPreviewSkippedNote: string
  indexMarkAllPreviewConfirm: string
  indexMarkAllPreviewMore: string
  indexMarksListTitle: string
  indexMarksListEmpty: string
  indexMarkPageBadge: string
  indexMarkDeleteBtn: string
  indexMarkErrorEmpty: string
  indexMarkErrorUnsupportedPlace: string
  indexMarkAddedToast: string
  indexMarkAllAddedToast: string
  indexMarkAllSkippedToast: string
  indexMarkAllNotFound: string
  indexMarkRemovedToast: string
  indexCreateTitle: string
  indexCreateConfirm: string
  indexTitleLabel: string
  indexTitlePlaceholder: string
  indexDefaultTitle: string
  indexColumnsLabel: string
  indexColumnsOption: string
  indexGroupHeadingsLabel: string
  indexPageSplitConfirmTitle: string
  indexPageSplitConfirmMessage: string
  indexPageSplitConfirmAction: string
  indexCreatedToast: string
  indexRefreshedToast: string
  indexRefreshNotFound: string
  indexErrorNoMarks: string
  indexErrorInTable: string
  indexErrorUnsupportedPlace: string
  indexErrorHasObjects: string
  indexErrorAlreadyExists: string
  indexErrorGeneric: string
}

export interface TocIndexCaretPosition {
  sec?: number
  sectionIndex?: number
  para?: number
  paraIndex?: number
  paragraphIndex?: number
  parentParaIndex?: number
  offset?: number
  charOffset?: number
  charPos?: number
  inTable?: boolean
  cellPath?: unknown[]
  inHeaderFooter?: boolean
  isHeader?: boolean
  isFooter?: boolean
  inNote?: boolean
  inFootnote?: boolean
  inEndnote?: boolean
  isTextBox?: boolean
  inTextBox?: boolean
}

export interface TocIndexDialogOptions {
  /** Override studio `ModalDialog` base class (defaults to `getStudioModalParts().ModalDialog`). */
  ModalDialog?: new (title: string, width: number, closeOnOverlayClick?: boolean) => unknown
  /** Override studio toast sink (defaults to `getStudioModalParts().showToast`). */
  showToast?: (options: { message: string; durationMs?: number }) => void
  /**
   * Run a document edit inside one undo step.
   * When `fn(doc)` returns a non-ok refusal, `toc-dialogs.mjs` throws an internal abort
   * sentinel inside `fn` so the transaction rolls back with zero undo entry.
   */
  runEdit?: <T>(action: string, fn: (doc: unknown) => T) => T
  readDoc?: <T>(fn: (doc: unknown) => T) => T
  getCaret?: () => TocIndexCaretPosition | null
  getSelectionText?: () => { text: string } | null
  highlightRange?: (range: { sec: number; startPara: number; endPara: number }) => boolean
  tocHelpers?: Record<string, unknown>
  getMadeContents?: () => readonly (readonly string[])[]
  appStyleMap?: Record<string, number> | (() => Record<string, number> | undefined)
  onEdited?: (action: string, result: unknown) => void
  place?: TocIndexCaretPosition
  initialKind?: 'body' | 'table' | 'figure' | 'equation'
  kind?: 'body' | 'table' | 'figure' | 'equation'
  selectedText?: string
  document?: Document
}

export interface TocIndexDialogHost {
  read?: <T>(fn: (doc: unknown) => T) => T
  transaction?: <T>(label: string, fn: (tx: { doc(): unknown }) => T) => T
  getCaret?: () => TocIndexCaretPosition | null
  getSelectionText?: () => { text: string } | null
  selectTextRange?: (range: {
    section: number
    paragraph: number
    charOffset: number
    length: number
  }) => boolean
  automation?: {
    registerCommand?: (def: {
      id: string
      label: string
      opensDialog?: boolean
      canExecute?: (ctx: { hasDocument?: boolean; isFormMode?: boolean }) => boolean
      execute: () => void
    }) => void
    unregisterCommand?: (id: string) => void
    addMenuItem?: (item: { menuId: string; commandId: string; position?: string }) => void
    execute?: (id: string, params?: Record<string, unknown>) => unknown
  }
}

export declare function installTocDialogStyles(doc?: Document): boolean
export declare function isCaretInTocRange(
  doc: unknown,
  pos: TocIndexCaretPosition | null | undefined,
): 'body' | 'table' | 'figure' | 'equation' | null
export declare function isCaretInIndexRange(
  doc: unknown,
  pos: TocIndexCaretPosition | null | undefined,
): boolean
export declare function openConfirmActionDialog(
  config: {
    title: string
    message: string
    hint?: string
    hints?: readonly string[]
    confirmLabel?: string
    cancelLabel?: string
    beforeLabel?: string
    afterLabel?: string
    moreLinesText?: string
    modifiedLines?: Array<{ expected?: string | null; actual?: string | null }>
    previewItems?: Array<{ matchedText?: string; context?: string; pageLabel?: string }>
    moreItemsText?: string
    width?: number
    onConfirm?: () => void
    onCancel?: () => void
  },
  options?: TocIndexDialogOptions,
): unknown | null
export declare function openCreateTocDialog(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): unknown | null
export declare function runRefreshTocDialog(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): Record<string, unknown>
export declare function openMarkIndexDialog(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): unknown | null
export declare function openCreateIndexDialog(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): unknown | null
export declare function runRefreshIndexDialog(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): Record<string, unknown>
export declare function installTocIndexMenu(
  host: TocIndexDialogHost,
  labels: TocIndexDialogLabels,
  options?: TocIndexDialogOptions,
): { ok: boolean }
