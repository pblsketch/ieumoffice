import { useEffect, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { translateMobile } from '../../../i18n'
import './pptxOpening.css'

/** Opening that ends within this time shows nothing (design system 5.12). */
export const PPTX_OPENING_DELAY_MS = 300

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * The page-shaped placeholder with "Opening…", shown once opening has taken longer than
 * the delay counted from `since`. Light on purpose: the kind file draws it before the
 * reader chunk has loaded.
 */
export function PptxOpening({
  lang,
  since,
  delayMs = PPTX_OPENING_DELAY_MS,
}: {
  readonly lang: Lang
  readonly since: number
  readonly delayMs?: number
}) {
  const [visible, setVisible] = useState(() => now() - since >= delayMs)
  useEffect(() => {
    if (visible) return
    const timer = setTimeout(() => setVisible(true), Math.max(0, since + delayMs - now()))
    return () => clearTimeout(timer)
  }, [visible, since, delayMs])

  if (!visible) return <div className="mobile-pptx-opening" aria-busy="true" />
  return (
    <div className="mobile-pptx-opening" aria-busy="true" data-testid="pptx-opening">
      <div className="mobile-pptx-opening-page" aria-hidden="true" />
      <p className="mobile-pptx-opening-text" role="status">
        {translateMobile(lang, 'readersOpening')}
      </p>
    </div>
  )
}
