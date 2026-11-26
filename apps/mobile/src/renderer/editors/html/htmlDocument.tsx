// One opened HTML document (spec 5): its source, the preview copy shown in a script-less frame,
// the source view, undo and redo, and the file side. Loaded only when an HTML document opens.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { MobileHtmlApi } from '@genoffice/mobile-bridge/html'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { translateMobile } from '../../i18n'
import type { MobileStringKey } from '../../i18n/strings'
import { EditorShell, type EditorQuickActionItem } from '../../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorWorkspaceProps } from '../editorKind'
import {
  applyPatches as applyPatchList,
  validatePatchSet,
  type Patch,
  type PatchOrigin,
} from '../../../../../html/src/renderer/document/patch'
import type { ParseMap } from '../../../../../html/src/renderer/document/parse-map'
import { IconWebPreview, IconWebSource } from '../../components/icons/web'
import { HtmlPreviewFrame } from './HtmlPreviewFrame'
import { HtmlSourceView } from './HtmlSourceView'
import { buildPreviewCopy, hasDocumentScript, mapDocument } from './htmlPreview'
import './htmlEditor.css'

/** Same depth as the Markdown editor's history (a value that may change). */
const HISTORY_LIMIT = 50

/** A cheap first look before the element map is built to confirm a script element. */
const SCRIPT_TAG = /<script[\s>/]/i

/** What the document area shows: the preview copy in its frame, or the source text. */
export type HtmlView = 'preview' | 'source'

