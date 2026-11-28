/**
 * Pure batch execution orchestrator for PDF tools v2 (spec 4.1 E, 4.1 C, 4.2 G).
 * Zero Electron dependency so unit tests exercise the exact same state machine
 * that `pdf-tools-window.ts` drives.
 */
import type {
  PdfBatchItemOutcome,
  PdfProgressEvent,
  PdfToolError,
} from '../../shared/pdf-tools-api'

export interface BatchWorkItem {
  id: string
  name: string
  encrypted?: boolean
  unlocked?: boolean
}

export type BatchItemStepResult =
  | {
      status: 'ok' | 'target-not-met'
      outputs: { id: string; name: string; size: number }[]
      achievedBytes?: number
      targetBytes?: number
    }
  | { status: 'skipped' | 'failed'; reason: PdfToolError | 'unlocked-missing' }
  | { status: 'canceled' }

export interface BatchRunResult {
  canceled: boolean
  savedCount: number
  outputs: { id: string; name: string; size: number }[]
  outcomes: PdfBatchItemOutcome[]
}

/**
 * Run `processItem` sequentially over `items`:
 * - Un-unlocked encrypted items are immediately skipped with `reason: 'unlocked-missing'`.
 * - Any item refusal/failure records `skipped` or `failed` and continues to the next item.
 * - Cancellation stops the loop immediately and reports `savedCount` of already-written items.
 */
export async function runBatchItems(
  items: readonly BatchWorkItem[],
  processItem: (
    item: BatchWorkItem,
    index: number,
    reportPage: (done: number, total: number) => void,
  ) => Promise<BatchItemStepResult>,
  options: {
    signal?: AbortSignal
    onProgress?: (ev: PdfProgressEvent) => void
  } = {},
): Promise<BatchRunResult> {
  const outcomes: PdfBatchItemOutcome[] = []
  const outputs: { id: string; name: string; size: number }[] = []
  const fileTotal = items.length
  let savedCount = 0

  for (let i = 0; i < items.length; i++) {
    if (options.signal?.aborted) {
      return { canceled: true, savedCount, outputs, outcomes }
    }
    const item = items[i]!
    options.onProgress?.({
      done: i,
      total: fileTotal,
      fileDone: i,
      fileTotal,
      currentName: item.name,
    })

    if (item.encrypted && !item.unlocked) {
      outcomes.push({
        inputId: item.id,
        name: item.name,
        status: 'skipped',
        reason: 'unlocked-missing',
      })
      continue
    }

    const res = await processItem(item, i, (pageDone, pageTotal) => {
      options.onProgress?.({
        done: pageDone,
        total: pageTotal,
        fileDone: i,
        fileTotal,
        currentName: item.name,
      })
    })

    if (res.status === 'canceled') {
      return { canceled: true, savedCount, outputs, outcomes }
    }

    if (res.status === 'ok' || res.status === 'target-not-met') {
      savedCount += res.outputs.length
      outputs.push(...res.outputs)
      outcomes.push({
        inputId: item.id,
        name: item.name,
        status: res.status,
        outputs: res.outputs,
        ...(res.achievedBytes !== undefined ? { achievedBytes: res.achievedBytes } : {}),
        ...(res.targetBytes !== undefined ? { targetBytes: res.targetBytes } : {}),
      })
    } else if (res.status === 'failed' || res.status === 'skipped') {
      outcomes.push({
        inputId: item.id,
        name: item.name,
        status: res.status,
        reason: res.reason,
      })
    }

    if (options.signal?.aborted) {
      return { canceled: true, savedCount, outputs, outcomes }
    }
  }

  options.onProgress?.({
    done: fileTotal,
    total: fileTotal,
    fileDone: fileTotal,
    fileTotal,
  })
  return { canceled: false, savedCount, outputs, outcomes }
}
