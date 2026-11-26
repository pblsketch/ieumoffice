/**
 * The drawing copy of one chapter on the phone: what the chapter frame shows.
 *
 * Built in the same order as the PC's `buildChapterHtml` (apps/epub reader):
 * blocks marked with the engine's ids, the book's styles and title from the
 * head in their order, the body, then the PC `sanitizeTree` (scripts, `on…`
 * attributes, `javascript:` addresses, frames, plug-ins, `<base>` removed),
 * then our charset, CSP and view style. Two things differ: there is no
 * `<base>` (the phone has no `epub-asset:` scheme), and every resource the
 * chapter uses is rewritten to a `blob:` URL of the book's zip entry
 * (`resources.ts`), linked stylesheets inlined as `<style>`.
 */
import { hasUrlScheme, openChapter, resolveHref } from '@genoffice/epub-engine/core'
import {
  BLOCK_ATTR,
  VIEW_STYLE_ID,
  markBlocks,
  parseChapter,
  sanitizeTree,
} from '../../../../../../epub/src/renderer/reader/chapter-html'
import type { ReaderBook } from './book'
import { ChapterResources, escapeStyleText } from './resources'

export { BLOCK_ATTR, VIEW_STYLE_ID }

/**
 * The policy of the drawn chapter: no script, no frame, no fetch; pictures,
 * styles and fonts only from the book's `blob:` URLs or `data:`; sound and
 * video not loaded.
 */
export const MOBILE_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  'img-src blob: data:',
  "style-src blob: data: 'unsafe-inline'",
  'font-src blob: data:',
  "media-src 'none'",
].join('; ')

export interface ChapterView {
  spineIndex: number
  /** zip entry path of the chapter */
  path: string
  /** the HTML document text for the frame's `srcdoc` */
  html: string
  /** the chapter is not well-formed (or not valid in its encoding) and was read as HTML */
  broken: boolean
  /** this chapter is pre-paginated (the whole book or its itemref) */
  fixedLayout: boolean
  /** Revokes every `blob:` URL this view made. Calling it again does nothing. */
  release(): void
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

/** SVG presentation attributes that may name a resource with `url(…)`. */
const SVG_URL_ATTRS = new Set([
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
])

/** HTML attributes that load a picture: rewritten. */
const HTML_PICTURE_ATTRS: Readonly<Record<string, readonly string[]>> = {
  img: ['src'],
  video: ['poster'],
}

/** HTML attributes that would load something not served: removed. */
const HTML_REMOVED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  img: ['srcset'],
  source: ['src', 'srcset'],
  audio: ['src'],
  video: ['src'],
  track: ['src'],
  input: ['src'],
  a: ['ping'],
  area: ['ping'],
}

function linkIsStylesheet(el: Element): boolean {
  const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
  return rel.includes('stylesheet') && !rel.includes('alternate')
}

function childByName(parent: Element | null, name: string): Element | null {
  if (!parent) return null
  for (const child of Array.from(parent.children)) {
    if (child.localName.toLowerCase() === name) return child
  }
  return null
}

/** As the PC copies them: attributes a book's CSS may select on, not namespace declarations. */
function copyAttributes(from: Element, to: Element): void {
  for (const attr of Array.from(from.attributes)) {
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
    try {
      to.setAttribute(attr.name, attr.value)
    } catch {
      // a name HTML cannot carry: the attribute is not needed to draw
    }
  }
  const xmlLang = from.getAttribute('xml:lang')
  if (xmlLang && !to.hasAttribute('lang')) to.setAttribute('lang', xmlLang)
}

/** The chapter as the engine reads it: its text, whether it is broken, and its blocks. */
async function readChapter(book: ReaderBook, spineIndex: number) {
  const item = Number.isSafeInteger(spineIndex) ? book.epub.spine.items[spineIndex] : undefined
  if (!item) return null
  const decoded = await book.epub.readText(item.path)
  const source = decoded?.text ?? ''
  const map = openChapter(source)
  const broken = map.broken || !(decoded?.valid ?? false)
  return { item, source, broken, blocks: map.broken || broken ? [] : map.blocks }
}

/**
 * The sanitized chapter document, before resource rewriting and our own head
 * elements: the same steps and order as the PC's `buildChapterHtml`.
 */
