// The opened PDF as App holds it once editing is possible: the viewer Workspace
// with the edit frame on top, and save / Save As / share / recovery copies from the
// edit session. A save reloads the document from the written bytes; the Workspace
// then shows the new document model in place of the old one, at the same position,
// without remounting the shell or the sheets (they hold back-stack entries).
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { EditorDocument, EditorHost } from '../../editorKind'
import { createPdfAiRun, type PdfAiEnv } from '../ai/createAiRun'
import type { PdfUnlockProbe } from '../openTypes'
import {
  createKeptView,
  startPdfDocument,
  type PdfOpenedDocument,
  type PdfViewerHandle,
  type PdfWorkspaceChrome,
  type PdfWorkspaceContext,
} from '../view'
import { noteMoreSheetBack } from '../view/moreSheetBack'
import { createPdfEditSession, type PdfEditSession } from './editSession'
import type { PdfFeatureSet } from './features'
import { createPdfEditExtension } from './usePdfEditChrome'
import type { PdfEngine } from '../engine'

export interface PdfEditDocumentOptions {
  readonly session: MobileDocSession
  readonly unlockProbe: PdfUnlockProbe
  /** The document model was replaced (the kind frees the old one on the next open). */
  readonly onModelReplaced?: (next: PdfOpenedDocument, previous: PdfOpenedDocument) => void
  /** Feature slots; default the registry (tests pass their own). */
  readonly features?: PdfFeatureSet
  /** Clock of the recovery-copy rules (tests). */
  readonly now?: () => number
  readonly engine?: () => PdfEngine
  /** The AI's check/cross painter (tests: jsdom has no canvas); default the PC painter. */
  readonly aiMarkPainter?: PdfAiEnv['paintMark']
}

/** The document App holds, plus its edit session (tests and later tasks reach it here). */
export interface PdfEditDocument extends EditorDocument {
  readonly editSession: PdfEditSession
}

export function startPdfEditDocument(
  host: EditorHost,
  model: PdfOpenedDocument,
  options: PdfEditDocumentOptions,
): PdfEditDocument {
  const editSession = createPdfEditSession({
    host,
    model,
    session: options.session,
    unlockProbe: options.unlockProbe,
    now: options.now,
    engine: options.engine,
    onModelReplaced: options.onModelReplaced,
  })
  const editExtension = createPdfEditExtension(editSession, options.features)
  // the AI tools scroll the viewer of the mounted Workspace (goto_page and after an edit)
  let viewerHandle: PdfViewerHandle | null = null
  const useExtension = (ctx: PdfWorkspaceContext): PdfWorkspaceChrome => {
    if (ctx.viewer) viewerHandle = ctx.viewer
    return editExtension(ctx)
  }
  const keptView = createKeptView()
  // one viewer Workspace for every model of the session: a save swaps the document
  // inside it (one Workspace per model remounted the shell and its back layers)
  const viewer = startPdfDocument(host, model, {
    useExtension,
    keptView,
    modelSource: editSession,
  })

  return {
    editSession,
    save: (doc, forceSaveAs) => {
      // Save As comes from the More sheet's row: note its back step now, while the sheet
      // is still in the page, so the annotation question opens after it (moreSheetBack.ts)
      if (forceSaveAs) noteMoreSheetBack()
      return editSession.save(doc, forceSaveAs)
    },
    share: (doc) => editSession.share(doc),
    writeRecovery: (doc) => editSession.writeRecovery(doc),
    // the AI tools and their strings load only when the AI runs (AI is off by default)
    createAiRun: (ctx) =>
      createPdfAiRun(
        {
          host,
          editSession,
          viewer: () => viewerHandle,
          keptView,
          paintMark: options.aiMarkPainter,
        },
        ctx,
      ),
    Workspace: viewer.Workspace,
  }
}
