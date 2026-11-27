import type {
  BeginSaveMode,
  HwpApi,
  HwpFormat,
  MeasuredTab,
  MemoSnapshot,
  SavePreview,
  TabMeasure,
  TabSpot,
} from '../shared/ipc'

/** Result of the engine's self-read-back check before writing `.hwp`. */
export interface SaveVerifyInfo {
  pageCountBefore: number
  pageCountAfter: number
  recovered: boolean
}

/** The part of the embedded editor a save needs. */
export interface SaveEditorPort {
  /** the open document was unlocked with a password; the exports below would write it without one */
  isPasswordProtected(): Promise<boolean>
  exportHwp(): Promise<Uint8Array>
  exportHwpx(): Promise<Uint8Array>
  /** serialize to HWP, reload the result inside the engine, report whether it came back whole */
  exportHwpVerify(): Promise<SaveVerifyInfo>
  /** the memos the editor holds; null when it cannot list them */
  listMemos(): Promise<MemoSnapshot[] | null>
  /** hold off user input while memos are listed and the bytes are exported */
  setMemoLock(locked: boolean): Promise<unknown>
  /** how the editor lays out the given tabs; null for one it cannot measure */
  measureTabs(spots: TabSpot[]): Promise<(TabMeasure | null)[]>
  /** the document's preview as it is now: its first lines and first page (decision 0146) */
  savePreview(): Promise<SavePreview>
  /** clear the editor's unsaved state after the host stored the bytes */
  notifySaved(fileName?: string): Promise<unknown>
}

export type SaveOutcome =
  /**
   * `tailsLost`: written, but without some master pages or memos the opened file had.
   * `memosLost`: written, but fewer memos than the editor held made it into the HWPX.
   */
  | {
      kind: 'saved'
      path: string
      backupPath?: string
      tailsLost?: true
      memosLost?: number
    }
  | { kind: 'canceled' }
  /**
   * Save As picked PDF: nothing was saved. The caller writes the PDF copy to `path`
   * through the PDF export; the document keeps its file and its unsaved state.
   */
  | { kind: 'export'; format: 'pdf'; path: string }
  /**
   * Nothing was written.
   * `protected`: the document has a password this save path cannot keep.
   * `tracked`: the document has tracked changes this save path cannot keep.
   * `verify`: the engine could not read back what it was about to write.
   */
  | {
      kind: 'failed'
      reason: 'protected' | 'tracked' | 'verify' | 'export' | 'write'
      detail?: string
      verify?: SaveVerifyInfo
    }

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** the main process's refusal reason while a copy pair holds the disk version (hwp-main.ts) */
const EXTERNAL_MODIFIED = 'hwp: external-modified'

/**
 * The widths for the tabs the engine wrote without one (Hangul would draw them with none,
 * decision 0026), as the editor lays them out. A save never fails on this: whatever cannot
 * be measured is written as the engine wrote it.
 */
async function measuredTabs(
  editor: Pick<SaveEditorPort, 'measureTabs'>,
  api: Pick<HwpApi, 'newTabs'>,
  bytes: Uint8Array,
  format: HwpFormat,
): Promise<MeasuredTab[]> {
  try {
    const spots = await api.newTabs(bytes, format)
    if (spots.length === 0) return []
    const measures = await editor.measureTabs(spots)
    return spots.flatMap((spot, index) => {
      const measure = measures[index]
      return measure ? [{ ...spot, ...measure }] : []
    })
  } catch {
    return []
  }
}

/**
 * Export HWPX with the memo list the bytes correspond to. The editor is locked while both
 * happen, so no keystroke can add or remove a memo between the list and the export. If the
 * lock cannot be taken, the list is not trusted (only raw memo records are checked) but the
 * save still goes ahead; a save never fails over this.
 */
async function exportHwpxWithMemos(editor: SaveEditorPort): Promise<{
  bytes: Uint8Array
  memos: MemoSnapshot[] | null
}> {
  let locked = false
  try {
    await editor.setMemoLock(true)
    locked = true
  } catch {
    // fall through: export without a list
  }
  if (!locked) return { bytes: await editor.exportHwpx(), memos: null }
  try {
    const memos = await editor.listMemos().catch(() => null)
    const bytes = await editor.exportHwpx()
    return { bytes, memos }
  } finally {
    await editor.setMemoLock(false).catch(() => {})
  }
}

export type StalenessAction = 'save' | 'saveAs' | 'print' | 'pdf' | 'submission'
export type StalenessPromptChoice = 'refresh' | 'continue' | 'cancel'

export interface StaleCheckItem {
  id: string
  checkerId?: string
  kind: string
  reason: string
  label?: string
}

export interface StaleCheckReport {
  stale: boolean
  items: StaleCheckItem[]
}

