// One opened HTML document (spec 5): its source, the preview copy shown in a script-less frame,
// the source view, undo and redo, and the file side. Loaded only when an HTML document opens.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { WEB_EXPORT_MIME, saveNewFile, type MobileHtmlApi } from '@genoffice/mobile-bridge/html'
import { isMobileCommandError, type MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { ConversionReport } from '@genoffice/odt-engine'
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
  IconWebHide,
  IconWebPreview,
  IconWebSource,
  IconWebUnhide,
} from '../../components/icons/web'
import { MarkdownHideSheet } from '../markdownHideSheet'
import { OdtConfirmSheet } from '../markdownOdtConfirmSheet'
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
import {
  hiddenElementSids,
  nextHtmlHiddenLabel,
  ownHideMarks,
  planHide,
  planUnhide,
} from './htmlHide'
import { buildExportCopy, buildPreviewCopy, hasDocumentScript, mapDocument } from './htmlPreview'
import './htmlEditor.css'

/** Same depth as the Markdown editor's history (a value that may change). */
const HISTORY_LIMIT = 50

/** A cheap first look before the element map is built to confirm a script element. */
const SCRIPT_TAG = /<script[\s>/]/i

/** What the document area shows: the preview copy in its frame, or the source text. */
export type HtmlView = 'preview' | 'source'

/** The formats an HTML document exports to, each written as a new file (spec 3.2, 5.7). */
type HtmlExportFormat = 'docx' | 'odt'

const EXPORT_TEXT: Record<
  HtmlExportFormat,
  { readonly working: MobileStringKey; readonly failed: MobileStringKey }
> = {
  docx: { working: 'webExportDocxWorking', failed: 'webExportDocxFailed' },
  odt: { working: 'webExportOdtWorking', failed: 'webExportOdtFailed' },
}

