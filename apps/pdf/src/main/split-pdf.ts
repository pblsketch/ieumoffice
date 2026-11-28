/**
 * The split engine moved to @genoffice/pdf-ops (shared with the phone app).
 * This file keeps every name it exported for its importers, and the one
 * helper that works with file paths.
 */
import { join } from 'node:path'

export { executeSplitPlan, readBookmarksFromDoc, readPdfBookmarks } from '@genoffice/pdf-ops'
export type { SplitExecuteOptions, SplitExecutionResult, SplitOutputPart } from '@genoffice/pdf-ops'

/** Pick a collision-free subfolder path under parentDir */
export function uniqueSplitSubfolder(
  parentDir: string,
  folderName: string,
  exists: (candidate: string) => boolean,
): string {
  const base = join(parentDir, folderName)
  if (!exists(base)) return base
  let n = 2
  while (exists(join(parentDir, `${folderName} (${n})`))) n++
  return join(parentDir, `${folderName} (${n})`)
}
