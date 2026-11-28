/**
 * Pure EPUB-to-print-HTML assembler for headless PDF export.
 *
 * Reads all spine chapters from an opened `EpubBook`, collects internal CSS
 * stylesheets, strips script/event content, inlines archive images as `data:`
 * URIs, and joins chapters with page breaks so Chromium's `printToPDF` can
 * render the book inside an offline, script-free hidden window.
 */
import { resolveHref, type EpubBook } from '@genoffice/epub-engine'

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

function guessMime(path: string, manifestMime?: string): string {
  if (manifestMime && manifestMime.includes('/')) return manifestMime
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  return IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Remove `<script>...</script>` blocks and inline `on*=` attributes. */
function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/** Extract inner HTML of `<body>...</body>`, or fall back to full markup without `<head>`. */
function extractBodyInner(xhtml: string): string {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)
  if (bodyMatch) return bodyMatch[1] ?? ''
  return xhtml
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
}

/** Extract `<style>` blocks and linked CSS `href`s from a chapter document. */
function extractStyles(xhtml: string): { inlineStyles: string[]; linkedHrefs: string[] } {
  const inlineStyles: string[] = []
  const linkedHrefs: string[] = []
  for (const m of xhtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1]) inlineStyles.push(m[1])
  }
  for (const m of xhtml.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/\brel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(tag)) continue
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)
    if (hrefMatch?.[1]) linkedHrefs.push(hrefMatch[1])
  }
  return { inlineStyles, linkedHrefs }
}

/**
 * Assemble a self-contained, offline print HTML document from an opened EPUB book.
 * Never fetches network resources; every referenced internal image is inlined as a `data:` URI.
 */
export async function buildEpubPrintHtml(book: EpubBook): Promise<string> {
  const mimeByPath = new Map<string, string>()
  for (const item of book.manifest) {
    if (item.path) mimeByPath.set(item.path, item.mediaType)
  }

  const dataUriCache = new Map<string, string | null>()
  async function toDataUri(basePath: string, rawRef: string): Promise<string | null> {
    const trimmed = rawRef.trim()
    if (!trimmed || /^data:/i.test(trimmed)) return trimmed || null
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null
    const resolved = resolveHref(basePath, trimmed)
    if (!resolved || !resolved.path || !book.has(resolved.path)) return null
    const targetPath = resolved.path
    if (dataUriCache.has(targetPath)) return dataUriCache.get(targetPath) ?? null
    const bytes = await book.readForRendering(targetPath)
    if (!bytes) {
      dataUriCache.set(targetPath, null)
      return null
    }
    const mime = guessMime(targetPath, mimeByPath.get(targetPath))
    const uri = `data:${mime};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`
    dataUriCache.set(targetPath, uri)
    return uri
  }

  const seenCss = new Set<string>()
  const styles: string[] = []
  const sections: string[] = []

  const linearItems = book.spine.items.filter((item) => item.linear !== false)
  const items = linearItems.length > 0 ? linearItems : book.spine.items

  for (const item of items) {
    const decoded = await book.readText(item.path)
    if (!decoded) continue
    const raw = stripScripts(decoded.text)
    const { inlineStyles, linkedHrefs } = extractStyles(raw)
    for (const href of linkedHrefs) {
      const resolved = resolveHref(item.path, href)
      if (!resolved || !resolved.path || seenCss.has(resolved.path) || !book.has(resolved.path))
        continue
      const cssPath = resolved.path
      seenCss.add(cssPath)
      const cssDoc = await book.readText(cssPath)
      if (cssDoc) styles.push(cssDoc.text.replace(/@import\b[^;]+;/gi, ''))
    }
    for (const inlineCss of inlineStyles) {
      styles.push(inlineCss.replace(/@import\b[^;]+;/gi, ''))
    }

    let body = extractBodyInner(raw)
    // Inline src / xlink:href / href on <img ...> and <image ...> tags
    const matches = [...body.matchAll(/<(img|image)\b[^>]*>/gi)]
    if (matches.length > 0) {
      let out = ''
      let cursor = 0
      for (const m of matches) {
        const start = m.index ?? 0
        out += body.slice(cursor, start)
        const tag = m[0]
        const attrRe = /\b(src|xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
        let replaced = ''
        let attrCursor = 0
        for (const am of tag.matchAll(attrRe)) {
          const aStart = am.index ?? 0
          replaced += tag.slice(attrCursor, aStart)
          const attrName = am[1]!
          const val = am[2] ?? am[3] ?? ''
          const inlined = await toDataUri(item.path, val)
          if (inlined) replaced += `${attrName}="${inlined}"`
          else replaced += `${attrName}=""`
          attrCursor = aStart + am[0].length
        }
        replaced += tag.slice(attrCursor)
        out += replaced
        cursor = start + tag.length
      }
      out += body.slice(cursor)
      body = out
    }

    sections.push(`<section class="epub-chapter">${body}</section>`)
  }

  const title = escapeHtml(book.metadata.title || 'Book')
  const lang = escapeHtml(book.metadata.languages[0] || 'und')
  const dir = book.spine.pageProgressionDirection === 'rtl' ? 'rtl' : 'ltr'
  const baseCss = [
    '@page { size: A4; margin: 18mm 16mm; }',
    'html, body { margin: 0; padding: 0; background: #ffffff; color: #111111; font-family: Georgia, "Noto Serif", "Malgun Gothic", serif; line-height: 1.65; }',
    'img, svg { max-width: 100%; height: auto; }',
    'pre, code { white-space: pre-wrap; word-break: break-word; }',
    'table { border-collapse: collapse; max-width: 100%; }',
    '.epub-chapter { page-break-before: always; break-before: page; }',
    '.epub-chapter:first-child { page-break-before: auto; break-before: auto; }',
  ].join('\n')

  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:;">',
    `<title>${title}</title>`,
    `<style>${baseCss}</style>`,
    ...styles.map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`),
    '</head>',
    '<body>',
    ...sections,
    '</body>',
    '</html>',
  ].join('\n')
}
