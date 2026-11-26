import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  base64ToBytes,
  createMobileMarkdownApi,
  createMobileMarkdownSkill,
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

/** Values of one open document that outlive its Workspace (unmounted on the settings screen). */
interface MarkdownKeptState {
  readonly markdownText: string
  readonly zoomScale: number
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
  // a .txt recovery copy reopens as an untitled Markdown document, as before
  recoveryFormat: () => 'md',
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

  const kept = createKeptState<MarkdownKeptState>({ markdownText: openedText, zoomScale: 1 })
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

  /** Markdown: convert to a HWP document (.hwpx) and save it as a new file. */
  const exportMarkdownToHwp = async () => {
    const text = readMarkdown()
    showToast(tNow('markdownToHwpWorking'))
    let converted: { bytes: Uint8Array; lossCount: number }
    try {
      const { markdownToHwpx } = await import('./markdownToHwp')
      converted = await markdownToHwpx(text)
    } catch {
      showToast({ message: tNow('markdownToHwpFailed'), tone: 'error' })
      return
    }
    try {
      const name = `${currentSession.name.replace(/\.(md|markdown|txt)$/i, '')}.hwpx`
      const session = await markdownApi.saveConvertedHwpx(name, converted.bytes)
      showToast({
        message: tNow(converted.lossCount > 0 ? 'markdownToHwpDoneLoss' : 'markdownToHwpDone'),
        action: { label: tNow('openNow'), onPress: () => void host.openSession(session) },
      })
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      showToast({ message: tNow('markdownToHwpFailed'), tone: 'error' })
    }
  }

  function MarkdownWorkspace({ frame, mode, lang }: EditorWorkspaceProps) {
    const { markdownText, zoomScale } = useSyncExternalStore(kept.subscribe, kept.get)
    const activeFormat = frame.docFormat
    const tNow = useCallback(
      (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key),
      [lang],
    )

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
    }, [activeFormat, tNow])

    return (
      <EditorShell
        {...frame}
        quickActions={quickActions}
        formatGroups={formatGroups}
        moreItems={
          activeFormat === 'md'
            ? [
                {
                  id: 'markdownToHwp',
                  label: tNow('markdownToHwp'),
                  onPress: () => void exportMarkdownToHwp(),
                },
              ]
            : []
        }
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
          onChange={(next) => {
            setMarkdownText(next)
            textChanged()
          }}
          onErrorNotice={(key) => setNoticeBanner(tNow(key))}
        />
      </EditorShell>
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
  }
}
