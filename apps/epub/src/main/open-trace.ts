import { performance } from 'node:perf_hooks'

let serial = 0
type EpubOpenStage =
  | 'total'
  | 'stat'
  | 'read-small-file'
  | 'parse-small-file'
  | 'snapshot'
  | 'zip-and-metadata'
  | 'document-hash'
/** Retain only the last duration per stage, with no file path or document content. */
export function traceEpubOpen() {
  const operation = ++serial
  const began = performance.now()
  return async function stage<T>(name: EpubOpenStage, work: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await work()
    } finally {
      const end = performance.now()
      const label = `ieum.epub.open.${name}`
      try {
        performance.clearMeasures(label)
        performance.measure(label, { start, end, detail: { operation, elapsedMs: end - began } })
      } catch {
        // Timing diagnostics must never change a document-opening result.
      }
    }
  }
}
