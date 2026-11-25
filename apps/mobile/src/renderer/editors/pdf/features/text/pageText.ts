// Per-document page text for the Text box tool: the shared search index entries
// (PC search.ts, extracted once per document and shared with Find), the PC paragraph
// blocks (text-block.ts groupPageBlocks) and the page fonts' names, each built on the
// first tap of a page and kept for that document only.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  SearchIndex,
  SearchIndexCache,
  PageEntry,
} from '../../../../../../../pdf/src/renderer/search'
import { groupPageBlocks, type TextBlock } from '../../../../../../../pdf/src/renderer/text-block'
import { loadPageFontNames, type PageFontNames } from './pageFonts'

export interface PageText {
  readonly proxy: PDFDocumentProxy
  entry(pageIndex: number): Promise<PageEntry | undefined>
  blocks(pageIndex: number): Promise<TextBlock[]>
  /** The blocks already built for the page (the overflow check of a commit). */
  blocksNow(pageIndex: number): TextBlock[] | undefined
  fontNames(pageIndex: number): Promise<PageFontNames>
}

export function createPageText(model: {
  readonly proxy: PDFDocumentProxy
  readonly searchIndex: SearchIndexCache
}): PageText {
  let index: Promise<SearchIndex> | null = null
  const blocks = new Map<number, TextBlock[]>()
  const fonts = new Map<number, Promise<PageFontNames>>()
  const entry = async (pageIndex: number) => {
    index ??= model.searchIndex.get(model.proxy)
    return (await index)[pageIndex]
  }
  return {
    proxy: model.proxy,
    entry,
    async blocks(pageIndex) {
      let found = blocks.get(pageIndex)
      if (!found) {
        const e = await entry(pageIndex)
        found = blocks.get(pageIndex) ?? (e ? groupPageBlocks(e) : [])
        blocks.set(pageIndex, found)
      }
      return found
    },
    blocksNow: (pageIndex) => blocks.get(pageIndex),
    fontNames(pageIndex) {
      let found = fonts.get(pageIndex)
      if (!found) {
        found = entry(pageIndex).then((e) =>
          loadPageFontNames(
            model.proxy,
            pageIndex,
            new Set((e?.items ?? []).flatMap((it) => (it.font ? [it.font] : []))),
          ),
        )
        fonts.set(pageIndex, found)
      }
      return found
    },
  }
}