export interface StalenessGateOptions {
  /** Refreshes all stale blocks (typically wrapped in one editor undo transaction). */
  refreshAll?: () => Promise<unknown>
}

/**
 * Shared pre-action staleness check for manual save, print, PDF export, and submission copy.
 * Fail-open: if checking staleness throws or rejects, returns `'continue'` so saving or
 * printing is never blocked by a diagnostic error.
 */
export async function checkStalenessBeforeAction(
  action: StalenessAction,
  checkStale: () => Promise<StaleCheckReport>,
  promptUser: (report: StaleCheckReport, action: StalenessAction) => Promise<StalenessPromptChoice>,
  options?: StalenessGateOptions,
): Promise<'continue' | 'cancel'> {
  let report: StaleCheckReport
  try {
    report = await checkStale()
  } catch {
    return 'continue'
  }
  if (!report || !report.stale || !Array.isArray(report.items) || report.items.length === 0) {
    return 'continue'
  }
  let choice: StalenessPromptChoice
  try {
    choice = await promptUser(report, action)
  } catch {
    return 'continue'
  }
  if (choice === 'cancel') return 'cancel'
  if (choice === 'refresh' && typeof options?.refreshAll === 'function') {
    try {
      const outcome = await options.refreshAll()
      if (outcome === 'cancel' || outcome === false) return 'cancel'
    } catch {
      // fail-open: never block save or print if refresh itself fails
    }
  }
  return 'continue'
}

export interface RunSaveOptions {
  /**
   * Optional pre-save staleness hook for manual saves.
   * Never invoked when `automatic === true`. Fail-open if it throws.
   */
  onStaleCheck?: () => Promise<'continue' | 'cancel'>
}

export interface SubmissionCopyExport {
  bytes: Uint8Array
  verify?: SaveVerifyInfo
}

export interface SubmissionSaveEditorPort extends Pick<
  SaveEditorPort,
  'isPasswordProtected' | 'measureTabs' | 'savePreview'
> {
  /**
   * Build stripped submission copy bytes on an isolated clone without touching the live document.
   * For `'hwp'`, includes `verify` (self-read-back page count check on the stripped bytes).
   */
  exportSubmissionCopy(format: HwpFormat): Promise<SubmissionCopyExport>
}

export type SubmissionSaveOutcome =
  | {
      kind: 'saved'
      path: string
      tailsLost?: true
    }
  | { kind: 'canceled' }
  | {
      kind: 'failed'
      reason: 'protected' | 'tracked' | 'verify' | 'export' | 'write'
      detail?: string
      verify?: SaveVerifyInfo
    }

export interface RunSubmissionSaveOptions {
  /**
   * Pre-submission staleness check: runs before opening the submission save dialog.
   * Fail-open if it throws.
   */
  onStaleCheck?: () => Promise<'continue' | 'cancel'>
}

/**
 * One save, start to finish: the main process decides where and in which
 * format, the editor exports, the main process writes. The file on disk is
 * only replaced by bytes the engine could produce; a failed export leaves it
 * untouched.
 */
