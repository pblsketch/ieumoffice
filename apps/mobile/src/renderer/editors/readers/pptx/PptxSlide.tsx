import { Component, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { SlideThumb } from '../../../../../../slides/src/renderer/SlideThumb'
import type { PptxSlideEntry } from './pptxDocument'

/** A drawing error inside the PC painter shows the slide's "cannot show" text instead. */
class SlideDrawBoundary extends Component<
  { readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface PptxSlideProps {
  readonly entry: PptxSlideEntry | undefined
  /** Width on screen (px) */
  readonly width: number
  /** Height / width of the deck's slides */
  readonly aspect: number
  /** Accessible name of the slide picture ("Slide 3 / 24") */
  readonly label: string
  /** The slide's words, for screen readers only */
  readonly text: string
  readonly failedText: string
}

/**
 * One slide drawn with the PC slides app's painter. The slide's colors are document data;
 * only the surround uses app tokens. Before the render data exists the slide's box is empty.
 */
export function PptxSlide({ entry, width, aspect, label, text, failedText }: PptxSlideProps) {
  const height = Math.round(width * aspect)
  const failed = (
    <div className="mobile-pptx-slide-failed" style={{ width, height }} role="note">
      {failedText}
    </div>
  )
  return (
    <div className="mobile-pptx-slide" style={{ width, height }} data-testid="pptx-slide">
      <div className="mobile-pptx-slide-picture" role="img" aria-label={label}>
        {entry?.failed ? (
          failed
        ) : entry?.slide ? (
          <SlideDrawBoundary fallback={failed}>
            <SlideThumb slide={entry.slide} images={entry.images} width={width} />
          </SlideDrawBoundary>
        ) : null}
      </div>
      {text && <div className="mobile-sr-only">{text}</div>}
    </div>
  )
}

export interface ElementSize {
  readonly width: number
  readonly height: number
}

/** Size of an element: measured on mount, on window resize and through ResizeObserver when present. */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref])
  return size
}

/**
 * Width of a slide fitted into a box: the full width, or less when the height would not fit
 * (landscape). A box not measured yet (0) falls back to the window width.
 */
export function fittedSlideWidth(box: ElementSize, aspect: number): number {
  const width = box.width > 0 ? box.width : typeof window === 'undefined' ? 360 : window.innerWidth
  const byHeight = box.height > 0 && aspect > 0 ? box.height / aspect : Infinity
  return Math.max(1, Math.floor(Math.min(width, byHeight)))
}
