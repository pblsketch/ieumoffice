/**
 * The spreadsheet document's save, share and recovery copy (owned by
 * XLS-T10, which replaces what is here). Until then:
 *
 * - save: a writable `.xlsx`/`.xlsm` saves through the desktop renderer's own
 *   save flow (`handleSave`, apps/sheets/src/renderer/save-actions.ts) on the
 *   live grid, which sends the journal to the phone's `saveWorkbookEdits`
 *   (desktop-api/save.ts → save/saveWorkbook.ts: patch, manifest check,
 *   reopen, write back). Everything else (Save As, a converted `.xls`/`.csv`,
 *   a read-only copy, a workbook opened with a password) says it cannot be
 *   saved on the phone yet; an unlocked workbook must never reach the
 *   original unencrypted.
 * - share: the original file as it is on disk (for a password-protected
 *   workbook that is the encrypted file).
 * - recovery copy: none (`writeRecovery` absent).
 *
 * The document (document/startDocument.tsx) keeps the unlocked-workbook
 * rules on top of whatever this returns: no recovery copy for it, ever.
 */
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import type { WorkbookFile } from '../../../../../../sheets/src/shared/desktop-api'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import type { EditorDocument } from '../../editorKind'
import type { SheetsDocumentContext } from '../workspace/slots'

/** The part of the desktop `SaveContext` the phone fills (the rest is optional there). */
interface PhoneSaveContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  setMessage: (message: string) => void
  openLazyWorkbook: (opened: WorkbookFile) => void | Promise<boolean>
  stashViewRestore: (view: unknown) => void
}

interface PcSaveActions {
  handleSave(
    ctx: PhoneSaveContext,
    mode: 'save' | 'ods',
    quiet?: boolean,
  ): Promise<{ ok: boolean; error?: string }>
}

// Lazy glob, like grid/pcGridModules.ts: save-actions.ts reaches
// WorkbookVisuals.tsx through univer-sync.ts.
const saveActionModules = import.meta.glob<PcSaveActions>(
  '../../../../../../sheets/src/renderer/save-actions.ts',
)

export async function pcSaveActions(): Promise<PcSaveActions> {
  const load = Object.values(saveActionModules)[0]
  if (!load) throw new Error('Desktop save module missing: save-actions.ts')
  return load()
}

export type SheetsSaveActions = Pick<EditorDocument, 'save' | 'share' | 'writeRecovery'>

/** Whether this session can save over its original on the phone (before XLS-T10). */
export function savesInPlace(context: SheetsDocumentContext): boolean {
  const { document } = context.opened
  return document.writable && !document.converted && document.unlocked === undefined
}

export function createSheetsSaveActions(context: SheetsDocumentContext): SheetsSaveActions {
  const { host } = context
  return {
    async save(_doc, forceSaveAs) {
      const grid = context.grid.grid
      if (forceSaveAs || !savesInPlace(context) || !grid) {
        host.showToast({ message: host.translate('sheetsSaveNotYet'), tone: 'error' })
        return false
      }
      const messages: string[] = []
      const result = await (
        await pcSaveActions()
      ).handleSave(
        {
          univerRef: { current: grid.runtime },
          lazyWorkbookRef: grid.lazyWorkbookRef,
          setMessage: (message) => messages.push(message),
          openLazyWorkbook: (file) => grid.load(file).then(() => true),
          stashViewRestore: () => undefined,
        },
        'save',
        true,
      )
      if (!result.ok) {
        host.showToast({ message: host.translate('sheetsSaveFailed'), tone: 'error' })
        return false
      }
      host.markDirty(false)
      host.showToast(host.translate('savedNotice'))
      return true
    },

    async share(doc) {
      await host.client
        .shareFile({
          sessionId: doc.session.sessionId,
          suggestedName: doc.session.name,
          mode: 'original',
        })
        .catch((err: unknown) => {
          if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
          host.showToast({ message: host.translate('sheetsShareFailed'), tone: 'error' })
        })
    },
  }
}
