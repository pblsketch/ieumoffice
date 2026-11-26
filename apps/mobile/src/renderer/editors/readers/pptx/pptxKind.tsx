/**
 * The PowerPoint reader kind (track T5): read-only, no AI. The engine, Konva, the PC slide
 * drawing code and the Workspace are not imported here: `start()` loads the document module
 * and the Workspace with dynamic imports, so the app's first chunk only gains this file and
 * the opening placeholder.
 *
 * Opening order (like the HWP kind): `open()` only reads the bytes through the bridge; the
 * deck is opened inside the document after the session switch, and the Workspace shows the
 * refusal (toast, then back) when the engine does not take the file.
 */
import { lazy, Suspense, type ComponentType } from 'react'
import { isMobileCommandError, type MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { EditorShell } from '../../../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorKind, EditorWorkspaceProps } from '../../editorKind'
import type { PptxController } from './pptxDocument'
import { PptxOpening, PPTX_OPENING_DELAY_MS } from './PptxOpening'

export interface PptxKindOptions {
  /** Wait before a changed slide is saved as the reading position (default 1 s). */
  readonly positionDelayMs?: number
  /** Opening that takes longer than this shows the placeholder (default 300 ms). */
  readonly openingDelayMs?: number
}

export function createPptxEditorKind(options: PptxKindOptions = {}): EditorKind {
  return {
    id: 'pptx',
    formats: ['pptx'],
    openExtensions: ['pptx'],
    labelKey: 'readersPptxKindLabel',
    editable: false,
    hasAi: false,
    recoveryFormat: (format) => format,
    async open({ session, client }) {
      let base64: string | null = (await client.readFileBytes(session.sessionId)).bytesBase64
      return {
        noticeKey: null,
        start(host) {
          const taken = base64
          base64 = null
          return startPptxDocument(host, session, taken, options)
        },
        discard() {
          base64 = null
        },
      }
    },
  }
}

export const pptxEditorKind: EditorKind = createPptxEditorKind()

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function startPptxDocument(
  host: EditorHost,
  session: MobileDocSession,
  base64: string | null,
  options: PptxKindOptions,
): EditorDocument {
  const openingDelayMs = options.openingDelayMs ?? PPTX_OPENING_DELAY_MS
  const startedAt = now()
  let pending: string | null = base64
  let disposed = false
  let controller: PptxController | null = null

  const controllerReady: Promise<PptxController> = import('./pptxDocument').then((mod) => {
    const created = mod.createPptxController({
      client: host.client,
      docKey: session.docKey,
      // closed before the module arrived: open nothing
      base64: disposed ? null : pending,
      positionDelayMs: options.positionDelayMs,
    })
    pending = null
    controller = created
    if (disposed) created.dispose()
    return created
  })

  // One lazy component per document: once loaded, a Workspace that mounts again renders at once.
  const LoadedWorkspace = lazy(async () => {
    const [ready, mod] = await Promise.all([controllerReady, import('./PptxWorkspace')])
    const Bound: ComponentType<EditorWorkspaceProps> = (props) => (
      <mod.PptxWorkspace
        {...props}
        controller={ready}
        host={host}
        openingDelayMs={openingDelayMs}
      />
    )
    return { default: Bound }
  })

  function PptxWorkspaceHost(props: EditorWorkspaceProps) {
    return (
      <Suspense
        fallback={
          <EditorShell {...props.frame} quickActions={[]} onFitToWidth={() => {}}>
            <PptxOpening lang={props.lang} since={startedAt} delayMs={openingDelayMs} />
          </EditorShell>
        }
      >
        <LoadedWorkspace {...props} />
      </Suspense>
    )
  }

  return {
    editable: false,
    aiAvailable: false,
    async share(doc) {
      try {
        await host.client.shareFile({
          sessionId: doc.session.sessionId,
          suggestedName: doc.session.name,
          mode: 'original',
        })
      } catch (err) {
        // A cancelled share sheet is not an error; any other failure leaves the reader as it is
        if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
        console.warn('pptx share failed', err)
      }
    },
    Workspace: PptxWorkspaceHost,
    dispose() {
      if (disposed) return
      disposed = true
      pending = null
      controller?.dispose()
    },
  }
}
