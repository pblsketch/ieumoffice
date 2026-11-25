import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from './editorKind'
import { htmlEditorKinds } from './html'
import { hwpEditorKind } from './hwpKind'
import { markdownEditorKind } from './markdownKind'
import { pdfEditorKinds } from './pdf'
import { readersEditorKinds } from './readers'
import { sheetsEditorKinds } from './sheets'

/**
 * Every editor kind the app can open. Tracks fill the list in their own
 * `editors/<track>/index.ts`; the spreads below are already in place.
 */
export const EDITOR_KINDS: readonly EditorKind[] = [
  hwpEditorKind,
  markdownEditorKind,

  // T1 sheets
  ...sheetsEditorKinds,

  // T2 pdf
  ...pdfEditorKinds,

  // T4 html
  ...htmlEditorKinds,

  // T5 readers(epub, pptx)
  ...readersEditorKinds,
]

/** The first kind that opens `format`, or null when no kind does. */
export function findEditorKind(format: MobileDocFormat): EditorKind | null {
  return EDITOR_KINDS.find((kind) => kind.formats.includes(format)) ?? null
}

/** The kinds' open extensions in registry order, without repeats (picker and open gate). */
export function openableExtensions(): readonly string[] {
  const exts: string[] = []
  for (const kind of EDITOR_KINDS) {
    for (const ext of kind.openExtensions) {
      if (!exts.includes(ext)) exts.push(ext)
    }
  }
  return exts
}
