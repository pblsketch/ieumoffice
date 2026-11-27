/**
 * The spreadsheet document's save, Save As, share and recovery copy
 * (spec 2.3–2.5), on the desktop's own renderer flows:
 *
 * - Save: `handleSave` of apps/sheets/src/renderer/save-actions.ts on the
 *   live grid, which sends the journal to the phone's `saveWorkbookEdits`
 *   (desktop-api/save.ts → save/saveWorkbook.ts: patch, manifest check,
 *   reopen, lock again when opened with a password, write). Where it goes:
 *   - a writable `.xlsx`/`.xlsm`: over the original;
 *   - an `.xls`, a read-only or untitled document, a restored recovery copy:
 *     Save As with `name.xlsx` filled in (the original `.xls` is never
 *     written); the saved file becomes the document;
 *   - a `.csv`: asked every time — CSV (the current sheet's visible values,
 *     the desktop's csv-export rules, over the original), an Excel file
 *     (Save As `name.xlsx`, which becomes the document), or cancel. CSV
 *     takes the edits into the session's `.xlsx` first and writes the
 *     original last, so a failure leaves the original as it was; a `.csv`
 *     the app cannot write in place (read-only, shared in) gets a CSV copy
 *     in a new file instead (the desktop's CSV export).
 * - Save As (and share) first ask the format: the workbook in its own
 *   format (`.xlsm` for a macro workbook), CSV of the current sheet, ODS of
 *   the whole workbook, PDF of the current sheet (save-as-formats.ts rules).
 *   CSV, ODS and PDF are copies: the session's file, its unsaved edits and
 *   its recovery copy stay as they are.
 * - Share: the workbook (the original as it is when nothing changed, else
 *   the edited workbook — locked again when it was opened with a password),
 *   or one of the copies.
 * - Recovery copy: the same save writer into the work folder, kept by Rust;
 *   none for a workbook opened with a password (document.ts holds that rule
 *   too).
 *
 * One of these runs at a time per document. A recovery copy the app's timer
 * asks for while a save runs (the app going to the background, say) is
 * skipped; a save waits for a recovery copy already running.
 */
import {
  sheetsSaveToOriginal,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsWriteCopy,
} from '@genoffice/mobile-bridge/sheets'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type {
  WorkbookFile,
  WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import type { MobileStringKey } from '../../../i18n'
import type { EditorDocument } from '../../editorKind'
import { resolveTransferredRequest, takeSaveFailure } from '../desktop-api/save'
import type { MobileWorkbookDocument } from '../desktop-api/sessions'
import type { MobileGrid } from '../grid/mobileGrid'
import { sheetsSessions } from '../session'
import type { SheetsDocumentContext } from '../workspace/slots'
import { saveFailureKind, saveFailureMessage } from './failures'
import { csvCopyName, documentStem, isMacroWorkbook } from './names'
import {
  UTF8_BOM,
  sheetsShareFile,
  writeWorkFolderBytes,
  writeWorkFolderText,
} from './nativeCommands'
import { sheetsSavePrompts, type SheetsOutputFormat } from './prompts'

/** The part of the desktop `SaveContext` the phone fills (the rest is optional there). */
interface PhoneSaveContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  setMessage: (message: string) => void
  openLazyWorkbook: (opened: WorkbookFile) => void | Promise<boolean>
  stashViewRestore: (view: unknown) => void
}

export interface PcSaveOutcome {
  readonly ok: boolean
  readonly error?: string
  /** mode 'ods': the pending edits as the save request a save would send. */
  readonly request?: WorkbookSaveRequest
}

/** The desktop renderer modules this slot drives (the real ones, or stand-ins in tests). */
export interface SheetsSaveModules {
  /** save-actions.ts `handleSave`. */
  handleSave(
    ctx: PhoneSaveContext,
    mode: 'save' | 'save-as' | 'recovery' | 'ods',
    quiet: boolean,
  ): Promise<PcSaveOutcome>
  /** csv-export.ts `handleExportCsv`. */
  handleExportCsv(
    ctx: Pick<PhoneSaveContext, 'univerRef' | 'lazyWorkbookRef' | 'setMessage'> & {
      requestSaveAs: () => void
    },
  ): Promise<void>
  /** ods-export.ts `handleExportOds`. */
  handleExportOds(ctx: {
    lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
    setMessage: (message: string) => void
    pendingEdits: () => Promise<WorkbookSaveRequest | null>
  }): Promise<boolean>
  /** The current sheet as CSV text (csv-export.ts rules, formulas settled first), or why not. */
  activeSheetCsv(grid: MobileGrid): Promise<string | 'needs-full-load' | 'too-large' | null>
  /** The current sheet as a PDF (pdf/exportSheetPdf.ts). */
  activeSheetPdf(grid: MobileGrid, documentName: string): Promise<SheetPdfOutput>
  /** A desktop status-bar sentence (apps/sheets i18n). */
  pcText(key: PcTextKey): Promise<string>
}

