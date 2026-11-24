import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  createFlowEditor,
  type FlowEditDocument,
  type FlowEditor,
  type FlowFormatAction,
  type FlowMemo,
  type FlowPicture,
} from './flowEditing'
import { buildFlowDocument, buildFlowHtml } from './hwpFlow'
import type { FlowEngineDocument } from './rhwpEngine'

export interface HwpFlowViewHandle {
  runFormat(action: FlowFormatAction): void
  /** Puts a picture in line at the caret; false when there is no caret in text. */
  insertPicture(picture: FlowPicture): boolean
  memos(): FlowMemo[]
  addMemo(text: string, author: string): boolean
  replyMemo(parentId: number, text: string, author: string): boolean
  editMemo(id: number, text: string): boolean
  removeMemo(id: number): boolean
  revealMemo(id: number): void
  undo(): void
  redo(): void
  /** True when the flow holds edits the page editor has not received yet. */
  hasPendingEdits(): boolean
  /** Exports the flow's document and marks it as handed over. */
  takeBytes(format: 'hwp' | 'hwpx'): Uint8Array | null
}

export interface HwpFlowViewProps {
  readonly bytes: Uint8Array | null
  readonly title: string
  readonly lang: string
  /** Text scale; document sizes are in pt, so the whole frame is zoomed. */
  readonly zoom: number
  /** Typing in the flow (body paragraphs; tables and pictures stay read-only). */
  readonly editable?: boolean
  /** Opens bytes with the rhwp engine; injectable for tests. */
  readonly openDocument: (bytes: Uint8Array) => Promise<FlowEngineDocument>
  /** Called when the engine cannot build a flow (the caller falls back to the page view). */
  readonly onUnavailable?: (message: string) => void
  /** Called after each edit that reached the engine. */
  readonly onEdit?: () => void
}

type EngineDocument = FlowEngineDocument &
  FlowEditDocument & {
    exportHwp(): Uint8Array
    exportHwpx(): Uint8Array
  }

/**
 * Reading view that reflows an HWP document to the screen width, and edits it
 * in place (flowEditing.ts). The HTML comes from the document, so it is shown
 * in a frame that may not run scripts; this component drives it from outside.
 */
export const HwpFlowView = forwardRef<HwpFlowViewHandle, HwpFlowViewProps>(function HwpFlowView(
  { bytes, title, lang, zoom, editable = false, openDocument, onUnavailable, onEdit },
  ref,
) {
  const [body, setBody] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<EngineDocument | null>(null)
  const editorRef = useRef<FlowEditor | null>(null)
  const pendingRef = useRef(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const editableRef = useRef(editable)
  editableRef.current = editable
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit

  useEffect(() => {
    if (!bytes || bytes.byteLength === 0) {
      setBody('')
      return
    }
    let cancelled = false
    let opened: EngineDocument | null = null
    setBody(null)
    void (async () => {
      try {
        const doc = (await openDocument(bytes)) as EngineDocument
        if (cancelled) {
          doc.free()
          return
        }
        opened = doc
        docRef.current = doc
        pendingRef.current = false
        setBody(buildFlowHtml(doc))
      } catch (err) {
        if (!cancelled) onUnavailable?.(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      editorRef.current?.dispose()
      editorRef.current = null
      if (opened && docRef.current === opened) docRef.current = null
      opened?.free()
    }
    // onUnavailable is a notification only; rebuilding on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, openDocument])

  // The frame is rebuilt only when the document changes; zoom and editing are
  // applied in place so the reading position and the caret stay put.
  const srcDoc = useMemo(
    () => (body === null ? '' : buildFlowDocument(body, zoomRef.current, lang)),
    [body, lang],
  )

  const onFrameLoad = () => {
    const frameDoc = frameRef.current?.contentDocument
    if (!frameDoc) return
    frameDoc.documentElement.style.setProperty('--flow-zoom', String(zoomRef.current))
    editorRef.current?.dispose()
    editorRef.current = null
    const doc = docRef.current
    if (!doc) return
    editorRef.current = createFlowEditor({
      doc,
      frameDocument: frameDoc,
      onChange: () => {
        pendingRef.current = true
        onEditRef.current?.()
      },
    })
    editorRef.current.setEditable(editableRef.current)
  }

  useEffect(() => {
    frameRef.current?.contentDocument?.documentElement.style.setProperty(
      '--flow-zoom',
      String(zoom),
    )
  }, [zoom])

  useEffect(() => {
    editorRef.current?.setEditable(editable)
  }, [editable])

  useImperativeHandle(
    ref,
    () => ({
      runFormat: (action) => editorRef.current?.runFormat(action),
      insertPicture: (picture) => editorRef.current?.insertPicture(picture) ?? false,
      memos: () => editorRef.current?.memos() ?? [],
      addMemo: (text, author) => editorRef.current?.addMemo(text, author) ?? false,
      replyMemo: (parentId, text, author) =>
        editorRef.current?.replyMemo(parentId, text, author) ?? false,
      editMemo: (id, text) => editorRef.current?.editMemo(id, text) ?? false,
      removeMemo: (id) => editorRef.current?.removeMemo(id) ?? false,
      revealMemo: (id) => editorRef.current?.revealMemo(id),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      hasPendingEdits: () => pendingRef.current,
      takeBytes(format) {
        const doc = docRef.current
        if (!doc) return null
        const out = format === 'hwpx' ? doc.exportHwpx() : doc.exportHwp()
        pendingRef.current = false
        return out
      },
    }),
    [],
  )

  return (
    <div
      className="mobile-hwp-flow"
      data-editor="hwp-flow"
      data-mode={editable ? 'edit' : 'view'}
      data-testid="hwp-flow-view"
    >
      {body === null ? (
        <div className="mobile-hwp-loading" aria-live="polite">
          <div className="mobile-spinner" aria-hidden="true" />
        </div>
      ) : (
        <iframe
          className="mobile-hwp-flow-frame"
          title={title}
          ref={frameRef}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={onFrameLoad}
        />
      )}
    </div>
  )
})
