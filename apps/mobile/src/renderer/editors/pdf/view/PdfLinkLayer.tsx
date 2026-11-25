// Link areas of one page: a document link scrolls to its page, an external address
// opens in the system browser the way the app's other external links do. Addresses
// come from the document, so only http, https and mailto are ever followed.
import { useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfRectToCss, type PageGeom } from '../../../../../../pdf/src/renderer/annotations'
import { collectPageLinks } from '../../../../../../pdf/src/renderer/LinkLayer'
import { safeExternalUrl } from './outline'

export interface PdfPageLink {
  readonly rect: [number, number, number, number]
  readonly url: string | null
  readonly dest: unknown
}

/** PC `collectPageLinks`, then only addresses the viewer may follow. */
export function pageLinksOf(annots: unknown[]): PdfPageLink[] {
  const out: PdfPageLink[] = []
  for (const link of collectPageLinks(annots as Parameters<typeof collectPageLinks>[0])) {
    const url = link.url ? safeExternalUrl(link.url) : null
    if (link.url && !url && !link.dest) continue
    out.push({ rect: link.rect, url, dest: url ? null : (link.dest ?? null) })
  }
  return out
}

export function PdfLinkLayer({
  doc,
  pageNo,
  geom,
  scale,
  onGoToDest,
  internalLinkLabel,
}: {
  readonly doc: PDFDocumentProxy
  readonly pageNo: number
  readonly geom: PageGeom
  readonly scale: number
  readonly onGoToDest: (dest: unknown) => void
  /** Accessible name of a link inside the document. */
  readonly internalLinkLabel: string
}) {
  const [links, setLinks] = useState<PdfPageLink[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const page = await doc.getPage(pageNo)
        const annots = (await page.getAnnotations()) as unknown[]
        if (!cancelled) setLinks(pageLinksOf(annots))
      } catch {
        if (!cancelled) setLinks([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNo])

  const boxes = useMemo(
    () => links.map((link) => pdfRectToCss(geom, link.rect, scale)),
    [links, geom, scale],
  )
  if (links.length === 0) return null
  return (
    <div className="m-pdf-link-layer">
      {links.map((link, i) =>
        link.url ? (
          <a
            key={i}
            className="m-pdf-link"
            style={boxes[i]}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.url}
          />
        ) : (
          <button
            key={i}
            type="button"
            className="m-pdf-link"
            style={boxes[i]}
            aria-label={internalLinkLabel}
            onClick={() => onGoToDest(link.dest)}
          />
        ),
      )}
    </div>
  )
}
