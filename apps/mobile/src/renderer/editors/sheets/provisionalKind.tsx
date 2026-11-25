/**
 * PROVISIONAL spreadsheet kind (XLS-T2 grid prototype). It opens .xlsx, .xlsm
 * and .xls in the phone's Univer grid so the grid can be tried from the file
 * picker and the home list. It does not save, share an edited copy, write
 * recovery copies or offer AI yet; the full kind replaces this file.
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
  formats: ['xlsx', 'xlsm', 'xls'],
  openExtensions: ['xlsx', 'xlsm', 'xls'],
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

function startSheetsDocument(host: EditorHost, opened: OpenedSheetsWorkbook): EditorDocument {
  const gridRef: { current: SheetsGridHandle | null } = { current: null }

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