export async function assembleChapter(book: ReaderBook, spineIndex: number) {
  const chapter = await readChapter(book, spineIndex)
  if (!chapter) return null
  const parsed = parseChapter(markBlocks(chapter.source, chapter.blocks), chapter.broken)
  const out = document.implementation.createHTMLDocument('')
  // the empty <title> createHTMLDocument adds; the book's own comes below
  out.head.replaceChildren()
  const root = parsed.documentElement
  const isHtmlRoot = root?.localName.toLowerCase() === 'html'
  const srcHead = isHtmlRoot ? childByName(root, 'head') : null
  const srcBody = isHtmlRoot ? childByName(root, 'body') : null
  if (root && isHtmlRoot) copyAttributes(root, out.documentElement)
  if (srcBody) copyAttributes(srcBody, out.body)
  if (srcHead) {
    for (const el of Array.from(srcHead.children)) {
      const name = el.localName.toLowerCase()
      if (name === 'style' || (name === 'link' && linkIsStylesheet(el)) || name === 'title') {
        out.head.appendChild(out.importNode(el, true))
      }
    }
  }
  if (srcBody) {
    for (const node of Array.from(srcBody.childNodes))
      out.body.appendChild(out.importNode(node, true))
  } else if (root && !isHtmlRoot) {
    // a chapter that is a picture (an SVG spine item) is drawn inside the body
    out.body.appendChild(out.importNode(root, true))
  }
  sanitizeTree(out)
  return { ...chapter, doc: out }
}

/** Points every resource of the sanitized chapter at the book's blob URLs, or removes it. */
async function rewriteResources(
  doc: Document,
  chapterPath: string,
  res: ChapterResources,
): Promise<void> {
  const setOrRemove = async (el: Element, attr: Attr, base: string): Promise<void> => {
    const value = await res.ref(base, attr.value)
    if (value === null) el.removeAttributeNode(attr)
    else attr.value = value
  }

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const name = el.localName.toLowerCase()
    const ns = el.namespaceURI

    if (ns === HTML_NS && name === 'link') {
      // only stylesheet links are left by the sanitizer: inline them
      const resolvedPath = linkedSheetPath(el, chapterPath)
      const text = resolvedPath === null ? null : await res.stylesheetText(resolvedPath)
      if (resolvedPath === null || text === null) {
        el.remove()
        continue
      }
      const style = doc.createElement('style')
      const media = el.getAttribute('media')
      if (media) style.setAttribute('media', media)
      style.textContent = escapeStyleText(
        await res.rewriteCss(text, resolvedPath, new Set([resolvedPath])),
      )
      el.replaceWith(style)
      continue
    }

    if (name === 'style') {
      el.textContent = escapeStyleText(await res.rewriteCss(el.textContent ?? '', chapterPath))
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.localName.toLowerCase()
      if (attr.name.toLowerCase() === 'style') {
        attr.value = await res.rewriteCss(attr.value, chapterPath)
        continue
      }
      if (ns === HTML_NS) {
        if (HTML_REMOVED_ATTRS[name]?.includes(attrName)) el.removeAttributeNode(attr)
        else if (HTML_PICTURE_ATTRS[name]?.includes(attrName) || attrName === 'background') {
          await setOrRemove(el, attr, chapterPath)
        }
      } else if (ns === SVG_NS) {
        // every SVG reference but a link (image, use, feImage, pattern, gradient…)
        if (attrName === 'href' && name !== 'a') await setOrRemove(el, attr, chapterPath)
        else if (SVG_URL_ATTRS.has(attrName) && /url\(/i.test(attr.value)) {
          attr.value = await res.rewriteCss(attr.value, chapterPath)
        }
      }
    }
  }
}

function linkedSheetPath(el: Element, chapterPath: string): string | null {
  const href = (el.getAttribute('href') ?? '').trim()
  if (href === '' || hasUrlScheme(href)) return null
  const resolved = resolveHref(chapterPath, href)
  return resolved && resolved.path !== '' ? resolved.path : null
}

/**
 * The drawing copy of the spine item `spineIndex`, with its resources served
 * as `blob:` URLs. Null when there is no such chapter or the book was closed
 * (then no URL of it stays alive).
 */
export async function buildChapterView(
  book: ReaderBook,
  spineIndex: number,
  viewCss = '',
): Promise<ChapterView | null> {
  if (book.disposed) return null
  const record = book.track()
  const release = (): void => book.release(record)
  try {
    const chapter = await assembleChapter(book, spineIndex)
    if (!chapter || book.disposed) {
      release()
      return null
    }
    const { doc, item } = chapter
    await rewriteResources(doc, item.path, new ChapterResources(book.epub, record))
    if (book.disposed) {
      release()
      return null
    }

    // ours, after the clean-up: charset, policy, view settings
    const charset = doc.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    const csp = doc.createElement('meta')
    csp.setAttribute('http-equiv', 'Content-Security-Policy')
    csp.setAttribute('content', MOBILE_FRAME_CSP)
    doc.head.prepend(charset, csp)
    const view = doc.createElement('style')
    view.id = VIEW_STYLE_ID
    view.textContent = viewCss
    doc.head.appendChild(view)

    return {
      spineIndex: item.index,
      path: item.path,
      html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
      broken: chapter.broken,
      fixedLayout: item.fixedLayout,
      release,
    }
  } catch (error) {
    release()
    throw error
  }
}
