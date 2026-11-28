import { open } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/**
 * Legacy Office binaries that open as a converted copy: Word 97-2003 (.doc,
 * and its .dot template) in the Word tab, PowerPoint 97-2003 (.ppt) in the
 * slides tab. The original is only read. The copy opens untitled, and its
 * first save asks where, suggesting the converted name beside the original,
 * the way an .xls or .ods opens in the spreadsheet tab (decision 0119).
 */
export const LEGACY_DOC_RE = /\.(doc|dot)$/i
export const LEGACY_PPT_RE = /\.ppt$/i

export type LegacyEditor = 'docs' | 'slides'

export function legacyEditorFor(path: string): LegacyEditor | null {
  if (LEGACY_DOC_RE.test(path)) return 'docs'
  if (LEGACY_PPT_RE.test(path)) return 'slides'
  return null
}

export interface LegacyCopy {
  editor: LegacyEditor
  bytes: Uint8Array
  /** the converted file's name, the original's stem with the new extension */
  fileName: string
  /** where the copy's first save suggests writing: beside the original */
  saveAsDefaultPath: string
  /** the original's extension, lower case without the dot */
  importedFrom: string
}

export type LegacyConvertResult =
  | { ok: true; copy: LegacyCopy }
  | {
      ok: false
      /** `encrypted` has its own advice; anything else is a damaged or unread file */
      reason: 'encrypted' | 'failed'
      /** the original's extension and the one the copy would have had */
      from: string
      to: string
      error: string
    }

const MAX_LEGACY_IMPORT_BYTES = 512 * 1024 * 1024

async function readLegacySource(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Expected a regular file')
    if (info.size > MAX_LEGACY_IMPORT_BYTES) {
      throw new Error('File exceeds the 512 MB import limit')
    }
    return await file.readFile()
  } finally {
    await file.close()
  }
}

/** Read and convert one legacy file; never throws for a file the converter refuses. */
export async function convertLegacyFile(
  filePath: string,
  read: (path: string) => Promise<Uint8Array> = readLegacySource,
): Promise<LegacyConvertResult | null> {
  const editor = legacyEditorFor(filePath)
  if (!editor) return null
  const from = extname(filePath).slice(1).toLowerCase()
  const to = editor === 'docs' ? 'docx' : 'pptx'
  let isEncrypted: (error: unknown) => boolean = () => false
  try {
    const source = new Uint8Array(await read(filePath))
    let bytes: Uint8Array
    if (editor === 'docs') {
      const { convertLegacyDocToDocx, isLegacyDocError } =
        await import('../../../../packages/doc2docx/src')
      isEncrypted = (error) => isLegacyDocError(error) && error.code === 'encrypted'
      bytes = (await convertLegacyDocToDocx(source)).docx
    } else {
      const { convertPptToPptx, LegacyPptError } = await import('../../../../packages/ppt2pptx/src')
      isEncrypted = (error) => error instanceof LegacyPptError && error.code === 'encrypted'
      bytes = (await convertPptToPptx(source)).bytes
    }
    const name = basename(filePath)
    const stem = name.slice(0, name.length - from.length - 1) || name
    const fileName = `${stem}.${to}`
    return {
      ok: true,
      copy: {
        editor,
        bytes,
        fileName,
        saveAsDefaultPath: join(dirname(filePath), fileName),
        importedFrom: from,
      },
    }
  } catch (error) {
    const encrypted = isEncrypted(error)
    return {
      ok: false,
      reason: encrypted ? 'encrypted' : 'failed',
      from,
      to,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
