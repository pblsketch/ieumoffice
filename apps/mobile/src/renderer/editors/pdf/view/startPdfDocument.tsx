// The opened PDF as App holds it: the view-mode Workspace (EditorShell + document
// area) and sharing. Edit mode, saving and recovery copies come on top of this
// through `PdfDocumentOptions` (PDF-T4).
import './pdfView.css'
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Lang, Params } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { SearchMatch } from '../../../../../../pdf/src/renderer/search'
import { translateMobile, type MobileStringKey } from '../../../i18n/strings'
import { useKeepScreenOn } from '../../../home/keepScreenOn'
import { EditorShell, type EditorQuickActionItem } from '../../../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorWorkspaceProps } from '../../editorKind'
import { IconPdfGoToPage, IconPdfLock, IconPdfOutline, IconPdfSearch } from './icons'
import type { PdfOpenedDocument } from './model'
import { resolveDestPageIndex } from './outline'
import { PdfGoToPageSheet } from './PdfGoToPageSheet'
import { PdfOutlineSheet } from './PdfOutlineSheet'
import { PdfSearchBar } from './PdfSearchBar'
import {
  INITIAL_PDF_VIEW_STATE,
  PdfViewer,
  type PdfPageHits,
  type PdfPageOverlayContext,
  type PdfViewerHandle,
  type PdfViewState,
} from './PdfViewer'
import type { PdfReadOnlyReason } from './readOnly'

/** What the Workspace hands an extension (edit mode, features) on every render. */
export interface PdfWorkspaceContext {
  readonly model: PdfOpenedDocument
  readonly mode: DocumentMode
  /** App's permission and the document's own read-only judgment together. */
  readonly canEdit: boolean
  readonly lang: Lang
  readonly t: (key: MobileStringKey, params?: Params) => string
  /** The document area; null before it mounted. */
  readonly viewer: PdfViewerHandle | null
}

/** What an extension adds to the Workspace. Every field is optional. */
export interface PdfWorkspaceChrome {
  /** Edit toolbar buttons (App shows them in edit mode; 'undo'/'redo' go to the app bar). */
  readonly quickActions?: readonly EditorQuickActionItem[]
  /** Rows appended to the [⋯] sheet after search, outline and go to page. */
  readonly moreItems?: readonly EditorQuickActionItem[]
  /** Drawn inside the document stage above the pages (floating bars, sheets). */
  readonly stageExtras?: ReactNode
  /** Drawn inside each page box, over the bitmap, links and search hits. */
  readonly renderPageOverlay?: (page: PdfPageOverlayContext) => ReactNode
  /** Unsaved page rotations (clockwise degrees) by 0-based page. */
  readonly rotationDeltas?: ReadonlyMap<number, number>
  /** PDF.js annotation mode of the page bitmaps (see PdfPageCanvas). */
  readonly annotationMode?: number
}

export interface PdfDocumentOptions {
  /**
   * A hook called on every Workspace render (keep its identity stable per
   * document); it may use React state. Later tasks bring edit mode through it.
   */
  readonly useExtension?: (ctx: PdfWorkspaceContext) => PdfWorkspaceChrome
  /**
   * Where the zoom and position live while the Workspace is not mounted; pass the
   * same one to keep the view when the document is reloaded (after a save).
   */
  readonly keptView?: PdfKeptView
  /**
   * The document on screen when it can be replaced (a save reloads it). The Workspace
   * then stays mounted and swaps only the document area to the new model. The shell
   * and the sheets hold history entries of the app's back stack, which steps back
   * asynchronously on a close but pushes at once on an open; remounting them would
   * drop and re-arm those entries in one moment, the history would drift from the
   * stack, and [Done] could go back past the app's first entry.
   */
  readonly modelSource?: PdfModelSource
}

/** A replaceable document model (the edit session's). */
export interface PdfModelSource {
  getModel(): PdfOpenedDocument
  subscribeModel(listener: () => void): () => void
}

/** Zoom and position of a document, kept outside its Workspace. */
export interface PdfKeptView {
  get(): PdfViewState
  set(view: PdfViewState): void
}

