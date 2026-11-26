/**
 * PROTOTYPE edit recording (XLS-T3): cell value and number-format edits go
 * into the session's edit journal with the desktop's own recorders, so the
 * desktop save flow has something to save on the phone. It is the value part
 * of the desktop App's `CommandExecuted` journal listener
 * (apps/sheets/src/renderer/App.tsx): the same suppression and formula-option
 * filters, the same `recordSetRangeValues` / `recordSetNumfmt` /
 * `recordRemoveNumfmt` calls. Structural, style-only, sheet, filter and other
 * mutations come with the grid editing task.
 */
import {
  recordRemoveNumfmt,
  recordSetNumfmt,
  recordSetRangeValues,
} from '../../../../../../sheets/src/renderer/edit-journal'
import { sharedFormulaResolverFor } from '../../../../../../sheets/src/renderer/shared-formula-journal'
import {
  journalSuppression,
  type LazyWorkbookState,
  type UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'

// The desktop's mutation ids (apps/sheets/src/renderer/app-constants.ts, not
// imported: that file reaches WorkbookVisuals.tsx, see grid/pcGridModules.ts).
const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values'
const SET_NUMFMT_MUTATION = 'sheet.mutation.set.numfmt'
const REMOVE_NUMFMT_MUTATION = 'sheet.mutation.remove.numfmt'

export function installValueJournal(
  runtime: UniverRuntime,
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null },
  onRecorded?: (pending: number) => void,
): () => void {
  const api = runtime.univerAPI
  const disposable = api.addEvent(api.Event.CommandExecuted, (event) => {
    if (journalSuppression.active) return
    const options = event.options as { fromFormula?: boolean; onlyLocal?: boolean } | undefined
    if (options?.fromFormula) return
    if (
      event.id !== SET_RANGE_VALUES_MUTATION &&
      event.id !== SET_NUMFMT_MUTATION &&
      event.id !== REMOVE_NUMFMT_MUTATION
    ) {
      return
    }
    const state = lazyWorkbookRef.current
    const params = event.params as { subUnitId?: string; cellValue?: unknown } | undefined
    if (!state || !params?.subUnitId) return
    if (
      (event.params as { __splitChunk__?: boolean } | undefined)?.__splitChunk__ &&
      options?.onlyLocal
    ) {
      return
    }
    const recorded =
      event.id === SET_NUMFMT_MUTATION
        ? recordSetNumfmt(state.editJournal, params.subUnitId, params as never)
        : event.id === REMOVE_NUMFMT_MUTATION
          ? recordRemoveNumfmt(state.editJournal, params.subUnitId, params as never)
          : recordSetRangeValues(
              state.editJournal,
              params.subUnitId,
              params.cellValue,
              sharedFormulaResolverFor(runtime, params.subUnitId),
            )
    if (recorded.length > 0) onRecorded?.(recorded.length)
  })
  return () => disposable.dispose()
}
