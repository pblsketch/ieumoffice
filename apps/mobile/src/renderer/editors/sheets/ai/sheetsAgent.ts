/**
 * The spreadsheet tools of the AI on mobile: the desktop workbook skill
 * (apps/sheets/src/renderer/ai/workbook-skill.ts) over the phone's grid, with
 * the same readers, the same `proposeOperations` plan path and the same op
 * executor the desktop's AI uses. Loaded only when the AI runs (AI is off by
 * default on mobile), so none of it is in the app's first load.
 *
 * What the model reads is exactly what the desktop tools send: the desktop
 * defines a column privacy policy (apps/sheets/src/ai/privacy-policy.ts) but
 * calls it nowhere, so the phone does not either. What the phone cannot do
 * is not offered (phoneLimits.ts).
 *
 * One run's applies sit on Univer's undo stack; the run records which entries
 * they pushed (ai-run-receipt.ts, as the desktop's changes card does) and may
 * undo them only while they are still the newest. The changed cells carry
 * the desktop's screen-only marks (ai-change-marks.ts): a canvas extension
 * that never reaches the workbook model, so not the save, the recovery copy
 * or what the AI reads.
 */
import type { AgentSkill, AgentToolCall, ToolExecution } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import { rangeCellCount } from '@genoffice/xlsx-gateway/domain/cell-address'
import { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import type { ApplyOutcome, ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { LifecycleService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core'
import { IRenderManagerService } from '@univerjs/engine-render'
import {
  AiChangeMarksExtension,
  installAiChangeMarks,
  mergeMarkRanges,
  planMarkRanges,
  type AiChangeMarksHandle,
  type AiMarkRanges,
} from '../../../../../../sheets/src/renderer/ai-change-marks'
import {
  joinUndoGuards,
  univerApplyGuard,
  univerRevertOutcome,
  univerRevertVerdict,
  type AiRunUndoGuard,
} from '../../../../../../sheets/src/renderer/ai/ai-run-receipt'
import {
  boundsToA1,
  clampBoundsToExtent,
  columnScopeHeaders,
} from '../../../../../../sheets/src/renderer/ai/selection-scope'
import {
  MAX_READ_RANGE_CELLS,
  type FrozenSelection,
  type SheetsSkillDeps,
} from '../../../../../../sheets/src/renderer/ai/tools'
import { createWorkbookSkill } from '../../../../../../sheets/src/renderer/ai/workbook-skill'
import {
  aiLangDirective,
  setModuleLang,
  t,
} from '../../../../../../sheets/src/renderer/i18n/locale'
import { planStillMatches } from '../../../../../../sheets/src/renderer/lazy-plan'
import { undoStackItems } from '../../../../../../sheets/src/renderer/undo-carry'
import {
  commitActiveCellEditor,
  lazySheetScreenExtent,
  type ActiveWorkbook,
  type LazyWorkbookState,
  type UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { withAiUndoPass } from '../grid/viewModeGuard'
import {
  pcAggregateRange,
  pcAiUniverSync,
  pcFormulaAudit,
  pcOpExecutor,
  pcPlanOperations,
  pcWorkbookReaders,
  pcWorkbookSearch,
  type PcOpExecutorContext,
  type PcPlanContext,
  type PcWorkbookReadContext,
} from './pcAiModules'
import {
  PHONE_PROMPT_NOTE,
  PHONE_UNAVAILABLE_TOOLS,
  SHEETS_EDIT_TOOLS,
  phoneUnavailableOpsError,
} from './phoneLimits'

/** The grid the agent works on (`MobileGrid` carries more; this is what the AI reads). */
export interface SheetsAgentGrid {
  readonly runtime: UniverRuntime
  readonly lazyWorkbookRef: { current: LazyWorkbookState | null }
}

export interface MobileSheetsAgentOptions {
  readonly lang: () => Lang
  /** An apply changed the workbook (the document is dirty; the recovery timer restarts). */
  readonly onEdited: () => void
}

export type SheetsUndoOutcome = 'reverted' | 'partial' | 'refused' | 'expired'

/** What one run changed, and the way to take it back. */
export interface MobileSheetsRunChanges {
  /** places changed as planned: cells, ranges, renames and structural edits */
  readonly places: number
  /** takes the run back in one step, or refuses when something was done since */
  readonly undo: () => Promise<SheetsUndoOutcome>
}

export interface MobileSheetsAgent {
  /** the desktop skill with the phone's limits, without the view/edit gate (the caller wraps it) */
  readonly skill: AgentSkill
  /** the tools that change the document */
  readonly editTools: ReadonlySet<string>
  /** Before a run: commits an open cell editor, freezes the selection, clears the last run's marks. */
  begin(): Promise<void>
  /** After a run: waits for its applies, then reports what it changed (null: nothing). */
  finish(): Promise<MobileSheetsRunChanges | null>
}

function unavailable(): never {
  throw new Error('Not available in the phone app.')
}

/** The in-memory adapter backs the desktop's blank demo workbook; the phone always has a file session. */
function noAdapter(): { readonly current: InMemoryWorkbookAdapter } {
  let adapter: InMemoryWorkbookAdapter | null = null
  return {
    get current() {
      // empty: a reader that falls through to it finds no sheet instead of the desktop's demo data
      adapter ??= new InMemoryWorkbookAdapter({ revision: 0, sheets: [] })
      return adapter
    },
  }
}

const marksByRuntime = new WeakMap<UniverRuntime, AiChangeMarksHandle>()

/**
 * The desktop registers its marks extension when its module loads, before any
 * grid exists. Here the AI chunk loads after the grid drew, so the extension
 * goes onto the live spreadsheet too (later workbook units pick it up from the
 * registry). Marks go when the workbook unit goes (a save swaps it, closing
 * disposes it), as the desktop clears them for another workbook.
 */
function marksFor(runtime: UniverRuntime): AiChangeMarksHandle {
  const known = marksByRuntime.get(runtime)
  if (known) return known
  const handle = installAiChangeMarks(runtime, { onCleared: () => undefined })
  try {
    const injector = runtime.univer.__getInjector()
    const unitId = runtime.univerAPI.getActiveWorkbook()?.getId()
    const main = unitId
      ? injector.get(IRenderManagerService).getRenderById(unitId)?.mainComponent
      : undefined
    const extension = new AiChangeMarksExtension()
    const host = main as
      | {
          getExtensionByKey?(key: string): unknown
          register?(...extensions: AiChangeMarksExtension[]): unknown
        }
      | undefined
    if (host?.register && !host.getExtensionByKey?.(extension.uKey)) host.register(extension)
    injector
      .get(IUniverInstanceService)
      .getTypeOfUnitDisposed$(UniverInstanceType.UNIVER_SHEET)
      .subscribe(() => handle.clear())
    // closing the document disposes the whole Univer without a unit event; its lifecycle ends then
    injector.get(LifecycleService).lifecycle$.subscribe({ complete: () => handle.clear() })
  } catch {
    // no render yet (tests without a canvas): the marks state still follows the run
  }
  marksByRuntime.set(runtime, handle)
  return handle
}

/** Clears the marks of a grid that is going away (the next workbook must not inherit them). */
export function clearSheetsAiMarks(runtime: UniverRuntime): void {
  marksByRuntime.get(runtime)?.clear()
}

/**
 * The selection the run is about, taken when it starts (the desktop's composer
 * scope): a block of cells capped at the data, with header names when it
 * covers whole columns; a single cell is no scope, as on the desktop.
 */
function frozenSelection(grid: SheetsAgentGrid): FrozenSelection | null {
  try {
    const workbook = grid.runtime.univerAPI.getActiveWorkbook()
    const worksheet = workbook?.getActiveSheet()
    const range = workbook?.getActiveRange()
    if (!worksheet || !range) return null
    const bounds = range.getRange()
    if (bounds.endRow <= bounds.startRow && bounds.endColumn <= bounds.startColumn) return null
    const sheetId = worksheet.getSheetId()
    const state = grid.lazyWorkbookRef.current
    const fileExtent = state ? lazySheetScreenExtent(state, sheetId) : null
    const extent = {
      lastRow: Math.max(worksheet.getLastRow(), (fileExtent?.rows ?? 0) - 1),
      lastColumn: Math.max(worksheet.getLastColumn(), (fileExtent?.columns ?? 0) - 1),
    }
    const clamped = clampBoundsToExtent(bounds, extent, {
      rowCount: worksheet.getMaxRows(),
      columnCount: worksheet.getMaxColumns(),
    })
    const columns = columnScopeHeaders(clamped, extent, (column) =>
      String(worksheet.getRange(0, column, 1, 1).getDisplayValue() ?? ''),
    )
    return { a1: boundsToA1(clamped), sheetId, ...(columns ? { columns } : {}) }
  } catch {
    return null
  }
}

export function createMobileSheetsAgent(
  grid: SheetsAgentGrid,
  options: MobileSheetsAgentOptions,
): MobileSheetsAgent {
  const { runtime, lazyWorkbookRef } = grid
  const univerRef = { current: runtime as UniverRuntime | null }
  const adapterRef = noAdapter()
  const readContext: PcWorkbookReadContext = { univerRef, lazyWorkbookRef, adapterRef }
  const lazyPreviewRef: PcPlanContext['lazyPreviewRef'] = { current: null }
  const setMessage = (_message: string): void => undefined
  const marks = marksFor(runtime)

  let scope: FrozenSelection | null = null
  let applies: Promise<boolean>[] = []
  let runMarks: AiMarkRanges = new Map()
  let receipt: { opCount: number; steps: number; guard: AiRunUndoGuard | undefined } = {
    opCount: 0,
    steps: 0,
    guard: undefined,
  }

  function opExecutorContext(
    workbook: ActiveWorkbook,
    state: LazyWorkbookState,
  ): PcOpExecutorContext {
    return {
      runtime,
      workbook,
      state,
      lazyWorkbookRef,
      sparklineDisposablesRef: { current: [] },
      sparklineTimerRef: { current: null },
      shapeEditRef: { current: unavailable },
      chartEditRef: { current: unavailable },
      setMessage,
      // ops the journal records directly (page setup, protection, tables) report the count here
      setPendingEdits: (count) => {
        if (count > 0) options.onEdited()
      },
      visualContext: unavailable,
      pivotContext: unavailable,
      // charts are not drawn live on the phone (the journal leaves chart sync out too)
      queueChartDataSync: () => undefined,
    }
  }

  /** The desktop's handleLazyApply: the stored plan, applied only if the cells still match it. */
  async function lazyApply(
    state: LazyWorkbookState,
    onVerified: () => void,
  ): Promise<ApplyOutcome> {
    const stored = lazyPreviewRef.current
    if (!stored) return { ok: false, reason: t('appApplyTxFailed') }
    if (stored.sessionId !== state.file.sessionId) {
      lazyPreviewRef.current = null
      return { ok: false, reason: t('appPreviewOtherWorkbook') }
    }
    const workbook = runtime.univerAPI.getActiveWorkbook()
    if (!workbook || !workbook.getSheetBySheetId(stored.sheetId)) {
      lazyPreviewRef.current = null
      return { ok: false, reason: t('appPreviewSheetGone') }
    }
    const outcome = await pcOpExecutor.applyChangePlan(
      stored.plan,
      opExecutorContext(workbook, state),
      {
        verifyBeforeApply: () => {
          if (lazyPreviewRef.current !== stored || lazyWorkbookRef.current !== state) {
            return { ok: false, reason: t('appApplyTxFailed') }
          }
          let stillMatches: boolean
          try {
            stillMatches = planStillMatches(
              stored.plan,
              pcAiUniverSync.lazyWorkbookCellReader(workbook),
            )
          } catch {
            stillMatches = false
          }
          if (stillMatches) {
            onVerified()
            return null
          }
          return { ok: false, reason: t('appWorkbookChangedSincePreview') }
        },
      },
    )
    if (outcome.ok) lazyPreviewRef.current = null
    return outcome
  }

  /** The desktop's autoApplySafePlan (file-backed path): apply, record the undo entries, mark the cells. */
  async function autoApplySafePlan(plan: ChangePlan): Promise<ApplyOutcome> {
    if (!(await commitActiveCellEditor(runtime.univerAPI.getActiveWorkbook()))) {
      return { ok: false, reason: t('appApplyTxFailed') }
    }
    const state = lazyWorkbookRef.current
    if (!state) return { ok: false, reason: t('appNoWorkbookOpen') }
    const opCount =
      plan.cellChanges.length +
      plan.formatChanges.length +
      plan.sheetRenames.length +
      plan.structuralChanges.length
    const planned = planMarkRanges(plan)
    let undoBefore: readonly unknown[] = []
    const applying = lazyApply(state, () => {
      undoBefore = undoStackItems(runtime)
    })
    const apply = marks.holdDuring(applying).then((outcome) => {
      if (outcome.ok) {
        const span = univerApplyGuard(undoBefore, undoStackItems(runtime))
        const guard = outcome.undoDropped ? { ...span, complete: false } : span
        receipt = {
          opCount: receipt.opCount + opCount,
          steps: receipt.steps + guard.steps,
          guard: joinUndoGuards(receipt.guard, guard),
        }
        runMarks = mergeMarkRanges(runMarks, planned)
        marks.show(runMarks)
        options.onEdited()
      } else {
        lazyPreviewRef.current = null
      }
      return outcome
    })
    applies.push(apply.then((outcome) => outcome.ok))
    return apply
  }

  const planContext: PcPlanContext = {
    adapterRef,
    univerRef,
    lazyWorkbookRef,
    lazyPreviewRef,
    setPreview: () => undefined,
    autoApplySafePlan,
  }

  const deps: SheetsSkillDeps = {
    getActiveSheetInfo: () => pcWorkbookReaders.getActiveSheetInfo(readContext, scope),
    aggregateRange: (sheetId, bounds) =>
      pcAggregateRange.aggregateWorkbookRange(readContext, sheetId, bounds),
    ensureRangeLoaded: async (range, sheetId) => {
      // the desktop's sheetsSkillDeps().ensureRangeLoaded, file-backed path
      const state = lazyWorkbookRef.current
      if (!state) return true
      if (state.flags.preloadComplete) return true
      const workbook = runtime.univerAPI.getActiveWorkbook()
      const worksheet =
        sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
      if (!worksheet) return false
      if (!state.file.sheets.some((sheet) => sheet.id === worksheet.getSheetId())) return true
      if (rangeCellCount(range) > MAX_READ_RANGE_CELLS) return false
      return pcAiUniverSync.ensureLazyRangeLoaded(
        runtime,
        lazyWorkbookRef,
        worksheet,
        range,
        setMessage,
      )
    },
    readCells: (addresses, sheetId) => pcWorkbookReaders.readCells(readContext, addresses, sheetId),
    readFormats: (addresses, sheetId) =>
      pcWorkbookReaders.readFormats(readContext, addresses, sheetId),
    readSheetFeatures: (sheetId) => pcWorkbookReaders.readSheetFeatures(readContext, sheetId),
    findCells: (findOptions) => pcWorkbookSearch.findWorkbookCells(readContext, findOptions),
    selectRange: (sheetId, bounds) =>
      pcWorkbookSearch.selectWorkbookRange(readContext, sheetId, bounds, setMessage),
    tracePrecedents: (sheetId, address) =>
      pcFormulaAudit.traceWorkbookPrecedents(readContext, sheetId, address),
    traceDependents: (sheetId, address) =>
      pcFormulaAudit.traceWorkbookDependents(readContext, sheetId, address),
    proposeOperations: (operations, summary) => {
      const refused = phoneUnavailableOpsError(operations)
      if (refused) return { ok: false, error: refused }
      if (!lazyWorkbookRef.current) return { ok: false, error: 'No workbook is open.' }
      return pcPlanOperations.proposeOperations(planContext, operations, summary)
    },
    // no attachments and no create_document on the phone: both stay undefined
  }

  const pc = createWorkbookSkill(deps)
  const tools = pc.tools.filter((tool) => !PHONE_UNAVAILABLE_TOOLS.has(tool.name))
  const skill: AgentSkill = {
    id: pc.id,
    // the desktop adds the reply language as the loop's system suffix; here the skill carries it
    get systemPrompt() {
      return pc.systemPrompt + PHONE_PROMPT_NOTE + aiLangDirective()
    },
    tools,
    buildContext: () => pc.buildContext?.() ?? '',
    executeTool: (call: AgentToolCall, signal?: AbortSignal) => {
      if (PHONE_UNAVAILABLE_TOOLS.has(call.name)) {
        const refused: ToolExecution = {
          output: `${call.name} is not available in the phone app.`,
          isError: true,
          mutated: false,
          summary: call.name,
        }
        return refused
      }
      return pc.executeTool(call, signal)
    },
    verifyResponse: pc.verifyResponse
      ? (text, executed) => pc.verifyResponse!(text, executed)
      : undefined,
  }

  return {
    skill,
    editTools: SHEETS_EDIT_TOOLS,
    async begin() {
      setModuleLang(options.lang())
      if (!lazyWorkbookRef.current) throw new Error('The workbook is still loading.')
      // an open cell editor is an edit of its own: commit it before the AI reads
      await commitActiveCellEditor(runtime.univerAPI.getActiveWorkbook())
      applies = []
      runMarks = new Map()
      receipt = { opCount: 0, steps: 0, guard: undefined }
      // a new run: the marks of the last one go
      marks.clear()
      scope = frozenSelection(grid)
    },
    async finish() {
      await Promise.all(applies)
      applies = []
      scope = null
      const { opCount, guard } = receipt
      receipt = { opCount: 0, steps: 0, guard: undefined }
      if (opCount === 0) return null
      return {
        places: opCount,
        async undo() {
          if (!guard || guard.kind !== 'univer') return 'expired'
          // an open cell editor is an edit made after the run: commit it before judging
          await commitActiveCellEditor(runtime.univerAPI.getActiveWorkbook())
          const verdict = univerRevertVerdict(guard, undoStackItems(runtime))
          if (verdict !== 'ok') return verdict
          // the one undo view mode lets through (grid/viewModeGuard.ts)
          await withAiUndoPass(async () => {
            for (let step = 0; step < guard.steps; step += 1) await runtime.univerAPI.undo()
          })
          marks.clear()
          return univerRevertOutcome(guard, undoStackItems(runtime))
        },
      }
    },
  }
}