export interface SheetPdfOutput {
  readonly bytes: Uint8Array
  readonly fileName: string
  /** Pictures, charts and shapes of the sheet the PDF does not hold. */
  readonly skippedVisuals: number
  /** Characters no bundled font has (they print as empty boxes). */
  readonly missingGlyphs: number
}

type PcTextKey =
  | 'appNoEditsToSave'
  | 'appCsvExportNeedsFullLoad'
  | 'appCsvExportTooLarge'
  | 'appCsvExportCanceled'
  | 'appOdsExportCanceled'

// Lazy globs, like grid/pcGridModules.ts: these reach WorkbookVisuals.tsx
// through univer-sync.ts, which does not type-check on the phone.
const saveActionModules = import.meta.glob<{
  handleSave: SheetsSaveModules['handleSave']
}>('../../../../../../sheets/src/renderer/save-actions.ts')
const csvModules = import.meta.glob<{
  handleExportCsv: SheetsSaveModules['handleExportCsv']
  activeCsvSheet(runtime: UniverRuntime | null): { sheet: unknown; sheetCount: number } | null
  serializeActiveSheetCsv(sheet: unknown, state: LazyWorkbookState | null): string | 'too-large'
}>('../../../../../../sheets/src/renderer/csv-export.ts')
const odsModules = import.meta.glob<{
  handleExportOds: SheetsSaveModules['handleExportOds']
}>('../../../../../../sheets/src/renderer/ods-export.ts')
const settleModules = import.meta.glob<{
  settleFormulas(runtime: UniverRuntime): Promise<void>
}>('../../../../../../sheets/src/renderer/formula-settle.ts')
const localeModules = import.meta.glob<{ t(key: string): string }>(
  '../../../../../../sheets/src/renderer/i18n/locale.tsx',
)

async function loadOne<T>(modules: Record<string, () => Promise<T>>, name: string): Promise<T> {
  const load = Object.values(modules)[0]
  if (!load) throw new Error(`Desktop module missing: ${name}`)
  return load()
}

export const pcSaveModules: SheetsSaveModules = {
  async handleSave(ctx, mode, quiet) {
    return (await loadOne(saveActionModules, 'save-actions.ts')).handleSave(ctx, mode, quiet)
  },
  async handleExportCsv(ctx) {
    return (await loadOne(csvModules, 'csv-export.ts')).handleExportCsv(ctx)
  },
  async handleExportOds(ctx) {
    return (await loadOne(odsModules, 'ods-export.ts')).handleExportOds(ctx)
  },
  async activeSheetCsv(grid) {
    const state = grid.lazyWorkbookRef.current
    if (!state) return null
    // The desktop's CSV save asks for the whole workbook first (save-actions.ts).
    if (!state.flags.preloadComplete) return 'needs-full-load'
    const csv = await loadOne(csvModules, 'csv-export.ts')
    await (await loadOne(settleModules, 'formula-settle.ts')).settleFormulas(grid.runtime)
    const active = csv.activeCsvSheet(grid.runtime)
    return active === null ? null : csv.serializeActiveSheetCsv(active.sheet, state)
  },
  async activeSheetPdf(grid, documentName) {
    const { exportActiveSheetPdf } = await import('../pdf/exportSheetPdf')
    const result = await exportActiveSheetPdf(
      { runtime: grid.runtime, lazyWorkbookRef: grid.lazyWorkbookRef },
      { documentName },
    )
    return {
      bytes: result.bytes,
      fileName: result.fileName,
      skippedVisuals: result.skippedVisuals,
      missingGlyphs: result.stats.missingGlyphs,
    }
  },
  async pcText(key) {
    return (await loadOne(localeModules, 'i18n/locale.tsx')).t(key)
  },
}

