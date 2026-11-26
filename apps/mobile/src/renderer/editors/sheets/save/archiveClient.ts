/**
 * The gateway's `ArchiveClient` over the in-process engine. The desktop's
 * `XlsxSidecarClient` sends these four commands to the sidecar; the phone
 * sends the same request fields (no `streamPatches`, which the desktop back
 * end does not send either) and adds the in-memory layer's two steps:
 *
 * - after `read_entries`, each extracted file is fetched into memory, so the
 *   gateway's synchronous `readFileSync` finds it;
 * - before `save_archive`, every content file the gateway wrote in memory is
 *   handed to the work folder, where the engine reads it.
 */
import type { ArchiveClient } from '@genoffice/xlsx-gateway/gateway/xlsx-package-io'
import { callSheetsEngine, type SheetsEngineClient } from '../desktop-api/engine'
import type { MobileVfs } from '../node-shims/vfs'

interface ExtractedEntries {
  readonly entries: readonly { readonly name: string; readonly path: string }[]
}

function extractedPaths(result: unknown): readonly string[] {
  const entries = (result as Partial<ExtractedEntries> | null)?.entries
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) =>
    typeof entry === 'object' && entry !== null && typeof entry.path === 'string'
      ? [entry.path]
      : [],
  )
}

export function createMobileArchiveClient(
  client: SheetsEngineClient,
  vfs: MobileVfs,
): ArchiveClient {
  return {
    archiveManifest: (path) => callSheetsEngine(client, 'archive_manifest', { path }),

    async readEntries(input) {
      const result = await callSheetsEngine(client, 'read_entries', {
        path: input.path,
        entries: input.entries,
        outputDir: input.outputDir,
      })
      for (const path of extractedPaths(result)) await vfs.prefetch(path)
      return result
    },

    scanEntries: (input) =>
      callSheetsEngine(client, 'scan_entries', {
        path: input.path,
        entries: input.entries,
        needle: input.needle,
      }),

    async saveArchive(input) {
      for (const content of [...input.replacements, ...input.additions]) {
        await vfs.flush(content.contentPath)
      }
      return callSheetsEngine(client, 'save_archive', {
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        replacements: input.replacements,
        removals: input.removals,
        additions: input.additions,
      })
    },
  }
}