interface HtmlKeptState {
  readonly source: string
  /** Bumped by every edit; the element map and patch sets carry it. */
  readonly version: number
  readonly view: HtmlView
  /** The element selected in the preview (edit mode), held by its place in the source. */
  readonly selection: HtmlSelection | null
  /** The ODT conversion report waiting for [Save] or [Cancel]; null when nothing is asked. */
  readonly odtReport: ConversionReport | null
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
  openedSession: MobileDocSession,
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
    odtReport: null,
  })
  const readSource = () => kept.get().source
  /** The session of this document as App's active document has it (it changes on save as). */
  let currentSession = openedSession

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
  /** The version of the last edit that did not come from the AI (the AI tools' freshness check). */
  let lastManualVersion = 0

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
   * `manual`: the edit did not come from the AI (the AI re-reads before it edits again).
   */
  const writeSource = (next: string, patches: readonly Patch[] | null = null, manual = true) => {
    const { source: before, version: prevVersion, selection } = kept.get()
    const version = prevVersion + 1
    if (manual) lastManualVersion = version
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
   * source view's whole-source replace, element edits, hide marks and AI edits. Nothing is parsed
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
    writeSource(next, wholeSource ? null : patches, origin !== 'ai')
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

  // ---- hide from AI (spec 5.6): the desktop marks on the selected element ----
  /** The selected element carries a hide mark of its own: the entry is "unhide". */
  const selectedIsHidden = (): boolean => {
    const entry = selectedEntry()
    return entry ? ownHideMarks(readSource(), entry).length > 0 : false
  }

  /** The label offered first for hiding the selected element, or null (a toast said why). */
  const prepareHide = (): string | null => {
    const entry = selectedEntry()
    if (!entry) return null
    const { source, version } = kept.get()
    const map = mapFor(source, version)
    const label = nextHtmlHiddenLabel(source, map, tNow('webHideLabelPrefix'))
    const check = planHide(source, map, entry.sid, label)
    if (!check.ok) {
      showToast({
        message: tNow(check.reason === 'structural' ? 'webHtmlCannotHide' : 'webHideCannot'),
        tone: 'error',
      })
      return null
    }
    return label
  }

  /** Hides the selected element under `label` (one undo step). false: refused (a toast said why). */
  const hideSelected = (label: string): boolean => {
    const entry = selectedEntry()
    if (!entry) return false
    const { source, version } = kept.get()
    const result = planHide(source, mapFor(source, version), entry.sid, label)
    if (!result.ok || !applyPatches(result.patches, 'manual', 'hide')) {
      const structural = !result.ok && result.reason === 'structural'
      showToast({
        message: tNow(structural ? 'webHtmlCannotHide' : 'webHideCannot'),
        tone: 'error',
      })
      return false
    }
    return true
  }

  /** Takes the selected element's own hide marks off (one undo step); its words stay. */
  const unhideSelected = (): boolean => {
    const entry = selectedEntry()
    if (!entry) return false
    const { source, version } = kept.get()
    const result = planUnhide(source, mapFor(source, version), entry.sid)
    if (!result.ok || !applyPatches(result.patches, 'manual', 'unhide')) {
      showToast({ message: tNow('webHtmlEditFailed'), tone: 'error' })
      return false
    }
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
    currentSession = session
    const source = readSource()
    if (forceSaveAs || !session.writable || session.ephemeral) {
      try {
        const nextSession = await htmlApi.saveAsDocument(session, session.name, source)
        currentSession = nextSession
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

  // ---- Word and ODT export (spec 5.7): a new file; the open document stays as it is ----
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

  /** Converts on demand; the converter and its frame are a chunk loaded only here. */
  const convertHtml = async (
    format: HtmlExportFormat,
    html: string,
  ): Promise<{ bytes: Uint8Array; lostCaptures: number; report: ConversionReport | null }> => {
    const exporter = await import('./htmlExport')
    // a picture without words that the phone cannot capture: a marker, not an English placeholder
    const options = { missingPictureText: tNow('webExportPictureMissing') }
    if (format === 'odt') return exporter.htmlToOdt(html, options)
    return { ...(await exporter.htmlToDocx(html, options)), report: null }
  }

  /**
   * The source on screen (unsaved edits included) as Word or ODT, written as a new file with the
   * system save dialog. The document's session, source, undo history and dirty state stay as
   * they are, so saving and sharing it go on to the original file.
   */
  const exportHtml = async (format: HtmlExportFormat) => {
    const { source, version } = kept.get()
    const { working, failed } = EXPORT_TEXT[format]
    showToast(tNow(working))
    let converted: Awaited<ReturnType<typeof convertHtml>>
    try {
      converted = await convertHtml(format, buildExportCopy(source, mapFor(source, version)))
    } catch {
      showToast({ message: tNow(failed), tone: 'error' })
      return
    }
    const reported = converted.report !== null && converted.report.length > 0
    if (converted.report && reported && !(await confirmOdtReport(converted.report))) return
    try {
      const suggestedName = `${currentSession.name.replace(/\.(html|htm)$/i, '')}.${format}`
      const { name } = await saveNewFile(host.client, {
        suggestedName,
        mime: WEB_EXPORT_MIME[format],
        bytes: converted.bytes,
      })
      // pictures the phone could not capture are what the reader misses first (owner, 11-26 Q3)
      const doneKey: MobileStringKey =
        converted.lostCaptures > 0
          ? 'webExportSavedShapeLoss'
          : reported
            ? 'webExportSavedLoss'
            : 'webExportSaved'
      showToast(tNow(doneKey, { name }))
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      showToast({ message: tNow(failed), tone: 'error' })
    }
  }

  const setView = (view: HtmlView) => {
    kept.set({ view })
    resolveSelection()
  }

  function HtmlWorkspace({ frame, mode, canEdit, lang }: EditorWorkspaceProps) {
    const { source, version, view, selection, odtReport } = useSyncExternalStore(
      kept.subscribe,
      kept.get,
    )
    const t = useCallback((key: MobileStringKey) => translateMobile(lang, key), [lang])
    const editing = mode === 'edit' && canEdit && !readOnly
    const [textPlan, setTextPlan] = useState<{ plan: HtmlTextEditPlan; version: number } | null>(
      null,
    )
    /** The hide sheet is open with this label offered first. */
    const [hideLabel, setHideLabel] = useState<string | null>(null)
    // hiding means something to the model only: no entry while the AI is off (owner, 11-26 Q6)
    const hideAvailable = editing && frame.aiEnabled

    // Selecting is an edit-mode thing: leaving edit mode drops the selection and the sheets.
    useEffect(() => {
      if (editing) return
      selectElement(null)
      setTextPlan(null)
      setHideLabel(null)
    }, [editing])
    useEffect(() => {
      if (!hideAvailable) setHideLabel(null)
    }, [hideAvailable])

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

    // hidden elements stay marked in the preview also with the AI off (owner, 11-26 Q6)
    const hiddenSids = useMemo(
      () => (showSource ? [] : hiddenElementSids(source, mapFor(source, version))),
      [showSource, source, version],
    )
    // read on every render: the source changes whenever the selected element's marks can
    const selectionHidden = selectedSid !== null && selectedIsHidden()

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

    // [글 고치기], [지우기] and the hide entry act on the selected element; none selected, none offered
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
        if (hideAvailable) {
          items.push(
            selectionHidden
              ? {
                  id: 'webUnhide',
                  label: t('webUnhide'),
                  icon: <IconWebUnhide size={19} />,
                  onPress: () => {
                    unhideSelected()
                  },
                }
              : {
                  id: 'webHideFromAi',
                  label: t('webHideFromAi'),
                  icon: <IconWebHide size={19} />,
                  onPress: () => setHideLabel(prepareHide()),
                },
          )
        }
      }
      return items
    }, [t, toggleView, hasSelection, hideAvailable, selectionHidden])

    // Word and ODT in both modes, after "view source" in view mode
    const moreItems = useMemo((): EditorQuickActionItem[] => {
      const exports: EditorQuickActionItem[] = [
        {
          id: 'webExportDocx',
          label: t('webExportDocx'),
          onPress: () => void exportHtml('docx'),
        },
        {
          id: 'webExportOdt',
          label: t('webExportOdt'),
          onPress: () => void exportHtml('odt'),
        },
      ]
      return mode === 'view' ? [toggleView, ...exports] : exports
    }, [mode, toggleView, t])

    return (
      <EditorShell
        {...frame}
        quickActions={quickActions}
        formatGroups={[]}
        moreItems={moreItems}
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
              hiddenSids={hiddenSids}
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
        <MarkdownHideSheet
          open={hideAvailable && hideLabel !== null}
          defaultLabel={hideLabel ?? ''}
          onConfirm={(label) => {
            setHideLabel(null)
            // a refused mark has told why in a toast
            hideSelected(label)
          }}
          onCancel={() => setHideLabel(null)}
        />
        <OdtConfirmSheet
          open={odtReport !== null}
          items={odtReport ?? []}
          onConfirm={() => answerOdtConfirm(true)}
          onCancel={() => answerOdtConfirm(false)}
        />
      </EditorShell>
    )
  }

  return {
    save: saveDocumentInternal,
    editable: !readOnly,

    async createAiRun(ctx) {
      // the desktop HTML skill and its strings load with the first run (AI is off by default)
      const { createMobileHtmlSkill } = await import('./htmlAi')
      // one run goes back to the source it started from (spec 5.6, as in Markdown)
      const before = readSource()
      const skill = createMobileHtmlSkill(
        {
          getText: readSource,
          getVersion: () => kept.get().version,
          getMap: () => {
            const { source, version } = kept.get()
            return mapFor(source, version)
          },
          getLastManualVersion: () => lastManualVersion,
          getSelectedSid: () => kept.get().selection?.sid ?? null,
          applyPatches,
        },
        {
          getMode: () => ctx.getMode(),
          // a document that is not UTF-8 is read-only whatever its file allows
          getCapabilities: () =>
            readOnly
              ? { ...ctx.getCapabilities(), writable: false, isUntitled: false }
              : ctx.getCapabilities(),
          switchToEdit: () => ctx.switchToEdit(),
          getLang: () => ctx.getLang(),
          onMutated: (summary) => {
            ctx.setUndo({
              summary,
              undo: () => {
                replaceSource(before)
                ctx.setUndo(null)
              },
            })
          },
        },
      )
      return { skill }
    },

    async share(doc) {
      await htmlApi.shareDocument(doc.session, readSource()).catch(() => {})
    },

    async writeRecovery(doc) {
      await htmlApi.writeRecovery(doc.session, readSource()).catch(() => {})
    },

    Workspace: HtmlWorkspace,

    dispose() {
      // a confirm sheet still open when the document closes writes nothing
      answerOdtConfirm(false)
      mapCache = null
      mapSource = null
    },
  }
}
