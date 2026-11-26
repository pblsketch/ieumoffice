/**
 * Markdown → Word, ODT and HWPX on the phone, the same way as the PC app and the
 * `convert` command (decision 0135): the Markdown editor's parser and Word
 * exporter make the docx; ODT is that docx through `docxToOdt` (as the PC ODT
 * export), HWPX is that docx through `docx2hwp` with the HWP document look. All
 * of it is loaded only when a conversion runs, so it stays out of the app's
 * start-up bundle.
 *
 * Images: inline `data:` pictures (the only kind the phone editor makes) are
 * carried over; linked ones fall back to their alt text, as in the PC export.
 */
import type { ConversionReport } from '@genoffice/odt-engine'
import { loadRhwpEngine } from './rhwpEngine'

export interface MarkdownToHwpResult {
  readonly bytes: Uint8Array
  /** How many kinds of content could not be carried over exactly. */
  readonly lossCount: number
}

export interface MarkdownToOdtResult {
  readonly bytes: Uint8Array
  /** What the ODT changes or leaves out, by feature; empty when it keeps everything. */
  readonly report: ConversionReport
}

const NO_SLASH_MENU = {
  slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
  slashItems: () => [],
}

/** Picture types the Word exporter takes; others are redrawn as PNG. */
const WORD_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const
type WordPictureType = (typeof WORD_PICTURE_TYPES)[number]

/** The picture behind a `data:` image source, for the Word exporter. */
async function dataImage(src: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(src)
  if (!match) return null
  const [, type, data] = match
  try {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type }))
    try {
      const size = { widthPx: bitmap.width, heightPx: bitmap.height }
      const mime = type.toLowerCase()
      if ((WORD_PICTURE_TYPES as readonly string[]).includes(mime)) {
        return { base64: data, mime: mime as WordPictureType, ...size }
      }
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      const png = canvas.toDataURL('image/png').split(',')[1] ?? ''
      return png ? { base64: png, mime: 'image/png' as const, ...size } : null
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

/** The Markdown as a Word document (.docx), built by the PC Markdown editor's Word export. */
export async function markdownToDocx(markdown: string): Promise<Uint8Array> {
  const [{ Editor }, extensions, ops, docxExport] = await Promise.all([
    import('@tiptap/core'),
    import('../../../../markdown/src/renderer/editor/extensions'),
    import('../../../../markdown/src/renderer/editor/ops'),
    import('../../../../markdown/src/renderer/export/docxExport'),
  ])
  const editor = new Editor({
    extensions: extensions.buildExtensions(NO_SLASH_MENU as never),
    content: '',
  })
  try {
    // a UTF-8 BOM would otherwise sit in front of a leading heading
    const nodes = ops.parseMarkdownToNodes(editor, markdown.replace(/^\uFEFF/, ''))
    editor.commands.setContent({ type: 'doc', content: nodes.map((n) => n.toJSON()) })
    return await docxExport.exportDocxBytes(editor.getJSON(), dataImage)
  } finally {
    editor.destroy()
  }
}

/** The Markdown as an ODT: its Word document converted by `docxToOdt`, as the PC ODT export does. */
export async function markdownToOdt(markdown: string): Promise<MarkdownToOdtResult> {
  const [docx, { docxToOdt }] = await Promise.all([
    markdownToDocx(markdown),
    import('@genoffice/odt-engine'),
  ])
  const { odtBytes, report } = await docxToOdt(docx)
  return { bytes: odtBytes, report }
}

export async function markdownToHwpx(markdown: string): Promise<MarkdownToHwpResult> {
  const [docx, docx2hwp] = await Promise.all([
    markdownToDocx(markdown),
    import('@genoffice/docx2hwp'),
  ])
  // The flow view has already started the engine (same module); start() then only reuses it.
  await loadRhwpEngine()
  const engine = await docx2hwp.HwpEngine.start(new Uint8Array(0))
  const { bytes, losses } = await docx2hwp.docxToHwp(docx, 'hwpx', engine, { look: 'hangul' })
  return { bytes, lossCount: losses.length }
}
