// The EPUB editor kind (read-only, no AI). Opening follows the HWP order: open() only reads the
// bytes; the engine opens the book inside the document after the switch, and a refusal is shown
// by the reading screen (toast, back home). The reading screen, the adapter and the engine are
// loaded on first use (dynamic import), so the app-start bundle carries only this file.
import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { translateMobile } from '../../../i18n'
import { EditorShell } from '../../../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorKind, EditorWorkspaceProps } from '../../editorKind'
import { EpubOpening } from './EpubOpening'
import type { EpubReader } from './epubReader'
import './epubReader.css'

const loadReadingScreen = () => import('./EpubWorkspace')

const noop = () => {}

function base64ToBytes(base64: string): Uint8Array {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

export const epubEditorKind: EditorKind = {
  id: 'epub',
  formats: ['epub'],
  openExtensions: ['epub'],
  labelKey: 'readersEpubKindLabel',
  editable: false,
  hasAi: false,
  recoveryFormat: (format) => format,
  async open({ session, client }) {
    const read = await client.readFileBytes(session.sessionId)
    let bytes: Uint8Array | null = base64ToBytes(read.bytesBase64)
    return {
      noticeKey: null,
      start: (host) => {
        const taken = bytes ?? new Uint8Array()
        bytes = null
        return startEpubDocument(host, session, taken)
      },
      discard: () => {
        bytes = null
      },
    }
  },
}

/** The placeholder screen: the shell with the opening placeholder, no tools. */
function OpeningScreen({
  props,
  since,
}: {
  readonly props: EditorWorkspaceProps
  readonly since: number
}) {
  return (
    <EditorShell {...props.frame} quickActions={[]} viewTools={[]} onFitToWidth={noop}>
      <EpubOpening since={since} label={translateMobile(props.lang, 'readersOpening')} />
    </EditorShell>
  )
}

function startEpubDocument(
  host: EditorHost,
  session: MobileDocSession,
  bytes: Uint8Array,
): EditorDocument {
  const startedAt = Date.now()
  let reader: EpubReader | null = null
  let disposed = false

  const loaded = loadReadingScreen().then(
    (screen) => {
      const created = screen.createEpubReader({ client: host.client, session, bytes, host })
      if (disposed) created.dispose()
      else reader = created
      return { screen, reader: created }
    },
    () => null,
  )

  /** Shown when the reading screen's code could not be loaded: the book cannot be opened. */
  function LoadFailed({ frame }: EditorWorkspaceProps) {
    useEffect(() => {
      host.showToast(host.translate('readersErrEpubDamaged'))
      frame.onBack()
      // once per mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  }

  const ReadingScreen = lazy(
    async (): Promise<{ default: ComponentType<EditorWorkspaceProps> }> => {
      const ready = await loaded
      if (!ready) return { default: LoadFailed }
      const { screen, reader: bound } = ready
      function BoundWorkspace(props: EditorWorkspaceProps) {
        return <screen.EpubWorkspace {...props} reader={bound} since={startedAt} />
      }
      return { default: BoundWorkspace }
    },
  )

  function EpubDocumentWorkspace(props: EditorWorkspaceProps) {
    return (
      <Suspense fallback={<OpeningScreen props={props} since={startedAt} />}>
        <ReadingScreen {...props} />
      </Suspense>
    )
  }

  return {
    async share(doc) {
      await host.client
        .shareFile({
          sessionId: doc.session.sessionId,
          suggestedName: doc.session.name,
          mode: 'original',
        })
        .catch(() => {})
    },
    exportPdfScope: 'chapter',
    async exportPdf(doc) {
      const ready = await loaded
      const activeReader = ready?.reader ?? reader
      if (!activeReader) return null
      await activeReader.ready
      if (activeReader.getState().status !== 'ready') return null

      let html = activeReader.shown?.view.html ?? null
      let tempRelease: (() => void) | null = null
      if (!html) {
        const chapter = await activeReader.loadChapter(activeReader.place.spineIndex, () => '')
        if (!chapter) return null
        html = chapter.view.html
        tempRelease = () => chapter.view.release()
      }
      try {
        const { renderHtmlToPdfBytes } = await import('../../shared/pdfExport')
        const chapterTitle = activeReader.chapterName(activeReader.place.spineIndex)
        const result = await renderHtmlToPdfBytes(html, { title: chapterTitle })
        const stem = doc.session.name.replace(/\.epub$/i, '')
        const fileName = `${stem}-${chapterTitle}.pdf`
        return {
          kind: 'bytes',
          bytes: result.bytes,
          fileName,
          ...(result.missingGlyphs > 0 ? { noticeKey: 'homePdfMissingGlyphs' as const } : {}),
        }
      } finally {
        tempRelease?.()
      }
    },
    Workspace: EpubDocumentWorkspace,
    editable: false,
    aiAvailable: false,
    dispose() {
      disposed = true
      reader?.dispose()
      reader = null
    },
  }
}