/** The desktop save module (kept for the PC-module guard tests). */
export async function pcSaveActions(): Promise<Pick<SheetsSaveModules, 'handleSave'>> {
  return loadOne(saveActionModules, 'save-actions.ts')
}

export type SheetsSaveActions = Pick<
  EditorDocument,
  'save' | 'share' | 'writeRecovery' | 'exportPdf'
>

/** A `.csv` document (its every save asks CSV / Excel / cancel). */
export function isCsvDocument(
  document: Pick<MobileWorkbookDocument, 'name' | 'converted'>,
): boolean {
  return document.converted && /\.csv$/i.test(document.name)
}

/**
 * Whether a plain save must go to a new file: a converted `.xls` (and a
 * `.csv` kept as Excel), a document the app cannot write in place (another
 * app's read-only copy), an untitled one (new, or a restored recovery copy).
 */
export function saveGoesToSaveAs(
  doc: Pick<ActiveDocState, 'isUntitled'> & {
    readonly session: Pick<ActiveDocState['session'], 'writable' | 'ephemeral'>
  },
  document: Pick<MobileWorkbookDocument, 'converted'>,
): boolean {
  return document.converted || doc.isUntitled || !doc.session.writable || doc.session.ephemeral
}

/**
 * Whether a `.csv` kept as CSV cannot go over its original: another app's
 * read-only or shared-in copy (and an untitled one). Its CSV goes to a new
 * file instead, as a plain save goes to Save As.
 */
export function csvGoesToCopy(
  doc: Pick<ActiveDocState, 'isUntitled'> & {
    readonly session: Pick<ActiveDocState['session'], 'writable' | 'ephemeral'>
  },
): boolean {
  return doc.isUntitled || !doc.session.writable || doc.session.ephemeral
}

type Running = { readonly kind: 'user' | 'recovery'; readonly done: Promise<void> }