export async function runSave(
  editor: SaveEditorPort,
  api: Pick<HwpApi, 'beginSave' | 'newTabs' | 'commitSave' | 'abortSave'>,
  mode: BeginSaveMode,
  /** the app's own 30-second save: a copy-pair conflict stands down instead of asking */
  automatic = false,
  options?: RunSaveOptions,
): Promise<SaveOutcome> {
  // before any dialog: a protected document is not saved under any name
  try {
    if (await editor.isPasswordProtected()) {
      api.abortSave()
      return { kind: 'failed', reason: 'protected' }
    }
  } catch (error) {
    api.abortSave()
    return { kind: 'failed', reason: 'export', detail: detailOf(error) }
  }

  // manual saves check staleness before saving; auto-save must never prompt or interrupt
  if (!automatic && typeof options?.onStaleCheck === 'function') {
    let verdict: 'continue' | 'cancel'
    try {
      verdict = await options.onStaleCheck()
    } catch {
      verdict = 'continue'
    }
    if (verdict === 'cancel') {
      api.abortSave()
      return { kind: 'canceled' }
    }
  }

  const begin = await api.beginSave(mode)
  if (!begin.ok) {
    if (begin.reason === 'memo') return { kind: 'canceled' }
    return begin.reason === 'tracked'
      ? { kind: 'failed', reason: 'tracked' }
      : { kind: 'failed', reason: 'write', detail: begin.error }
  }
  if ('canceled' in begin) return { kind: 'canceled' }
  if ('export' in begin) return { kind: 'export', format: begin.export, path: begin.path }

  let bytes: Uint8Array
  let memos: MemoSnapshot[] | null | undefined
  try {
    if (begin.format === 'hwp') {
      const verify = await editor.exportHwpVerify()
      if (!verify.recovered || verify.pageCountBefore !== verify.pageCountAfter) {
        api.abortSave()
        return { kind: 'failed', reason: 'verify', verify }
      }
      bytes = await editor.exportHwp()
    } else {
      const exported = await exportHwpxWithMemos(editor)
      bytes = exported.bytes
      memos = exported.memos
    }
  } catch (error) {
    api.abortSave()
    return { kind: 'failed', reason: 'export', detail: detailOf(error) }
  }

  // a preview that cannot be made is sent as null: the file gets a blank one, never the
  // opened file's (which may show text deleted since); a save never fails over this
  const preview = await editor.savePreview().catch(() => null)
  const commit = await api.commitSave(
    bytes,
    await measuredTabs(editor, api, bytes, begin.format),
    memos === undefined ? { auto: automatic, preview } : { auto: automatic, memos, preview },
  )
  if (!commit.ok) {
    // a same-document copy holds the disk version: the main process refused
    // the write (a deferred autosave or a declined overwrite prompt) — that is
    // a cancel, not a failure, and nothing lands in a notice
    if (commit.error === EXTERNAL_MODIFIED) return { kind: 'canceled' }
    return { kind: 'failed', reason: 'write', detail: commit.error }
  }
  // the file is already written; a failed notification only leaves the editor's own dirty flag set
  await editor.notifySaved(fileNameOf(commit.path)).catch(() => {})
  return {
    kind: 'saved',
    path: commit.path,
    ...(commit.backupPath ? { backupPath: commit.backupPath } : {}),
    ...(commit.tailsLost ? { tailsLost: true as const } : {}),
    ...(commit.memosLost ? { memosLost: commit.memosLost } : {}),
  }
}

/**
 * Save a clean submission copy to a separate path without mutating the live document
 * or changing the active tab's file path, dirty state, backup tracking, or recovery copy.
 * Runs staleness check first before opening the save dialog, verifies HWP read-back
 * parity, and writes nothing on any failure or cancellation.
 */
export async function runSubmissionSave(
  editor: SubmissionSaveEditorPort,
  api: Pick<
    HwpApi,
    'beginSubmissionSave' | 'newTabs' | 'commitSubmissionSave' | 'abortSubmissionSave'
  >,
  options?: RunSubmissionSaveOptions,
): Promise<SubmissionSaveOutcome> {
  try {
    if (await editor.isPasswordProtected()) {
      api.abortSubmissionSave()
      return { kind: 'failed', reason: 'protected' }
    }
  } catch (error) {
    api.abortSubmissionSave()
    return { kind: 'failed', reason: 'export', detail: detailOf(error) }
  }

  if (typeof options?.onStaleCheck === 'function') {
    let verdict: 'continue' | 'cancel'
    try {
      verdict = await options.onStaleCheck()
    } catch {
      verdict = 'continue'
    }
    if (verdict === 'cancel') {
      api.abortSubmissionSave()
      return { kind: 'canceled' }
    }
  }

  const begin = await api.beginSubmissionSave()
  if (!begin.ok) {
    if (begin.reason === 'memo') return { kind: 'canceled' }
    return begin.reason === 'tracked'
      ? { kind: 'failed', reason: 'tracked' }
      : { kind: 'failed', reason: 'write', detail: begin.error }
  }
  if ('canceled' in begin) return { kind: 'canceled' }

  let bytes: Uint8Array
  try {
    const exported = await editor.exportSubmissionCopy(begin.format)
    if (begin.format === 'hwp') {
      const verify = exported.verify
      if (!verify || !verify.recovered || verify.pageCountBefore !== verify.pageCountAfter) {
        api.abortSubmissionSave()
        return {
          kind: 'failed',
          reason: 'verify',
          ...(verify ? { verify } : {}),
        }
      }
    }
    if (!(exported.bytes instanceof Uint8Array) || exported.bytes.length === 0) {
      throw new Error('empty submission copy')
    }
    bytes = exported.bytes
  } catch (error) {
    api.abortSubmissionSave()
    return { kind: 'failed', reason: 'export', detail: detailOf(error) }
  }

  const preview = await editor.savePreview().catch(() => null)
  const commit = await api.commitSubmissionSave(
    bytes,
    await measuredTabs(editor, api, bytes, begin.format),
    { preview },
  )
  if (!commit.ok) {
    if (commit.error === EXTERNAL_MODIFIED) return { kind: 'canceled' }
    return { kind: 'failed', reason: 'write', detail: commit.error }
  }
  // Never call editor.notifySaved: the original document's path and dirty state stay untouched.
  return {
    kind: 'saved',
    path: commit.path,
    ...(commit.tailsLost ? { tailsLost: true as const } : {}),
  }
}
