// The opening screen of a book (design system 5.12): nothing for the first 300 ms, then a
// page-shaped placeholder with "opening". Small on purpose: the kind file shows it while the
// reading screen's code is still loading, before any engine code is there.
import { useEffect, useState } from 'react'

/** Opening shorter than this shows nothing. */
export const OPENING_PLACEHOLDER_MS = 300

/** `since`: when the document started opening (Date.now()), so a remount does not restart the wait. */
export function EpubOpening({ since, label }: { readonly since: number; readonly label: string }) {
  const [visible, setVisible] = useState(() => Date.now() - since >= OPENING_PLACEHOLDER_MS)
  useEffect(() => {
    if (visible) return
    const timer = setTimeout(
      () => setVisible(true),
      Math.max(0, OPENING_PLACEHOLDER_MS - (Date.now() - since)),
    )
    return () => clearTimeout(timer)
  }, [since, visible])
  if (!visible) return null
  return (
    <div className="epub-reader-opening" role="status" data-testid="epub-reader-opening">
      <div className="epub-reader-opening-page" aria-hidden="true">
        <span className="epub-reader-opening-line" />
        <span className="epub-reader-opening-line" />
        <span className="epub-reader-opening-line" data-short="true" />
      </div>
      <span className="epub-reader-opening-text">{label}</span>
    </div>
  )
}