export function createSheetsSaveActions(
  context: SheetsDocumentContext,
  modules: SheetsSaveModules = pcSaveModules,
): SheetsSaveActions {
  const { host, opened } = context
  const client = host.client
  const t = (key: MobileStringKey) => host.translate(key)
  const fail = (message: string) => host.showToast({ message, tone: 'error' })
  const uiLocale = () => globalThis.document?.documentElement.lang || 'en'

  let running: Running | null = null
  async function exclusive<T>(
    kind: Running['kind'],
    fallback: T,
    run: () => Promise<T>,
  ): Promise<T> {
    while (running) {
      if (kind === 'recovery') return fallback
      if (running.kind === 'user') {
        fail(t('sheetsSaveBusy'))
        return fallback
      }
      await running.done
    }
    let release = () => {}
    const done = new Promise<void>((resolve) => {
      release = resolve
    })
    running = { kind, done }
    try {
      return await run()
    } finally {
      running = null
      release()
    }
  }

  /** The engine session the grid shows now (each save swaps it). */
  function engineSessionId(): string {
    return context.grid.grid?.lazyWorkbookRef.current?.file.sessionId ?? opened.file.sessionId
  }

  function currentDocument(): MobileWorkbookDocument {
    const id = engineSessionId()
    return (sheetsSessions.has(id) ? sheetsSessions.get(id).document : undefined) ?? opened.document
  }

  async function runPcSave(
    grid: MobileGrid,
    mode: 'save' | 'save-as' | 'recovery' | 'ods',
  ): Promise<{ readonly result: PcSaveOutcome; readonly messages: string[] }> {
    const messages: string[] = []
    const result = await modules.handleSave(
      {
        univerRef: { current: grid.runtime },
        lazyWorkbookRef: grid.lazyWorkbookRef,
        setMessage: (message) => messages.push(message),
        openLazyWorkbook: (file) => grid.load(file).then(() => true),
        stashViewRestore: () => undefined,
      },
      mode,
      true,
    )
    return { result, messages }
  }

  /** After an unsuccessful desktop save: its last sentence, if it said anything. */
  function reportFailure(result: PcSaveOutcome, messages: readonly string[]): void {
    const message = messages.at(-1)
    if (message) fail(message)
    else if (result.error) fail(result.error)
  }

  function saved(): void {
    host.showToast(t('savedNotice'))
  }

  async function nothingToSave(result: PcSaveOutcome, messages: readonly string[]) {
    return (
      !result.ok &&
      result.error === undefined &&
      messages.includes(await modules.pcText('appNoEditsToSave'))
    )
  }

  /** Save As of the workbook (system save dialog, `name.xlsx` or `name.xlsm` filled in). */
  async function saveAsWorkbook(grid: MobileGrid): Promise<boolean> {
    const before = engineSessionId()
    const { result, messages } = await runPcSave(grid, 'save-as')
    if (result.ok) {
      const { takeSavedAsSession } = await import('./saveWorkbook')
      const session = takeSavedAsSession(engineSessionId())
      if (session) host.updateSession({ session, dirty: false, isUntitled: false })
      else host.markDirty(false)
      saved()
      await host.refreshHome()
      return true
    }
    takeSaveFailure(before)
    reportFailure(result, messages)
    return false
  }

  async function saveInPlace(grid: MobileGrid): Promise<boolean> {
    const before = engineSessionId()
    const { result, messages } = await runPcSave(grid, 'save')
    if (result.ok || (await nothingToSave(result, messages))) {
      host.markDirty(false)
      saved()
      return true
    }
    // The storage refused to write in place: Save As, as the other editors do.
    if (takeSaveFailure(before) === 'read-only') return saveAsWorkbook(grid)
    reportFailure(result, messages)
    return false
  }

  /** The current sheet's CSV in a work-folder file (UTF-8 with a BOM), or null after telling why not. */
  async function csvFile(grid: MobileGrid): Promise<string | null> {
    const content = await modules.activeSheetCsv(grid)
    if (content === 'needs-full-load') {
      fail(await modules.pcText('appCsvExportNeedsFullLoad'))
      return null
    }
    if (content === 'too-large') {
      fail(await modules.pcText('appCsvExportTooLarge'))
      return null
    }
    if (content === null) {
      fail(t('sheetsSaveFailed'))
      return null
    }
    const { path } = await sheetsTempNewPath(client, 'csv')
    await writeWorkFolderText(client, path, `${UTF8_BOM}${content}`)
    return path
  }

  /**
   * A `.csv` document kept as CSV: the current sheet over the original, the
   * edits into the session. In this order: the CSV text (from the grid as it
   * is now, before the save reloads it), the session's `.xlsx` (nothing
   * reaches the original: the session is converted), then the original. A
   * failure before the last step leaves the original as it was; a failure
   * of the last step says why and leaves the document unsaved.
   */
  async function saveCsvInPlace(grid: MobileGrid, document: MobileWorkbookDocument) {
    const path = await csvFile(grid)
    if (path === null) return false
    try {
      const { result, messages } = await runPcSave(grid, 'save')
      if (!result.ok && !(await nothingToSave(result, messages))) {
        reportFailure(result, messages)
        return false
      }
      try {
        await sheetsSaveToOriginal(client, document.sessionId, path)
      } catch (error) {
        // The storage refused to write in place: a CSV copy in a new file.
        if (saveFailureKind(error) === 'read-only') return await exportCsvCopy(grid)
        fail(saveFailureMessage(error, t))
        return false
      }
    } finally {
      await sheetsTempDelete(client, path).catch(() => undefined)
    }
    host.markDirty(false)
    saved()
    return true
  }

  function copyWritten(name: string): void {
    host.showToast(host.translate('sheetsCopySaved', { name }))
  }

  /** Copy failures: a closed dialog says nothing, the rest says why. */
  function copyFailed(error: unknown, fallback: MobileStringKey): void {
    if (saveFailureKind(error) === 'cancelled') return
    fail(error instanceof Error ? saveFailureMessage(error, t) : t(fallback))
  }

  /** The desktop's CSV export (formula warning, then a new document). */
  async function exportCsvCopy(grid: MobileGrid): Promise<boolean> {
    const messages: string[] = []
    let saveAsInstead = false
    await modules.handleExportCsv({
      univerRef: { current: grid.runtime },
      lazyWorkbookRef: grid.lazyWorkbookRef,
      setMessage: (message) => messages.push(message),
      requestSaveAs: () => {
        saveAsInstead = true
      },
    })
    if (saveAsInstead) return saveAsWorkbook(grid)
    const message = messages.at(-1)
    if (message && message !== (await modules.pcText('appCsvExportCanceled'))) {
      host.showToast(message)
    }
    return false
  }

  /** The pending edits as a save request, sent nowhere (the desktop's `pendingEdits`). */
  async function pendingRequest(grid: MobileGrid): Promise<WorkbookSaveRequest | null> {
    const { result } = await runPcSave(grid, 'ods')
    return result.ok && result.request ? result.request : null
  }

  async function exportOdsCopy(grid: MobileGrid, document: MobileWorkbookDocument) {
    if (document.unlocked) {
      fail(t('sheetsOdsEncrypted'))
      return
    }
    const messages: string[] = []
    await modules.handleExportOds({
      lazyWorkbookRef: grid.lazyWorkbookRef,
      setMessage: (message) => messages.push(message),
      pendingEdits: () => pendingRequest(grid),
    })
    const message = messages.at(-1)
    if (message && message !== (await modules.pcText('appOdsExportCanceled'))) {
      host.showToast(message)
    }
  }

  /** The current sheet's PDF, handed to `deliver`; then the one notice of what it left out. */
  async function exportPdf(
    grid: MobileGrid,
    document: MobileWorkbookDocument,
    deliver: (path: string, name: string) => Promise<string | null>,
  ): Promise<void> {
    host.showToast(t('sheetsPdfWorking'))
    let path: string | null = null
    try {
      const pdf = await modules.activeSheetPdf(grid, document.name)
      path = (await sheetsTempNewPath(client, 'pdf')).path
      await writeWorkFolderBytes(client, path, pdf.bytes)
      const name = await deliver(path, pdf.fileName)
      if (name !== null) copyWritten(name)
      const notice = [
        pdf.skippedVisuals > 0
          ? host.translate('sheetsPdfSkippedVisuals', { count: pdf.skippedVisuals })
          : '',
        pdf.missingGlyphs > 0
          ? host.translate('sheetsPdfMissingGlyphs', { count: pdf.missingGlyphs })
          : '',
      ]
        .filter(Boolean)
        .join(' ')
      if (notice) host.setNotice(notice)
    } catch (error) {
      if (saveFailureKind(error) === 'cancelled') return
      const kind = saveFailureKind(error)
      fail(
        kind === 'other'
          ? error instanceof Error && error.name === 'PrintError'
            ? error.message
            : t('sheetsPdfFailed')
          : saveFailureMessage(error, t),
      )
    } finally {
      if (path !== null) await sheetsTempDelete(client, path).catch(() => undefined)
    }
  }

  async function writeCopy(path: string, name: string, mime: string): Promise<string> {
    return (await sheetsWriteCopy(client, path, name, mime)).name
  }

  async function shareWorkbook(doc: ActiveDocState, grid: MobileGrid | null) {
    const document = currentDocument()
    const untouched = !doc.dirty && !document.converted && !doc.isUntitled
    if (untouched || !grid) {
      // The file as it is (a workbook opened with a password stays locked).
      await client.shareFile({
        sessionId: doc.session.sessionId,
        suggestedName: doc.session.name,
        mode: 'original',
      })
      return
    }
    const request = await pendingRequest(grid)
    if (!request) {
      fail(t('sheetsShareFailed'))
      return
    }
    const { lockWorkbookCopy, saveAsSuggestion, stageWorkbookCopy } = await import('./saveWorkbook')
    const files: string[] = []
    try {
      const staged = await stageWorkbookCopy(
        { client, sessions: sheetsSessions, locale: uiLocale() },
        resolveTransferredRequest(sheetsSessions, request),
      )
      files.push(staged.path)
      const path = document.unlocked
        ? await lockWorkbookCopy(client, staged.path, document.unlocked.password)
        : staged.path
      if (path !== staged.path) files.push(path)
      await sheetsShareFile(client, {
        sessionId: doc.session.sessionId,
        path,
        suggestedName: saveAsSuggestion(document),
      })
    } finally {
      for (const path of files) await sheetsTempDelete(client, path).catch(() => undefined)
    }
  }

  async function shareCsv(doc: ActiveDocState, grid: MobileGrid, document: MobileWorkbookDocument) {
    const path = await csvFile(grid)
    if (path === null) return
    try {
      await sheetsShareFile(client, {
        sessionId: doc.session.sessionId,
        path,
        suggestedName: csvCopyName(document.name),
      })
    } finally {
      await sheetsTempDelete(client, path).catch(() => undefined)
    }
  }

  async function shareOds(doc: ActiveDocState, grid: MobileGrid, document: MobileWorkbookDocument) {
    if (document.unlocked) {
      fail(t('sheetsOdsEncrypted'))
      return
    }
    const request = await pendingRequest(grid)
    if (!request) {
      fail(t('sheetsShareFailed'))
      return
    }
    const { stageWorkbookCopy } = await import('./saveWorkbook')
    const { exportOdsCopy: odsCopy } = await import('./odsExport')
    const staged = await stageWorkbookCopy(
      { client, sessions: sheetsSessions, locale: uiLocale() },
      resolveTransferredRequest(sheetsSessions, request),
    )
    try {
      const outcome = await odsCopy(client, {
        sourcePath: staged.path,
        confirmLoss: (count) => sheetsSavePrompts().confirmOdsLoss(count),
        deliver: async (odsPath) => {
          const name = `${documentStem(document.name)}.ods`
          await sheetsShareFile(client, {
            sessionId: doc.session.sessionId,
            path: odsPath,
            suggestedName: name,
          })
          return name
        },
      })
      if (outcome.status === 'unreadable') fail(t('sheetsOdsUnreadable'))
      if (outcome.status === 'failed') fail(t('sheetsOdsFailed'))
    } finally {
      await sheetsTempDelete(client, staged.path).catch(() => undefined)
    }
  }

  return {
    async save(doc, forceSaveAs) {
      return exclusive('user', false, async () => {
        const grid = context.grid.grid
        if (!grid) {
          fail(t('sheetsSaveFailed'))
          return false
        }
        const document = currentDocument()
        if (forceSaveAs) {
          const format: SheetsOutputFormat | null = await sheetsSavePrompts().chooseFormat({
            purpose: 'save-as',
            macro: isMacroWorkbook(document.name),
            unlocked: document.unlocked !== undefined,
          })
          switch (format) {
            case 'workbook':
              return saveAsWorkbook(grid)
            case 'csv':
              return exportCsvCopy(grid)
            case 'ods':
              await exportOdsCopy(grid, document)
              return false
            case 'pdf':
              await exportPdf(grid, document, (path, name) =>
                writeCopy(path, name, 'application/pdf'),
              )
              return false
            default:
              return false
          }
        }
        if (isCsvDocument(document)) {
          const answer = await sheetsSavePrompts().askCsvSave()
          if (answer === 'cancel') return false
          if (answer === 'xlsx') return saveAsWorkbook(grid)
          if (csvGoesToCopy(doc)) return exportCsvCopy(grid)
          return saveCsvInPlace(grid, document)
        }
        if (saveGoesToSaveAs(doc, document)) return saveAsWorkbook(grid)
        return saveInPlace(grid)
      })
    },

    async share(doc) {
      await exclusive('user', undefined, async () => {
        const document = currentDocument()
        const format = await sheetsSavePrompts().chooseFormat({
          purpose: 'share',
          macro: isMacroWorkbook(document.name),
          unlocked: document.unlocked !== undefined,
        })
        if (format === null) return
        const grid = context.grid.grid
        try {
          if (format === 'workbook') {
            await shareWorkbook(doc, grid)
            return
          }
          if (!grid) {
            fail(t('sheetsShareFailed'))
            return
          }
          if (format === 'csv') await shareCsv(doc, grid, document)
          else if (format === 'ods') await shareOds(doc, grid, document)
          else {
            await exportPdf(grid, document, async (path, name) => {
              await sheetsShareFile(client, {
                sessionId: doc.session.sessionId,
                path,
                suggestedName: name,
              })
              return null
            })
          }
        } catch (error) {
          copyFailed(error, 'sheetsShareFailed')
        }
      })
    },

    async writeRecovery() {
      await exclusive('recovery', undefined, async () => {
        const grid = context.grid.grid
        if (!grid || currentDocument().unlocked) return
        await runPcSave(grid, 'recovery')
      })
    },

    async exportPdf(doc) {
      return exclusive('user', null, async () => {
        const document = currentDocument()
        if (document.unlocked) {
          fail(t('homePrintProtected'))
          return null
        }
        const grid = context.grid.grid
        if (!grid) {
          fail(t('homePdfExportFailed'))
          return null
        }
        const result = await modules.activeSheetPdf(grid, document.name)
        return {
          kind: 'bytes' as const,
          bytes: result.bytes,
          fileName: doc.session.name,
          ...(result.missingGlyphs > 0 ? { noticeKey: 'homePdfMissingGlyphs' as const } : {}),
        }
      })
    },
  }
}
