import { z } from 'zod'
import type { McpCommandMessage } from '../shared/desktop-api'
import {
  describeOperationErrors,
  workbookOperationSchema,
  type WorkbookOperation,
} from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import { normalizeSheetRefs, primaryCellOf, primarySheetId, type SheetRef } from './mcp-sheet-refs'
import type { WorkbookSkillHiding } from './ai/workbook-skill'
import {
  HIDING_UNAVAILABLE,
  hidingOperationError,
  maskSheetCell,
  withoutHiddenHeaders,
  type ReadCell,
} from './hiding/skill-guard'
import type { SheetHidingView } from './hiding/view'

/**
 * Renderer half of the MCP → sheets-grid bridge.
 *
 * The shell main process pushes one command at a time (`sheets:mcp-command`);
 * each command runs against the live Univer workbook through the same executors
 * the built-in AI uses (readers from ai/workbook-readers.ts, the op planner and
 * apply path from op-executor.ts, the save pipeline from save-actions.ts), so
 * external edits land in the edit journal and undo history exactly like
 * in-app/AI ones. Results are reported back correlated by requestId
 * (`sheets:mcp-result`), and once the workbook is mounted the bridge announces
 * `sheets:mcp-ready` — the shell waits for it before accepting a session.
 *
 * No-op when the preload lacks the bridge channels (standalone/dev builds
 * without MCP wiring).
 */

const READY_POLL_MS = 50
/** after the fast window the poll backs off instead of stopping (see below) */
const READY_SLOW_POLL_MS = 1_000
const READY_FAST_WINDOW_MS = 20_000

