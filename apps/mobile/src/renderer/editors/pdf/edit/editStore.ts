// The pending edits of one open PDF: the PC edit-state types (apps/pdf/src/renderer/
// edit-state.ts) written only through the PC op registry (edit-ops), with the PC
// undo unit — a full snapshot pushed before each applied batch, 50 steps, and a
// coalesce key that folds repeats into one step (PC App.tsx `pushUndo`/`undo`/`redo`).
import { planEditOps, reduceEditOps } from '../../../../../../pdf/src/renderer/edit-ops'
import type { EditSnapshot } from '../../../../../../pdf/src/renderer/edit-state'
import type { Op, OpContext, PlanResult } from '../../../../../../pdf/src/renderer/edit-ops'
import type { PdfDispatchOptions } from './types'

/** PC keeps the last 50 snapshots (`prev.slice(-49)` plus the new one). */
export const PDF_UNDO_LIMIT = 50

export function emptyEditSnapshot(): EditSnapshot {
  return {
    markups: [],
    annotDeletes: [],
    noteEdits: [],
    drawings: [],
    textEdits: [],
    textInserts: [],
    imageEdits: [],
    stampCfg: null,
    formEdits: new Map(),
    formFields: [],
    formWidgetEdits: new Map(),
    blankPages: [],
    rotations: new Map(),
    deleted: new Set(),
    order: null,
    metadata: null,
  }
}

/**
 * Whether the snapshot holds anything a save writes. Watermark/header-footer
 * stamps (`stampCfg`) are not part of the mobile editor (spec 4) and the save
 * request never carries them, so they do not count here either.
 */
export function snapshotHasEdits(s: EditSnapshot): boolean {
  return (
    s.markups.length > 0 ||
    s.annotDeletes.length > 0 ||
    s.noteEdits.length > 0 ||
    s.drawings.length > 0 ||
    s.textEdits.length > 0 ||
    s.textInserts.length > 0 ||
    s.imageEdits.length > 0 ||
    s.formEdits.size > 0 ||
    s.formFields.length > 0 ||
    s.formWidgetEdits.size > 0 ||
    s.blankPages.length > 0 ||
    s.rotations.size > 0 ||
    s.deleted.size > 0 ||
    s.order !== null ||
    s.metadata !== null
  )
}

/** PC record id format (`newId` in App.tsx). */
export function newEditId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export interface PdfEditStore {
  getSnapshot(): EditSnapshot
  subscribe(listener: () => void): () => void
  /** Validates the whole batch (PC `planEditOps`) and applies it as one undo step. */
  dispatch(ops: Op[], options?: PdfDispatchOptions): PlanResult
  /** Plans the batch against the current edits without applying it (PC `applyOps` dry run). */
  plan(ops: Op[]): PlanResult
  /** The snapshots Undo would restore, oldest first (the AI run's undo-as-one check reads them). */
  undoSnapshots(): readonly EditSnapshot[]
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  hasEdits(): boolean
  /** Nothing pending and no history: after a save or a reload from new bytes. */
  reset(): void
  /** While locked (a save is writing), dispatch, undo and redo change nothing. */
  setLocked(locked: boolean): void
}

export interface PdfEditStoreOptions {
  /** The op context of the next plan (read-only flag, page count, claimed images…). */
  readonly context: (snapshot: EditSnapshot) => OpContext
  readonly newId?: () => string
}

function refused(ops: Op[], error: string): PlanResult {
  return {
    ops: [],
    records: [],
    touched: new Set(),
    failures: ops.length > 0 ? [{ index: 0, op: ops[0]!, error }] : [],
  }
}

export function createPdfEditStore(options: PdfEditStoreOptions): PdfEditStore {
  const newId = options.newId ?? newEditId
  let state = emptyEditSnapshot()
  let undoStack: EditSnapshot[] = []
  let redoStack: EditSnapshot[] = []
  let coalesceKey: string | null = null
  let locked = false
  const listeners = new Set<() => void>()

  const commit = (next: EditSnapshot) => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(ops, dispatchOptions) {
      if (locked) return refused(ops, 'The document is being saved; try again when the save ends')
      const plan = planEditOps(ops, options.context(state), newId)
      if (plan.failures.length > 0 || plan.ops.length === 0) return plan
      const key = dispatchOptions?.coalesceKey
      if (!(key && coalesceKey === key)) {
        undoStack = [...undoStack.slice(-(PDF_UNDO_LIMIT - 1)), state]
      }
      coalesceKey = key ?? null
      redoStack = []
      commit(reduceEditOps(state, plan.ops))
      return plan
    },
    plan: (ops) => planEditOps(ops, options.context(state), newId),
    undoSnapshots: () => undoStack,
    undo() {
      const top = undoStack[undoStack.length - 1]
      if (locked || !top) return false
      undoStack = undoStack.slice(0, -1)
      redoStack = [...redoStack, state]
      coalesceKey = null
      commit(top)
      return true
    },
    redo() {
      const top = redoStack[redoStack.length - 1]
      if (locked || !top) return false
      redoStack = redoStack.slice(0, -1)
      undoStack = [...undoStack, state]
      coalesceKey = null
      commit(top)
      return true
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    hasEdits: () => snapshotHasEdits(state),
    reset() {
      undoStack = []
      redoStack = []
      coalesceKey = null
      commit(emptyEditSnapshot())
    },
    setLocked(next) {
      locked = next
    },
  }
}
