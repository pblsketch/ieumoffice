// One opened HTML document (spec 5): its source, the preview copy shown in a script-less frame,
// the source view, undo and redo, and the file side. Loaded only when an HTML document opens.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import { compileOps } from '../../../../../html/src/renderer/document/ops'
import {
  IconWebDelete,
  IconWebEditText,
  IconWebPreview,
  IconWebSource,
} from '../../components/icons/web'
import { HtmlPreviewFrame } from './HtmlPreviewFrame'
import { HtmlSourceView } from './HtmlSourceView'
import { HtmlTextEditSheet } from './HtmlTextEditSheet'
import {
  compileRemove,
  diffAsPatch,
  findSelectedEntry,
  mapOffsetThroughPatches,
  planTextEdit,
  textEditOps,
  type HtmlSelection,
  type HtmlTextEditPlan,
} from './htmlElementEdit'
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
  /** The element selected in the preview (edit mode), held by its place in the source. */
  readonly selection: HtmlSelection | null
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
    selection: null,
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

  /**
   * Finds the selected element again in the current version: the element that now starts where
   * the selected one's start tag moved to, with the same tag. None: the selection is cleared.
   * In the source view the element map is not needed, so this waits for the preview.
   */
  const resolveSelection = () => {
    const { selection, source, version, view } = kept.get()
    if (!selection || selection.sid !== null || view !== 'preview') return
    const entry = findSelectedEntry(mapFor(source, version), selection)
    kept.set({ selection: entry ? { ...selection, sid: entry.sid } : null })
  }

  /**
   * Writes a new source. `patches` describe the change when it is a patch set; otherwise (undo,
   * redo, a whole-source replace) the selection follows the one patch between the two texts.
   */
  const writeSource = (next: string, patches: readonly Patch[] | null = null) => {
    const { source: before, version: prevVersion, selection } = kept.get()
    const version = prevVersion + 1
    let followed: HtmlSelection | null = null
    if (selection) {
      const start = mapOffsetThroughPatches(selection.start, patches ?? [diffAsPatch(before, next)])
      followed = start === null ? null : { start, tag: selection.tag, sid: null }
    }
    kept.set({ source: next, version, selection: followed })
    resolveSelection()
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
    const wholeSource =
      patches.length === 1 && patches[0]!.from === 0 && patches[0]!.to === source.length
    writeSource(next, wholeSource ? null : patches)
    return true
  }

  // ---- element editing (spec 5.4): selection, edit text, delete ----
  const selectElement = (sid: number | null) => {
    if (sid === null) {
      if (kept.get().selection) kept.set({ selection: null })
      return
    }
    const { source, version } = kept.get()
    const entry = mapFor(source, version).bySid.get(sid)
    kept.set({ selection: entry ? { start: entry.startTag[0], tag: entry.tag, sid } : null })
  }

  /** The selected element's entry in the current version, or null. */
  const selectedEntry = () => {
    const { selection, source, version } = kept.get()
    if (!selection || selection.sid === null) return null
    return mapFor(source, version).bySid.get(selection.sid) ?? null
  }

  /** What "edit text" offers for the selection, with the version it was read from. */
  const planForSelection = (): { plan: HtmlTextEditPlan; version: number } | null => {
    const entry = selectedEntry()
    if (!entry) return null
    const { source, version } = kept.get()
    const plan = planTextEdit(source, mapFor(source, version), entry.sid)
    return plan ? { plan, version } : null
  }

  /** Applies the edited fields as one patch set (one undo step). false: refused (a toast said why). */
  const applyTextEdit = (
    planned: { plan: HtmlTextEditPlan; version: number },
    values: readonly string[],
  ): boolean => {
    const { source, version } = kept.get()
    if (planned.version !== version) {
      showToast(tNow('webHtmlEditFailed'))
      return false
    }
    const ops = textEditOps(planned.plan, values)
    if (ops.length === 0) return true
    const compiled = compileOps(source, mapFor(source, version), ops)
    if (compiled.errors.length > 0 || !applyPatches(compiled.patches, 'manual', 'edit-text')) {
      showToast(tNow('webHtmlEditFailed'))
      return false
    }
    return true
  }

  /** Removes the selected element (one undo step); the document's html, head and body stay. */
  const deleteSelected = (): boolean => {
    const entry = selectedEntry()
    if (!entry) return false
    const { source, version } = kept.get()
    const result = compileRemove(source, mapFor(source, version), entry.sid)
    if (!result.ok) {
      showToast(tNow(result.reason === 'structural' ? 'webHtmlCannotDelete' : 'webHtmlEditFailed'))
      return false
    }
    const { patches, errors } = result.compiled
    if (errors.length > 0 || !applyPatches(patches, 'manual', 'remove')) {
      showToast(tNow('webHtmlEditFailed'))
      return false
    }
    showToast(tNow('webHtmlDeleted'))
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

  const setView = (view: HtmlView) => {
    kept.set({ view })
    resolveSelection()
  }

  function HtmlWorkspace({ frame, mode, canEdit, lang }: EditorWorkspaceProps) {
    const { source, version, view, selection } = useSyncExternalStore(kept.subscribe, kept.get)
    const t = useCallback((key: MobileStringKey) => translateMobile(lang, key), [lang])
    const editing = mode === 'edit' && canEdit && !readOnly
    const [textPlan, setTextPlan] = useState<{ plan: HtmlTextEditPlan; version: number } | null>(
      null,
    )

    // Selecting is an edit-mode thing: leaving edit mode drops the selection and the sheet.
    useEffect(() => {
      if (editing) return
      selectElement(null)
      setTextPlan(null)
    }, [editing])

    const selectedSid = editing && view === 'preview' ? (selection?.sid ?? null) : null
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

    // [글 고치기] and [지우기] act on the selected element; with none selected they are not offered
    const hasSelection = selectedSid !== null
    const quickActions = useMemo((): EditorQuickActionItem[] => {
      const items: EditorQuickActionItem[] = [
        { id: 'undo', label: t('undo'), onPress: undo },
        { id: 'redo', label: t('redo'), onPress: redo },
        toggleView,
      ]
      if (hasSelection) {
        items.push(
          {
            id: 'webHtmlEditText',
            label: t('webHtmlEditText'),
            icon: <IconWebEditText size={19} />,
            onPress: () => setTextPlan(planForSelection()),
          },
          {
            id: 'webHtmlDelete',
            label: t('webHtmlDelete'),
            icon: <IconWebDelete size={19} />,
            onPress: () => {
              deleteSelected()
            },
          },
        )
      }
      return items
    }, [t, toggleView, hasSelection])

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
            <HtmlPreviewFrame
              srcDoc={previewCopy}
              title={t('webHtmlFrameTitle')}
              // view mode: a press selects nothing
              onElementPress={editing ? selectElement : undefined}
              selectedSid={selectedSid}
            />
          )}
        </div>
        <HtmlTextEditSheet
          plan={editing ? (textPlan?.plan ?? null) : null}
          onApply={(values) => {
            // a refused edit has told why in a toast; either way the sheet is done
            if (textPlan) applyTextEdit(textPlan, values)
            setTextPlan(null)
          }}
          onCancel={() => setTextPlan(null)}
          onEditInSource={() => {
            setTextPlan(null)
            setView('source')
          }}
        />
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