export interface McpSheetHandlers {
  /** workbook mounted and editable? (drives the ready announce) */
  hasWorkbook: () => boolean
  /** workbook overview: sheets with ids/names/extents, active sheet */
  context: () => unknown
  /** values + formulas for the requested A1 addresses */
  readCells: (addresses: string[], sheetId?: string) => unknown
  /** the workbook's worksheets, for resolving name-addressed ops */
  sheets: () => readonly SheetRef[]
  /** apply a workbook DSL batch (planFromOps + applyChangePlan) */
  applyOps: (ops: WorkbookOperation[], dryRun: boolean) => Promise<unknown>
  /** bring a sheet (and optionally a cell) into view before/after an edit */
  focusSheet: (sheetId: string, address?: string) => void
  /** save to an explicit absolute path (dialog-free) */
  saveTo: (
    path: string,
    overwrite: boolean,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  /**
   * 민감정보 가리기 (the AI skill's hooks, `sheetSkillHiding`): with them, cells read
   * through this bridge are hidden as the in-app AI reads them, and a batch that
   * would reach hidden cells is refused with `hidden_content` before it runs.
   */
  hiding?: WorkbookSkillHiding
}

/** The refusal prefix MCP clients branch on, the command line's `error` value. */
export const HIDDEN_CONTENT = 'hidden_content'

/** A cell value the MCP read hands out: model value, rendered text, formula. */
interface McpCell extends ReadCell {
  readonly display?: unknown
}

/** One cell as a model may read it: a hidden or leaning cell loses its rendered text too. */
function maskMcpCell(
  view: SheetHidingView,
  sheetId: string,
  address: string,
  cell: McpCell,
): McpCell {
  const masked = maskSheetCell(view, sheetId, address, cell)
  if (masked === cell) return cell
  const { display: _display, ...rest } = masked
  return rest
}

/** The workbook overview with header names of a hidden first row left out. */
function overviewOf(view: SheetHidingView, context: unknown): unknown {
  if (!context || typeof context !== 'object') return context
  const info = context as { sheetId?: unknown; selectionColumns?: readonly string[] }
  if (!info.selectionColumns?.length) return context
  // an overview that does not say its sheet cannot be checked: its header names are left out
  if (typeof info.sheetId !== 'string') {
    const { selectionColumns: _unknown, ...rest } = info
    return rest
  }
  return withoutHiddenHeaders(view, { ...info, sheetId: info.sheetId })
}

/**
 * The bridge the editor installs: the live handlers App keeps in a ref (so the
 * bridge never sees stale closures), with the AI skill's hiding hooks, so the
 * in-app and session MCP servers read and edit the grid as the in-app AI does.
 */
export function installLiveSheetsMcpBridge(
  live: { readonly current: McpSheetHandlers | null },
  hiding: WorkbookSkillHiding,
): () => void {
  return installSheetsMcpBridge({
    hasWorkbook: () => live.current?.hasWorkbook() ?? false,
    context: () => live.current?.context(),
    readCells: (addresses, sheetId) => live.current?.readCells(addresses, sheetId) ?? {},
    sheets: () => live.current?.sheets() ?? [],
    focusSheet: (sheetId, address) => live.current?.focusSheet(sheetId, address),
    applyOps: async (ops, dryRun) =>
      (await live.current?.applyOps(ops, dryRun)) ?? { ok: false, reason: 'not ready' },
    saveTo: async (path, overwrite) =>
      (await live.current?.saveTo(path, overwrite)) ?? {
        ok: false,
        error: 'the spreadsheet is not ready',
      },
    hiding,
  })
}

export function installSheetsMcpBridge(handlers: McpSheetHandlers): () => void {
  const api = window.desktopApi
  if (typeof api?.onMcpCommand !== 'function') return () => {}

  /** one command at a time, in arrival order — applies and saves must not interleave */
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  // Announce readiness as soon as the workbook is mounted, then stop polling.
  //
  // The poll must never give up permanently: a cold dev start (vite serving the
  // Univer bundle, the sidecar opening the workbook) can take longer than the
  // fast window, and once the timer has stopped the tab stays unaddressable
  // over MCP for the rest of its life — the grid looks perfectly normal in the
  // UI while every sheet command times out in the shell. Back off instead.
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  const mountedAt = performance.now()
  const announceWhenMounted = (): void => {
    readyTimer = null
    if (disposed) return
    if (handlers.hasWorkbook()) {
      api.signalMcpReady()
      return
    }
    const slow = performance.now() - mountedAt > READY_FAST_WINDOW_MS
    readyTimer = setTimeout(announceWhenMounted, slow ? READY_SLOW_POLL_MS : READY_POLL_MS)
  }
  readyTimer = setTimeout(announceWhenMounted, READY_POLL_MS)

  const off = api.onMcpCommand((message: McpCommandMessage) => {
    queue = queue.then(() => runCommand(message)).catch(() => undefined)
  })

  return () => {
    disposed = true
    if (readyTimer !== null) clearTimeout(readyTimer)
    off()
  }

  /** First schema issue, with the offending op named so the client can fix it. */
  function describeOpError(ops: unknown[], error: z.ZodError): string {
    const text = describeOperationErrors(ops, error)
    return error.issues.some((issue) => issue.path.includes('sheetId'))
      ? `${text}\nCall read_sheet first and use a sheetId from its output.`
      : text
  }

  /**
   * A read's target sheet: the name the caller gave (`sheet`, the CLI's
   * vocabulary) resolved against the open workbook, else the id it passed.
   * Ids are session artifacts, so a name that no longer matches fails loudly
   * instead of reading the wrong sheet.
   */
  function resolveReadSheet(
    name: string | undefined,
    id: string | undefined,
  ): { ok: true; sheetId?: string } | { ok: false; error: string } {
    if (name === undefined) return { ok: true, ...(id === undefined ? {} : { sheetId: id }) }
    const sheets = handlers.sheets()
    if (sheets.some((sheet) => sheet.id === name)) return { ok: true, sheetId: name }
    const match = sheets.find(
      (sheet) => sheet.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (match) return { ok: true, sheetId: match.id }
    const known = sheets.length === 0 ? 'none' : sheets.map((sheet) => sheet.name).join(', ')
    return {
      ok: false,
      error: `no worksheet named "${name}" in this workbook (sheets: ${known}); call read_sheet for the current sheets`,
    }
  }

  /**
   * The hiding view of the open workbook now, or why nothing may be read. Without
   * hooks the bridge has no hiding to apply (a build that does not wire them).
   */
  async function hidingView(): Promise<
    { ok: true; view: SheetHidingView | null } | { ok: false; error: string }
  > {
    const hiding = handlers.hiding
    if (!hiding) return { ok: true, view: null }
    await hiding.prepare()
    const state = hiding.state()
    if (!state.ok) return { ok: false, error: `${HIDDEN_CONTENT}: ${HIDING_UNAVAILABLE}` }
    return { ok: true, view: state.view.active ? state.view : null }
  }

  function activeSheetId(): string | undefined {
    const info = handlers.context() as { sheetId?: unknown } | undefined
    return typeof info?.sheetId === 'string' ? info.sheetId : undefined
  }

  async function runCommand(message: McpCommandMessage): Promise<void> {
    const reply = (ok: boolean, result?: unknown, error?: string): void => {
      api.reportMcpResult({
        requestId: message.requestId,
        ok,
        ...(result !== undefined ? { result } : {}),
        ...(error !== undefined ? { error } : {}),
      })
    }
    try {
      const payload = (message.payload ?? {}) as Record<string, unknown>
      switch (message.command) {
        case 'read_sheet': {
          const addresses = Array.isArray(payload.addresses)
            ? payload.addresses.filter((a): a is string => typeof a === 'string')
            : []
          const resolved = resolveReadSheet(
            typeof payload.sheet === 'string' ? payload.sheet : undefined,
            typeof payload.sheetId === 'string' ? payload.sheetId : undefined,
          )
          if (!resolved.ok) {
            reply(false, undefined, resolved.error)
            return
          }
          const hiding = await hidingView()
          if (!hiding.ok) {
            reply(false, undefined, hiding.error)
            return
          }
          if (addresses.length > 0) {
            const cells = handlers.readCells(addresses, resolved.sheetId) as Record<string, McpCell>
            const view = hiding.view
            const sheetId = resolved.sheetId ?? activeSheetId()
            reply(true, {
              cells:
                view && sheetId !== undefined
                  ? Object.fromEntries(
                      Object.entries(cells).map(([address, cell]) => [
                        address,
                        maskMcpCell(view, sheetId, address, cell),
                      ]),
                    )
                  : cells,
            })
          } else {
            // the overview names the selected columns by their first-row text
            const context = handlers.context()
            reply(true, { context: hiding.view ? overviewOf(hiding.view, context) : context })
          }
          return
        }
        case 'apply_ops': {
          const ops = Array.isArray(payload.ops) ? payload.ops : []
          if (ops.length === 0) {
            reply(false, undefined, 'ops must be a non-empty array')
            return
          }
          // Worksheet names are the stable reference (the CLI's vocabulary);
          // ids remain accepted. Resolved here, in the renderer, because only
          // this process knows the open workbook's sheets.
          const named = normalizeSheetRefs(ops, handlers.sheets())
          if (!named.ok) {
            reply(false, undefined, named.error)
            return
          }
          // Same validation the built-in AI path applies (ai/tools.ts): without
          // it a missing sheetId surfaces later as a cryptic
          // "Unknown sheet: undefined" from the planner instead of naming the op.
          const parsed = z.array(workbookOperationSchema).safeParse(named.ops)
          if (!parsed.success) {
            reply(false, undefined, describeOpError(named.ops, parsed.error))
            return
          }
          const hiding = await hidingView()
          if (!hiding.ok) {
            reply(false, undefined, hiding.error)
            return
          }
          const view = hiding.view
          const refused = view
            ? hidingOperationError(parsed.data, view, handlers.hiding?.operation)
            : null
          if (refused) {
            reply(false, undefined, `${HIDDEN_CONTENT}: ${refused}`)
            return
          }
          const sheetId = primarySheetId(parsed.data)
          const dryRun = payload.dryRun === true
          if (sheetId !== undefined && !dryRun)
            handlers.focusSheet(sheetId, primaryCellOf(parsed.data))
          const outcome = await handlers.applyOps(parsed.data, dryRun)
          reply(true, view ? maskOutcome(view, outcome) : outcome)
          return
        }
        case 'save_sheet': {
          const path = typeof payload.path === 'string' ? payload.path : ''
          const overwrite = payload.overwrite === true
          if (!path) {
            reply(false, undefined, 'save_sheet needs an absolute path')
            return
          }
          const saved = await handlers.saveTo(path, overwrite)
          // a refused save must surface as an error so the agent keeps its session and can retry
          if (!saved.ok) {
            reply(false, undefined, saved.error ?? 'the spreadsheet could not be saved')
            return
          }
          reply(true, saved)
          return
        }
        default:
          reply(false, undefined, `unknown command: ${String(message.command)}`)
      }
    } catch (error: unknown) {
      reply(false, undefined, error instanceof Error ? error.message : String(error))
    }
  }
}

/** The formula values an apply reads back, as a model may read them. */
function maskOutcome(view: SheetHidingView, outcome: unknown): unknown {
  if (!outcome || typeof outcome !== 'object') return outcome
  const values = (outcome as { formulaValues?: unknown }).formulaValues
  if (!Array.isArray(values)) return outcome
  return {
    ...outcome,
    formulaValues: values.map((cell: McpCell & { sheetId?: unknown; address?: unknown }) =>
      typeof cell?.sheetId === 'string' && typeof cell.address === 'string'
        ? maskMcpCell(view, cell.sheetId, cell.address, cell)
        : cell,
    ),
  }
}
