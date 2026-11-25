// Per-document caches of what the annotation feature reads from PDF.js: the markups
// and notes saved on each page (PC annotation-catalog.ts `loadSavedAnnots`, loaded for
// pages in the render window, as the PC loads them for visible pages) and the text
// runs of a page (loaded only while the highlighter tool is on, dropped when it goes
// off). The /Subj reader for recoloring saved markups runs only when asked.
import {
  loadSavedAnnots,
  type PageSavedAnnots,
} from '../../../../../../../pdf/src/renderer/annotation-catalog'
import type { SavedMarkupAnnot } from '../../../../../../../pdf/src/renderer/edit-state'
import type { PdfOpenedDocument } from '../../view'
import { textRunsOf, type PdfTextStyleLike, type TextRun } from './textRuns'

export interface AnnotCatalog {
  readonly model: PdfOpenedDocument
  /** Saved annotations of a page if already loaded. */
  saved(pageIndex: number): PageSavedAnnots | undefined
  ensureSaved(pageIndex: number): Promise<PageSavedAnnots>
  /** Text runs of a page if already loaded. */
  runs(pageIndex: number): readonly TextRun[] | undefined
  ensureRuns(pageIndex: number): Promise<readonly TextRun[]>
  dropRuns(): void
}

export function createAnnotCatalog(model: PdfOpenedDocument, onChange: () => void): AnnotCatalog {
  const saved = new Map<number, PageSavedAnnots>()
  const savedLoads = new Map<number, Promise<PageSavedAnnots>>()
  let runs = new Map<number, readonly TextRun[]>()
  let runLoads = new Map<number, Promise<readonly TextRun[]>>()

  return {
    model,
    saved: (pageIndex) => saved.get(pageIndex),
    ensureSaved(pageIndex) {
      const have = saved.get(pageIndex)
      if (have) return Promise.resolve(have)
      let load = savedLoads.get(pageIndex)
      if (!load) {
        load = loadSavedAnnots(model.proxy, pageIndex).then((result) => {
          saved.set(pageIndex, result)
          onChange()
          return result
        })
        savedLoads.set(pageIndex, load)
      }
      return load
    },
    runs: (pageIndex) => runs.get(pageIndex),
    ensureRuns(pageIndex) {
      const have = runs.get(pageIndex)
      if (have) return Promise.resolve(have)
      let load = runLoads.get(pageIndex)
      if (!load) {
        const owner = runs
        load = (async () => {
          try {
            const page = await model.proxy.getPage(pageIndex + 1)
            const content = await page.getTextContent()
            return textRunsOf(
              content.items,
              content.styles as Record<string, PdfTextStyleLike | undefined>,
            )
          } catch {
            return [] // an unreadable page has nothing to pick
          }
        })().then((result) => {
          if (owner === runs) {
            runs.set(pageIndex, result)
            onChange()
          }
          return result
        })
        runLoads.set(pageIndex, load)
      }
      return load
    },
    dropRuns() {
      runs = new Map()
      runLoads = new Map()
    },
  }
}

/**
 * The /Subj of saved markups (an accepted AI highlight's category) by object number,
 * read from the file the way the PC main process does (`readAnnotSubjects`), so a
 * recolored highlight keeps it. Unreadable → none, as on the PC.
 */
export async function readSubjects(
  bytes: Uint8Array,
  annots: readonly SavedMarkupAnnot[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (annots.length === 0) return out
  try {
    const { readAnnotSubjects } = await import('../../../../../../../pdf/src/main/annot-subjects')
    const list = await readAnnotSubjects(bytes)
    for (const a of annots) {
      const match = list.find((i) => i.pageIndex === a.pageIndex && i.objNum === a.objNum)
      if (match?.subj) out.set(a.objNum, match.subj)
    }
  } catch {
    // recolor without the category, as the PC context menu does when the read fails
  }
  return out
}
