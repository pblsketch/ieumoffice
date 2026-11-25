// The opened PDF as App holds it once editing is possible: the viewer Workspace
// with the edit frame on top, and save / Save As / share / recovery copies from the
// edit session. A save reloads the document from the written bytes; the Workspace
// then shows the new document model in place of the old one, at the same position.
import { useSyncExternalStore } from 'react'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { EditorDocument, EditorHost, EditorWorkspaceProps } from '../../editorKind'
import type { PdfUnlockProbe } from '../openTypes'
import { createKeptView, startPdfDocument, type PdfOpenedDocument } from '../view'
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
  const useExtension = createPdfEditExtension(editSession, options.features)
  const keptView = createKeptView()
  // one viewer document per model; the model changes only after a save or a reload
  const viewers = new WeakMap<PdfOpenedDocument, EditorDocument>()
  const viewerFor = (current: PdfOpenedDocument): EditorDocument => {
    let viewer = viewers.get(current)
    if (!viewer) {
      viewer = startPdfDocument(host, current, { useExtension, keptView })
      viewers.set(current, viewer)
    }
    return viewer
  }

  function PdfEditWorkspace(props: EditorWorkspaceProps) {
    const current = useSyncExternalStore(editSession.subscribeModel, editSession.getModel)
    const ViewerWorkspace = viewerFor(current).Workspace
    return <ViewerWorkspace {...props} />
  }

  return {
    editSession,
    save: (doc, forceSaveAs) => editSession.save(doc, forceSaveAs),
    share: (doc) => editSession.share(doc),
    writeRecovery: (doc) => editSession.writeRecovery(doc),
    Workspace: PdfEditWorkspace,
  }
}