interface HtmlKeptState {
  readonly source: string
  /** Bumped by every edit; the element map and patch sets carry it. */
  readonly version: number
  readonly view: HtmlView
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

export interface HtmlOpenedSource {
  readonly text: string
  /** The file is not valid UTF-8: view and share only. */
  readonly readOnly: boolean
}

export interface PreparedHtmlSource extends HtmlOpenedSource {
  /** The banner when the document opens: not UTF-8 first, else the script notice. */
  readonly noticeKey: MobileStringKey | null
  readonly map: ParseMap
}

/** Maps the opened source once, before the session switch, to pick the opening banner. */
export function prepareHtmlSource(opened: HtmlOpenedSource): PreparedHtmlSource {
  const map = mapDocument(opened.text, 0, null)
  const noticeKey: MobileStringKey | null = opened.readOnly
    ? 'webNotUtf8Notice'
    : hasDocumentScript(map)
      ? 'webHtmlScriptNotice'
      : null
  return { ...opened, noticeKey, map }
}

export function startHtmlDocument(
  host: EditorHost,
  htmlApi: MobileHtmlApi,
  opened: PreparedHtmlSource,
): EditorDocument {
  const tNow = host.translate
  const showToast = host.showToast
  const setNoticeBanner = host.setNotice
  const refreshHomeData = host.refreshHome
  const readOnly = opened.readOnly

  const kept = createKeptState<HtmlKeptState>({
    source: opened.text,
    version: 0,
    view: 'preview',
  })
  const readSource = () => kept.get().source

  // ---- the element map of the current version; ids of unchanged elements carry over ----
  let mapCache: ParseMap | null = opened.map
  let mapSource: string | null = opened.text
  const mapFor = (source: string, version: number): ParseMap => {
    if (mapCache && mapSource === source && mapCache.version === version) return mapCache
    mapCache = mapDocument(source, version, mapCache)
    mapSource = source
    return mapCache
  }

  // ---- the script notice: once per document, also when a script is typed in later ----
  let scriptNoticeShown = opened.noticeKey === 'webHtmlScriptNotice'
  const noticeScriptOnce = (source: string, version: number) => {
    if (scriptNoticeShown || readOnly || !SCRIPT_TAG.test(source)) return
    if (!hasDocumentScript(mapFor(source, version))) return
    scriptNoticeShown = true
    setNoticeBanner(tNow('webHtmlScriptNotice'))
  }

  // ---- undo and redo: one step per patch set ----
  const undoStack: string[] = []
  const redoStack: string[] = []
  const writeSource = (next: string) => {
    const version = kept.get().version + 1
    kept.set({ source: next, version })
    host.markDirty(true)
    host.contentChanged()
    noticeScriptOnce(next, version)
  }

  /**
   * Every edit of the source goes down to one patch set against the current version: the
   * source view's whole-source replace now, element edits and AI edits later. Nothing is parsed
   * and serialized again; untouched source stays character for character. false: refused.
   */
  const applyPatches = (patches: readonly Patch[], origin: PatchOrigin, label: string): boolean => {
    if (readOnly) return false
    const { source, version } = kept.get()
    const error = validatePatchSet(
      { patches: [...patches], baseVersion: version, origin, label },
      version,
      source.length,
    )
    if (error) return false
    const next = applyPatchList(source, patches)
    if (next === source) return true
    undoStack.push(source)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack.length = 0
    writeSource(next)
    return true
  }

  const replaceSource = (next: string) =>
    applyPatches([{ from: 0, to: readSource().length, text: next }], 'manual', 'source')

  const undo = () => {
    const prev = undoStack.pop()
    if (prev === undefined) return
    redoStack.push(readSource())
    writeSource(prev)
  }
  const redo = () => {
    const next = redoStack.pop()
    if (next === undefined) return
    undoStack.push(readSource())
    writeSource(next)
  }

  // ---- the file side, the same flow as the Markdown editor ----
  const saveDocumentInternal: NonNullable<EditorDocument['save']> = async (
    doc,
    forceSaveAs = false,
  ) => {
    const { session } = doc
    const source = readSource()
    if (forceSaveAs || !session.writable || session.ephemeral) {
      try {
        const nextSession = await htmlApi.saveAsDocument(session, session.name, source)
        host.updateSession({ session: nextSession, dirty: false, isUntitled: false })
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
      await htmlApi.saveDocument(session, source)
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

  const setView = (view: HtmlView) => kept.set({ view })

  function HtmlWorkspace({ frame, mode, canEdit, lang }: EditorWorkspaceProps) {
    const { source, version, view } = useSyncExternalStore(kept.subscribe, kept.get)
    const t = useCallback((key: MobileStringKey) => translateMobile(lang, key), [lang])
    const editing = mode === 'edit' && canEdit && !readOnly
    const showSource = view === 'source'

    const previewCopy = useMemo(() => {
      if (showSource) return ''
      try {
        return buildPreviewCopy(source, mapFor(source, version))
      } catch {
        // no copy we can vouch for: show nothing rather than the document unguarded
        return ''
      }
    }, [showSource, source, version])

    const toggleView = useMemo((): EditorQuickActionItem => {
      return showSource
        ? {
            id: 'webHtmlShowPreview',
            label: t('webHtmlShowPreview'),
            icon: <IconWebPreview size={19} />,
            onPress: () => setView('preview'),
          }
        : {
            id: 'webHtmlShowSource',
            label: t(mode === 'edit' ? 'webHtmlShowSource' : 'webHtmlViewSource'),
            icon: <IconWebSource size={19} />,
            onPress: () => setView('source'),
          }
    }, [showSource, mode, t])

    const quickActions = useMemo(
      (): EditorQuickActionItem[] => [
        { id: 'undo', label: t('undo'), onPress: undo },
        { id: 'redo', label: t('redo'), onPress: redo },
        toggleView,
      ],
      [t, toggleView],
    )

    return (
      <EditorShell
        {...frame}
        quickActions={quickActions}
        formatGroups={[]}
        moreItems={mode === 'view' ? [toggleView] : []}
        viewTools={[]}
        onFitToWidth={() => {}}
      >
        <div className="web-html-viewport" data-editor="html" data-mode={mode} data-view={view}>
          {showSource ? (
            <HtmlSourceView
              value={source}
              readOnly={!editing}
              label={t('webHtmlSourceLabel')}
              onChange={replaceSource}
            />
          ) : (
            <HtmlPreviewFrame srcDoc={previewCopy} title={t('webHtmlFrameTitle')} />
          )}
        </div>
      </EditorShell>
    )
  }

  return {
    save: saveDocumentInternal,
    editable: !readOnly,
    // The HTML AI tools come with their own task; until then no AI entry is shown for HTML.
    aiAvailable: false,

    async share(doc) {
      await htmlApi.shareDocument(doc.session, readSource()).catch(() => {})
    },

    async writeRecovery(doc) {
      await htmlApi.writeRecovery(doc.session, readSource()).catch(() => {})
    },

    Workspace: HtmlWorkspace,

    dispose() {
      mapCache = null
      mapSource = null
    },
  }
}
