import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ConversionReport } from '@genoffice/odt-engine'
import { WEB_EXPORT_MIME, saveNewFile } from '@genoffice/mobile-bridge/html'
import {
  base64ToBytes,
  createMobileMarkdownApi,
  createMobileMarkdownSkill,
  hiddenSpanAt,
  hideSelection,
  nextHiddenLabel,
  unhideSpan,
  type HideRefusal,
  type MobileMarkdownApi,
  type MobileMarkdownOpenedText,
} from '@genoffice/mobile-bridge/markdown'
import { isMobileCommandError, type MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { translateMobile } from '../i18n'
import type { MobileStringKey } from '../i18n/strings'
import {
  EditorShell,
  type EditorFormatGroup,
  type EditorQuickActionItem,
} from '../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorKind, EditorWorkspaceProps } from './editorKind'
import {
  MarkdownMobileEditor,
  type MarkdownMobileEditorHandle,
  type MarkdownQuickAction,
} from './MarkdownMobileEditor'
import { MarkdownFindSheet } from './markdownFindSheet'
import { MarkdownHideSheet } from './markdownHideSheet'
import { OdtConfirmSheet } from './markdownOdtConfirmSheet'
import { IconWebFind, IconWebHide, IconWebUnhide } from '../components/icons/web'

/** Values of one open document that outlive its Workspace (unmounted on the settings screen). */
interface MarkdownKeptState {
  readonly markdownText: string
  readonly zoomScale: number
  /** The ODT conversion report waiting for [Save] or [Cancel]; null when nothing is asked. */
  readonly odtReport: ConversionReport | null
}

/** The formats a Markdown document exports to, each written as a new file (spec 3.2). */
type MarkdownExportFormat = 'hwpx' | 'docx' | 'odt'

const EXPORT_TEXT: Record<
  MarkdownExportFormat,
  { readonly working: MobileStringKey; readonly failed: MobileStringKey }
> = {
  hwpx: { working: 'markdownToHwpWorking', failed: 'markdownToHwpFailed' },
  docx: { working: 'webExportDocxWorking', failed: 'webExportDocxFailed' },
  odt: { working: 'webExportOdtWorking', failed: 'webExportOdtFailed' },
}

/** Why "hide from AI" did nothing, as told to the reader. */
const HIDE_REFUSAL_TEXT: Record<HideRefusal, MobileStringKey> = {
  empty: 'webHideNoSelection',
  multiline: 'webHideMultiLine',
  overlap: 'webHideOverlap',
  unreadable: 'webHideCannot',
}

interface ConvertedExport {
  readonly bytes: Uint8Array
  /** Something could not be carried over exactly. */
  readonly lossy: boolean
  /** ODT only: what changes or is left out, confirmed before anything is written. */
  readonly report?: ConversionReport
}

/** Converts on demand; the converters are a chunk loaded only here. */
async function convertMarkdown(
  format: MarkdownExportFormat,
  markdown: string,
): Promise<ConvertedExport> {
  const converters = await import('./markdownToHwp')
  if (format === 'docx') return { bytes: await converters.markdownToDocx(markdown), lossy: false }
  if (format === 'odt') {
    const { bytes, report } = await converters.markdownToOdt(markdown)
    return { bytes, lossy: report.length > 0, report }
  }
  const { bytes, lossCount } = await converters.markdownToHwpx(markdown)
  return { bytes, lossy: lossCount > 0 }
}

function createKeptState<T extends object>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: (): T => value,
    set(patch: Partial<T>): void {
      value = { ...value, ...patch }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const markdownEditorKind: EditorKind = {
  id: 'markdown',
  formats: ['md', 'txt'],
  openExtensions: ['md', 'markdown', 'txt'],
  createFormats: ['md'],
  editable: true,
  hasAi: true,
  recoveryFormat: (format) => (format === 'txt' ? 'txt' : 'md'),
  async open({ session, client, isUntitled, recoveryBytesBase64 }) {
    const markdownApi = createMobileMarkdownApi(client)
    // A recovery copy's own bytes decide its envelope (BOM, line ends), like a file's do.
    const opened: MobileMarkdownOpenedText = recoveryBytesBase64
      ? markdownApi.openFromBytes(session, base64ToBytes(recoveryBytesBase64))
      : isUntitled
        ? { text: '' }
        : await markdownApi.readDocument(session)
    // Not UTF-8: edited text would be saved garbled, so this document is view and share only.
    const readOnly = opened.utf8 === false
    return {
      noticeKey: readOnly ? 'webNotUtf8Notice' : null,
      start: (host) => startMarkdownDocument(host, markdownApi, session, opened.text, readOnly),
    }
  },
}

function startMarkdownDocument(
  host: EditorHost,
  markdownApi: MobileMarkdownApi,
  openedSession: MobileDocSession,
  openedText: string,
  readOnly: boolean,
): EditorDocument {
  const tNow = host.translate
  const showToast = host.showToast
  const setNoticeBanner = host.setNotice
  const refreshHomeData = host.refreshHome

  // The session of this document as App's active document has it; this object
  // lives only while the document is the active one.
  let currentSession = openedSession
  const updateSessionMetadata = (meta: {
    session: MobileDocSession
    dirty: boolean
    isUntitled: boolean
  }) => {
    currentSession = meta.session
    host.updateSession(meta)
  }

  const kept = createKeptState<MarkdownKeptState>({
    markdownText: openedText,
    zoomScale: 1,
    odtReport: null,
  })
  const setMarkdownText = (markdownText: string) => kept.set({ markdownText })
  const markdownEditorRef: { current: MarkdownMobileEditorHandle | null } = { current: null }
  /** The editor's text while it is mounted, else the last text it had (e.g. on the settings screen). */
  const readMarkdown = () => markdownEditorRef.current?.getMarkdown() ?? kept.get().markdownText

  /** Every change of the text: unsaved, and the recovery copy waits for the next pause. */
  const textChanged = () => {
    host.markDirty(true)
    host.contentChanged()
  }

  const saveDocumentInternal: NonNullable<EditorDocument['save']> = async (
    doc,
    forceSaveAs = false,
  ) => {
    const { session } = doc
    const currentText = readMarkdown()
    if (forceSaveAs || !session.writable || session.ephemeral) {
      try {
        const nextSession = await markdownApi.saveAsDocument(session, session.name, currentText)
        updateSessionMetadata({
          session: nextSession,
          dirty: false,
          isUntitled: false,
        })
        showToast(tNow('savedNotice'))
        await refreshHomeData()
        return true
      } catch (err) {
        if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return false
        setNoticeBanner(tNow('readonlyShareNotice'))
        return false
      }
    }
    try {
      await markdownApi.saveDocument(session, currentText)
      host.markDirty(false)
      showToast(tNow('savedNotice'))
      await refreshHomeData()
      return true
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'READ_ONLY_URI') {
        setNoticeBanner(tNow('readonlyShareNotice'))
        return saveDocumentInternal(doc, true)
      }
      return false
    }
  }

  /** The answer to the ODT confirm sheet that is open now. */
  let resolveOdtConfirm: ((save: boolean) => void) | null = null
  const confirmOdtReport = (report: ConversionReport) =>
    new Promise<boolean>((resolve) => {
      resolveOdtConfirm?.(false)
      resolveOdtConfirm = resolve
      kept.set({ odtReport: report })
    })
  const answerOdtConfirm = (save: boolean) => {
    const resolve = resolveOdtConfirm
    resolveOdtConfirm = null
    if (kept.get().odtReport !== null) kept.set({ odtReport: null })
    resolve?.(save)
  }

  /**
   * Markdown → Hangul, Word or ODT, written as a new file with the system save dialog.
   * The open document keeps its session, so saving and sharing it go on to the original file.
   */
  const exportMarkdown = async (format: MarkdownExportFormat) => {
    // the text on screen, unsaved edits included
    const text = readMarkdown()
    const { working, failed } = EXPORT_TEXT[format]
    showToast(tNow(working))
    let converted: ConvertedExport
    try {
      converted = await convertMarkdown(format, text)
    } catch {
      showToast({ message: tNow(failed), tone: 'error' })
      return
    }
    if (converted.report && converted.report.length > 0) {
      if (!(await confirmOdtReport(converted.report))) return
    }
    try {
      const suggestedName = `${currentSession.name.replace(/\.(md|markdown|txt)$/i, '')}.${format}`
      const { name } =
        format === 'hwpx'
          ? await markdownApi.saveConvertedHwpx(suggestedName, converted.bytes)
          : await saveNewFile(host.client, {
              suggestedName,
              mime: WEB_EXPORT_MIME[format],
              bytes: converted.bytes,
            })
      showToast(tNow(converted.lossy ? 'webExportSavedLoss' : 'webExportSaved', { name }))
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      showToast({ message: tNow(failed), tone: 'error' })
    }
  }

  function MarkdownWorkspace({ frame, mode, canEdit, lang }: EditorWorkspaceProps) {
    const { markdownText, zoomScale, odtReport } = useSyncExternalStore(kept.subscribe, kept.get)
    const [findOpen, setFindOpen] = useState(false)
    const closeFind = useCallback(() => setFindOpen(false), [])
    const getEditor = useCallback(() => markdownEditorRef.current, [])
    const activeFormat = frame.docFormat
    const tNow = useCallback(
      (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key),
      [lang],
    )

    // ---- hide from AI (spec 4.4): only while editing with the AI turned on ----
    const hideAvailable = frame.aiEnabled && mode === 'edit' && canEdit
    const [selection, setSelection] = useState({ start: 0, end: 0 })
    const onSelectionChange = useCallback(
      (start: number, end: number) => {
        if (!hideAvailable) return
        setSelection((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
      },
      [hideAvailable],
    )
    const caretInHidden = useMemo(
      () => hideAvailable && hiddenSpanAt(markdownText, selection.start, selection.end) !== null,
      [hideAvailable, markdownText, selection],
    )
    /** The selection waiting for a name in the hide sheet. */
    const [hidePending, setHidePending] = useState<{
      readonly start: number
      readonly end: number
      readonly defaultLabel: string
    } | null>(null)
    /** Selects `[start, end)` once the editor shows `text` (a write re-renders the textarea first). */
    const selectAfterWrite = useRef<{ text: string; start: number; end: number } | null>(null)
    useEffect(() => {
      const pending = selectAfterWrite.current
      if (!pending || pending.text !== markdownText) return
      selectAfterWrite.current = null
      markdownEditorRef.current?.selectRange(pending.start, pending.end, { focus: true })
      onSelectionChange(pending.start, pending.end)
    }, [markdownText, onSelectionChange])
    const writeWithSelection = useCallback((text: string, start: number, end: number) => {
      selectAfterWrite.current = { text, start, end }
      // one undo step, like every other edit of the source
      markdownEditorRef.current?.setMarkdown(text)
    }, [])
    const refuseHide = useCallback(
      (reason: HideRefusal) =>
        showToast({ message: tNow(HIDE_REFUSAL_TEXT[reason]), tone: 'error' }),
      [tNow],
    )

    const pressHide = useCallback(() => {
      const sel = markdownEditorRef.current?.getSelection()
      if (!sel) return
      const text = readMarkdown()
      const span = hiddenSpanAt(text, sel.start, sel.end)
      if (span) {
        // the caret is in a hidden span: the entry is "unhide"
        const shown = unhideSpan(text, span)
        writeWithSelection(shown.source, shown.wordsStart, shown.wordsEnd)
        return
      }
      const defaultLabel = nextHiddenLabel(text, tNow('webHideLabelPrefix'))
      const check = hideSelection(text, sel.start, sel.end, defaultLabel)
      if (!check.ok) {
        refuseHide(check.reason)
        return
      }
      setHidePending({ start: sel.start, end: sel.end, defaultLabel })
    }, [refuseHide, tNow, writeWithSelection])

    const confirmHide = useCallback(
      (label: string) => {
        const pending = hidePending
        setHidePending(null)
        if (!pending) return
        const hidden = hideSelection(readMarkdown(), pending.start, pending.end, label)
        if (!hidden.ok) {
          refuseHide(hidden.reason)
          return
        }
        writeWithSelection(hidden.source, hidden.wordsStart, hidden.wordsEnd)
      },
      [hidePending, refuseHide, writeWithSelection],
    )
    const cancelHide = useCallback(() => setHidePending(null), [])

    const hideItem = useMemo((): EditorQuickActionItem | null => {
      if (!hideAvailable) return null
      return caretInHidden
        ? {
            id: 'webUnhide',
            label: tNow('webUnhide'),
            icon: <IconWebUnhide size={19} />,
            onPress: pressHide,
          }
        : {
            id: 'webHideFromAi',
            label: tNow('webHideFromAi'),
            icon: <IconWebHide size={19} />,
            onPress: pressHide,
          }
    }, [hideAvailable, caretInHidden, tNow, pressHide])

    // Toolbar actions and the format panel ([Aa]) of the editor.
    const { quickActions, formatGroups } = useMemo((): {
      quickActions: EditorQuickActionItem[]
      formatGroups: EditorFormatGroup[]
    } => {
      const md = (id: MarkdownQuickAction, label: MobileStringKey): EditorQuickActionItem => ({
        id,
        label: tNow(label),
        onPress: () => markdownEditorRef.current?.runAction(id),
      })
      const quick = [
        md('undo', 'undo'),
        md('redo', 'redo'),
        md('bold', 'bold'),
        md('italic', 'italic'),
        md('heading', 'heading'),
        md('list', 'bulletList'),
        { ...md('insertImage', 'insertImage'), id: 'image' },
      ]
      if (activeFormat === 'txt') return { quickActions: quick.slice(0, 2), formatGroups: [] }
      return {
        quickActions: quick,
        formatGroups: [
          {
            id: 'text',
            title: tNow('fmtGroupText'),
            items: [
              md('bold', 'bold'),
              md('italic', 'italic'),
              md('strikethrough', 'strikethrough'),
              md('link', 'link'),
              ...(hideItem ? [hideItem] : []),
            ],
          },
          {
            id: 'paragraph',
            title: tNow('fmtGroupParagraph'),
            items: [
              md('heading', 'heading'),
              md('heading2', 'heading2'),
              md('heading3', 'heading3'),
              md('list', 'bulletList'),
              md('numberedList', 'numberedList'),
              md('taskList', 'taskList'),
              md('quote', 'quote'),
              md('codeBlock', 'codeBlock'),
            ],
          },
          {
            id: 'insert',
            title: tNow('fmtGroupInsert'),
            items: [{ ...md('insertImage', 'insertImage'), id: 'image' }],
          },
        ],
      }
    }, [activeFormat, tNow, hideItem])

    return (
      <>
        <EditorShell
          {...frame}
          quickActions={quickActions}
          formatGroups={formatGroups}
          moreItems={[
            {
              id: 'webFindReplace',
              label: tNow('webFindReplace'),
              icon: <IconWebFind size={19} />,
              onPress: () => setFindOpen(true),
            },
            ...(hideItem ? [hideItem] : []),
            ...(activeFormat === 'md'
              ? [
                  {
                    id: 'markdownToHwp',
                    label: tNow('markdownToHwp'),
                    onPress: () => void exportMarkdown('hwpx'),
                  },
                  {
                    id: 'webExportDocx',
                    label: tNow('webExportDocx'),
                    onPress: () => void exportMarkdown('docx'),
                  },
                  {
                    id: 'webExportOdt',
                    label: tNow('webExportOdt'),
                    onPress: () => void exportMarkdown('odt'),
                  },
                ]
              : []),
          ]}
          viewTools={[]}
          onFitToWidth={() => {
            kept.set({ zoomScale: 1 })
          }}
        >
          <MarkdownMobileEditor
            ref={markdownEditorRef}
            value={markdownText}
            mode={mode}
            isPlainText={activeFormat === 'txt'}
            zoomScale={zoomScale}
            onZoomChange={(next) => kept.set({ zoomScale: next })}
            onChange={(next) => {
              setMarkdownText(next)
              textChanged()
            }}
            onErrorNotice={(key) => setNoticeBanner(tNow(key))}
            onSelectionChange={hideAvailable ? onSelectionChange : undefined}
            editorLabel={tNow('webMarkdownEditorLabel')}
          />
        </EditorShell>
        <MarkdownFindSheet
          open={findOpen}
          onClose={closeFind}
          mode={mode}
          canEdit={canEdit}
          text={markdownText}
          getEditor={getEditor}
          onEnterEdit={frame.onEnterEdit}
          notify={showToast}
        />
        <MarkdownHideSheet
          open={hidePending !== null}
          defaultLabel={hidePending?.defaultLabel ?? ''}
          onConfirm={confirmHide}
          onCancel={cancelHide}
        />
        <OdtConfirmSheet
          open={odtReport !== null}
          items={odtReport ?? []}
          onConfirm={() => answerOdtConfirm(true)}
          onCancel={() => answerOdtConfirm(false)}
        />
      </>
    )
  }

  return {
    save: saveDocumentInternal,
    editable: !readOnly,

    async share(doc) {
      const text = readMarkdown()
      await markdownApi.shareDocument(doc.session, text).catch(() => {})
    },

    async writeRecovery(doc) {
      const text = readMarkdown()
      await markdownApi.writeRecovery(doc.session, text).catch(() => {})
    },

    async createAiRun(ctx) {
      // Throws before anything is sent when the hidden spans cannot be verified
      // (spec 4.4); the AI panel shows that, not this editor.
      const skill = createMobileMarkdownSkill(
        {
          getMarkdown: () => readMarkdown(),
          setMarkdown: (next) => {
            markdownEditorRef.current?.setMarkdown(next)
            setMarkdownText(next)
            textChanged()
          },
        },
        {
          getMode: () => ctx.getMode(),
          getCapabilities: () => ctx.getCapabilities(),
          switchToEdit: () => ctx.switchToEdit(),
          onDocumentMutated: (summary, prev) => {
            ctx.setUndo({
              summary,
              undo: () => {
                markdownEditorRef.current?.setMarkdown(prev)
                setMarkdownText(prev)
                textChanged()
                ctx.setUndo(null)
              },
            })
          },
        },
      )
      return { skill }
    },

    Workspace: MarkdownWorkspace,

    dispose() {
      // a confirm sheet still open when the document closes writes nothing
      answerOdtConfirm(false)
    },
  }
}
