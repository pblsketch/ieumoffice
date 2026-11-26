/**
 * PROVISIONAL spreadsheet kind (XLS-T2 grid prototype). It opens .xlsx, .xlsm,
 * .xls and .csv in the phone's Univer grid so the grid can be tried from the
 * file picker and the home list. It has no save button, edited-copy sharing,
 * recovery copies or AI yet (the save path runs from the XLS-T3 prototype
 * hook `window.__ieumSheetsSave`); the full kind replaces this file.
 *
 * Nothing heavy loads at app start: the engine session opens in `open()`
 * (desktop API chunk) and the grid (Univer) is a lazy chunk the Workspace
 * suspends on.
 */
import { Suspense, lazy, useMemo } from 'react'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { IconFreezeColumn, IconFreezeRow, IconUnfreeze } from '../../components/icons/sheets'
import { translateMobile } from '../../i18n'
import { EditorShell, type EditorQuickActionItem } from '../../shell/EditorShell'
import type { EditorDocument, EditorHost, EditorKind, EditorWorkspaceProps } from '../editorKind'
import type { SheetsGridHandle, SheetsGridViewProps } from './grid/SheetsGridView'
import type { OpenedSheetsWorkbook } from './session'

const SheetsGridView = lazy(() => import('./grid/SheetsGridView'))

export const provisionalSheetsKind: EditorKind = {
  id: 'sheets',
  formats: ['xlsx', 'xlsm', 'xls', 'csv'],
  openExtensions: ['xlsx', 'xlsm', 'xls', 'csv'],
  editable: true,
  hasAi: false,
  recoveryFormat: () => 'xlsx',
  async open({ session, client, recoveryBytesBase64 }) {
    const { openSheetsWorkbook } = await import('./session')
    const opened = await openSheetsWorkbook({ client, session, recoveryBytesBase64 })
    return {
      noticeKey: 'sheetsProvisionalNotice',
      start: (host) => startSheetsDocument(host, opened),
    }
  },
}

/**
 * Prototype driver hook (XLS-T5, no user interface): the PDF chunk loads only
 * when a preview or emulator script calls it.
 */
function installSheetsPdfProbeHook(): void {
  ;(window as unknown as Record<string, unknown>).__ieumSheetsPdf = {
    run: async (options?: { batchPages?: number; documentName?: string }) =>
      (await import('./pdf/debugHook')).runSheetsPdfProbe(options),
    chunk: async (offset: number, length: number) =>
      (await import('./pdf/debugHook')).readSheetsPdfProbeChunk(offset, length),
    drop: async () => (await import('./pdf/debugHook')).dropSheetsPdfProbe(),
    desktopHtml: async (documentName?: string) =>
      (await import('./pdf/debugHook')).readDesktopPrintHtml(documentName),
  }
}

function startSheetsDocument(host: EditorHost, opened: OpenedSheetsWorkbook): EditorDocument {
  const gridRef: { current: SheetsGridHandle | null } = { current: null }
  installSheetsPdfProbeHook()

  function SheetsWorkspace({ frame, mode, lang, theme }: EditorWorkspaceProps) {
    const t = (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key)
    const freezeItems = useMemo((): EditorQuickActionItem[] => {
      const tr = (key: Parameters<typeof translateMobile>[1]) => translateMobile(lang, key)
      return [
        {
          id: 'freezeTopRow',
          label: tr('sheetsFreezeTopRow'),
          icon: <IconFreezeRow size={19} />,
          onPress: () => gridRef.current?.freeze('row'),
        },
        {
          id: 'freezeFirstColumn',
          label: tr('sheetsFreezeFirstColumn'),
          icon: <IconFreezeColumn size={19} />,
          onPress: () => gridRef.current?.freeze('column'),
        },
        {
          id: 'unfreeze',
          label: tr('sheetsUnfreeze'),
          icon: <IconUnfreeze size={19} />,
          onPress: () => gridRef.current?.freeze('none'),
        },
      ]
    }, [lang])
    const quickActions: EditorQuickActionItem[] = [
      { id: 'undo', label: t('undo'), onPress: () => gridRef.current?.undo() },
      { id: 'redo', label: t('redo'), onPress: () => gridRef.current?.redo() },
    ]
    const gridProps: SheetsGridViewProps = {
      opened,
      host,
      mode,
      lang,
      theme,
      onEnterEdit: frame.onEnterEdit,
      handleRef: gridRef,
    }
    return (
      <EditorShell
        {...frame}
        quickActions={quickActions}
        moreItems={freezeItems}
        viewTools={[]}
        onFitToWidth={() => gridRef.current?.resetZoom()}
      >
        <Suspense
          fallback={
            <div className="m-sheets-loading" role="status">
              {t('sheetsLoading')}
            </div>
          }
        >
          <SheetsGridView {...gridProps} />
        </Suspense>
      </EditorShell>
    )
  }

  return {
    async share(doc) {
      // Provisional: the original file is shared (the grid's edits are not saved yet).
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
    Workspace: SheetsWorkspace,
  }
}