const READ_ONLY_KEYS: Record<PdfReadOnlyReason, MobileStringKey> = {
  encrypted: 'pdfViewReadOnlyEncrypted',
  damaged: 'pdfViewReadOnlyDamaged',
  notWritable: 'pdfViewReadOnlyNotWritable',
}

const noExtension = (): PdfWorkspaceChrome => ({})

/** A key per document model, so the parts drawn from one model restart with the next. */
const modelKeys = new WeakMap<PdfOpenedDocument, number>()
let modelKeySeq = 0
function modelKey(model: PdfOpenedDocument): number {
  let key = modelKeys.get(model)
  if (key === undefined) {
    modelKeySeq += 1
    key = modelKeySeq
    modelKeys.set(model, key)
  }
  return key
}

const fixedSource = (model: PdfOpenedDocument): PdfModelSource => ({
  getModel: () => model,
  subscribeModel: () => () => {},
})

export function createKeptView(initial: PdfViewState = INITIAL_PDF_VIEW_STATE): PdfKeptView {
  let value = initial
  return {
    get: () => value,
    set: (next: PdfViewState) => {
      value = next
    },
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

/** Share: the file as it is on disk, or — for a document with no file yet — its bytes. */
export async function sharePdfOriginal(
  client: MobileClient,
  session: MobileDocSession,
  model: Pick<PdfOpenedDocument, 'isUntitled' | 'fromRecovery' | 'originalBytes'>,
): Promise<void> {
  if (model.isUntitled || model.fromRecovery) {
    await client.shareFile({
      sessionId: session.sessionId,
      suggestedName: session.name,
      mode: 'edited',
      bytesBase64: bytesToBase64(model.originalBytes),
    })
    return
  }
  await client.shareFile({
    sessionId: session.sessionId,
    suggestedName: session.name,
    mode: 'original',
  })
}

export function startPdfDocument(
  host: EditorHost,
  model: PdfOpenedDocument,
  options: PdfDocumentOptions = {},
): EditorDocument {
  const kept = options.keptView ?? createKeptView()
  const useExtension = options.useExtension ?? noExtension
  const source = options.modelSource ?? fixedSource(model)

  function PdfWorkspace({ frame, mode, canEdit, lang }: EditorWorkspaceProps) {
    useKeepScreenOn(host.client, mode === 'view')
    const model = useSyncExternalStore(source.subscribeModel, source.getModel)
    const t = useCallback(
      (key: MobileStringKey, params?: Params) => translateMobile(lang, key, params),
      [lang],
    )
    const viewerRef = useRef<PdfViewerHandle>(null)
    const [searchOpen, setSearchOpen] = useState(false)
    const [outlineOpen, setOutlineOpen] = useState(false)
    const [goToOpen, setGoToOpen] = useState(false)
    const [hits, setHits] = useState<Map<number, PdfPageHits> | null>(null)
    const [currentPage, setCurrentPage] = useState(0)
    // the view the document had when its viewer last unmounted (read per mount and per
    // model: the viewer of a reloaded document starts where the previous one was)
    const [startView, setStartView] = useState(kept.get)
    const [shownModel, setShownModel] = useState(model)
    if (shownModel !== model) {
      // a reloaded document: the search results and the search of the old one end
      setShownModel(model)
      setStartView(kept.get())
      setHits(null)
      setSearchOpen(false)
    }

    const effectiveCanEdit = canEdit && model.readOnlyReason === null
    const chrome = useExtension({
      model,
      mode,
      canEdit: effectiveCanEdit,
      lang,
      t,
      viewer: viewerRef.current,
    })

    const goToDest = useCallback(
      async (dest: unknown) => {
        const index = await resolveDestPageIndex(model.proxy, dest)
        if (index !== null) viewerRef.current?.scrollToPage(index)
      },
      [model],
    )
    const goToMatch = useCallback((match: SearchMatch) => {
      const rect = match.rects[0]
      if (rect) viewerRef.current?.scrollToPageRect(match.pageIndex, rect)
      else viewerRef.current?.scrollToPage(match.pageIndex)
    }, [])
    const onViewChange = useCallback((view: PdfViewState) => kept.set(view), [])
    const labels = useMemo(
      () => ({
        page: (pageNo: number) => t('pdfViewPageLabel', { page: pageNo }),
        brokenPage: t('pdfViewPageBroken'),
        internalLink: t('pdfViewInternalLink'),
      }),
      [t],
    )

    const moreItems = useMemo(
      (): EditorQuickActionItem[] => [
        {
          // no sheet and no history entry; focusing the field in the tap itself lets
          // the on-screen keyboard come up
          id: 'pdfSearch',
          label: t('pdfViewSearch'),
          icon: <IconPdfSearch size={19} />,
          onPress: () => setSearchOpen(true),
        },
        {
          id: 'pdfOutline',
          label: t('pdfViewOutline'),
          icon: <IconPdfOutline size={19} />,
          onPress: () => setOutlineOpen(true),
        },
        {
          id: 'pdfGoToPage',
          label: t('pdfViewGoToPage'),
          icon: <IconPdfGoToPage size={19} />,
          onPress: () => setGoToOpen(true),
        },
        ...(chrome.moreItems ?? []),
      ],
      [t, chrome.moreItems],
    )
    const fitToWidth = useCallback(() => viewerRef.current?.fitToWidth(), [])
    const viewTools = useMemo(
      (): EditorQuickActionItem[] => [
        { id: 'fitWidth', label: t('fitToWidth'), onPress: fitToWidth },
      ],
      [t, fitToWidth],
    )

    const pageCount = model.pages.length
    return (
      <EditorShell
        {...frame}
        canEdit={effectiveCanEdit}
        quickActions={chrome.quickActions ?? []}
        moreItems={moreItems}
        viewTools={viewTools}
        onFitToWidth={fitToWidth}
      >
        <div className="m-pdf-stage" data-testid="pdf-stage">
          {model.readOnlyReason !== null && (
            <div className="m-pdf-readonly" role="status" data-testid="pdf-readonly-reason">
              <IconPdfLock size={16} />
              <span>{t(READ_ONLY_KEYS[model.readOnlyReason])}</span>
            </div>
          )}
          {searchOpen && (
            <PdfSearchBar
              key={`search-${modelKey(model)}`}
              model={model}
              t={t}
              onHitsChange={setHits}
              onGoToMatch={goToMatch}
              onClose={() => setSearchOpen(false)}
            />
          )}
          <PdfViewer
            key={`viewer-${modelKey(model)}`}
            ref={viewerRef}
            model={model}
            initialView={startView}
            onViewChange={onViewChange}
            onCurrentPageChange={setCurrentPage}
            onGoToDest={(dest) => void goToDest(dest)}
            hits={hits ?? undefined}
            rotationDeltas={chrome.rotationDeltas}
            annotationMode={chrome.annotationMode}
            renderPageOverlay={chrome.renderPageOverlay}
            labels={labels}
          />
          {pageCount > 0 && (
            <button
              type="button"
              className="m-pdf-page-chip"
              onClick={() => setGoToOpen(true)}
              aria-label={t('pdfViewPageIndicator', { page: currentPage + 1, count: pageCount })}
              data-testid="pdf-page-chip"
            >
              {currentPage + 1} / {pageCount}
            </button>
          )}
          {chrome.stageExtras}
        </div>
        <PdfOutlineSheet
          open={outlineOpen}
          model={model}
          t={t}
          onGoToDest={(dest) => void goToDest(dest)}
          onClose={() => setOutlineOpen(false)}
        />
        <PdfGoToPageSheet
          open={goToOpen}
          pageCount={pageCount}
          currentPage={currentPage}
          t={t}
          onGo={(index) => viewerRef.current?.scrollToPage(index)}
          onClose={() => setGoToOpen(false)}
        />
      </EditorShell>
    )
  }

  return {
    async share(doc) {
      await sharePdfOriginal(host.client, doc.session, source.getModel()).catch(() => {})
    },
    Workspace: PdfWorkspace,
  }
}
