/**
 * The parity cases: what each run (PC reference, mobile engine) is asked to
 * do. Source PDFs are referenced by file name inside the run folder, so both
 * runs read the exact same bytes. Plain data with type-only imports, loaded
 * by both runs.
 */
import type { SavePdfRequest } from '../../../pdf/src/shared/ipc'

export type ParityCase =
  | { name: string; kind: 'save'; source: string; request: SavePdfRequest }
  | { name: string; kind: 'apply'; source: string; request: SavePdfRequest }
  | { name: string; kind: 'hasEdits'; request: SavePdfRequest }
  | { name: string; kind: 'insertPdf'; source: string; other: string; afterPageIndex: number }
  | { name: string; kind: 'insertBlankPage'; source: string; afterPageIndex: number }
  | { name: string; kind: 'blankPdf' }
  | { name: string; kind: 'flatten'; source: string }
  | { name: string; kind: 'strip'; source: string }
  | {
      name: string
      kind: 'canDraw'
      text: string
      font?: string
      bold?: boolean
      italic?: boolean
    }
  | { name: string; kind: 'listEditFonts' }

/** What a run produced for one case. Bytes travel as a file next to the JSON. */
export type ParityOutcome =
  { ok: true; bytesFile?: string; value?: unknown } | { ok: false; message: string }

export interface ParityManifest {
  cases: ParityCase[]
}

export const MANIFEST_FILE = 'manifest.json'
export const PC_RESULTS_FILE = 'pc-results.json'

/** Random seed of the case at `index`: the stream restarts for every case in both runs */
export const seedOf = (index: number): number => 0x5eed0000 + index
