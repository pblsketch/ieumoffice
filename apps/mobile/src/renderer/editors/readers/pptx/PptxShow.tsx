import { useCallback, useEffect, useRef, useState } from 'react'
import { IconClose } from '../../../components/MobileIcons'
import { useBackLayer } from '../../../shell/backStack'
import type { PptxController } from './pptxDocument'
import { PptxSlide } from './PptxSlide'
import type { PptxTranslate } from './pptxTypes'
import { useSlideGestures } from './slideGestures'

/** Indices of the slides a show goes through: hidden slides are left out (as in PowerPoint). */
export function visibleSlides(controller: Pick<PptxController, 'slideCount' | 'isHidden'>) {
  const out: number[] = []
  for (let i = 0; i < controller.slideCount(); i += 1) if (!controller.isHidden(i)) out.push(i)
  return out
}

/** Where a show starts: the current slide, else the next shown one, else the first. */
export function showStartStep(sequence: readonly number[], current: number): number {
  const at = sequence.findIndex((index) => index >= current)
  return at >= 0 ? at : 0
}

function windowSize(): { width: number; height: number } {
  return typeof window === 'undefined'
    ? { width: 360, height: 640 }
    : { width: window.innerWidth, height: window.innerHeight }
}

export interface PptxShowProps {
  readonly controller: PptxController
  readonly sequence: readonly number[]
  readonly startStep: number
  readonly t: PptxTranslate
  /** Closes the layer; `lastIndex` is the slide shown last (null after the end screen) */
  readonly onClose: (lastIndex: number | null) => void
}

/**
 * The full-screen slide show: a layer over the app on a black ground, one slide fitted to
 * the screen, swipe or tap to go on. After the last shown slide an end screen; one more
 * step or Back closes it. Asks the web view for full screen when it can, and works as an
 * in-app layer either way. No animations, transitions or media playback.
 */
export function PptxShow({ controller, sequence, startStep, t, onClose }: PptxShowProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  // a step past the last slide is the end screen
  const [step, setStep] = useState(() => Math.min(Math.max(0, startStep), sequence.length - 1))
  const [screen, setScreen] = useState(windowSize)
  const atEnd = step >= sequence.length
  const slideIndex = atEnd ? null : sequence[step]!

  const close = useCallback(() => onClose(slideIndex), [onClose, slideIndex])
  useBackLayer(true, close)

  const next = useCallback(() => {
    if (step >= sequence.length) close()
    else setStep(step + 1)
  }, [close, sequence.length, step])
  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), [])

  useEffect(() => {
    const update = () => setScreen(windowSize())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Full screen when the web view offers it; failure leaves the in-app layer.
  useEffect(() => {
    const layer = layerRef.current
    try {
      const request = layer?.requestFullscreen?.()
      if (request && typeof request.catch === 'function') request.catch(() => {})
    } catch {
      // not allowed here: the layer alone covers the app
    }
    return () => {
      if (typeof document === 'undefined' || !layer || document.fullscreenElement !== layer) return
      try {
        const exit = document.exitFullscreen?.()
        if (exit && typeof exit.catch === 'function') exit.catch(() => {})
      } catch {
        // already left full screen
      }
    }
  }, [])

  // The shown slide and its shown neighbours stay built while the show is open.
  useEffect(() => {
    const held: number[] = []
    for (const s of [step - 1, step, step + 1]) {
      const index = sequence[s]
      if (index !== undefined) held.push(index)
    }
    controller.hold('show', held)
  }, [controller, sequence, step])
  useEffect(() => () => controller.hold('show', []), [controller])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') next()
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
      else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, next, prev])

  const aspect = controller.aspect()
  const width = Math.max(1, Math.floor(Math.min(screen.width, screen.height / aspect)))
  const gestures = useSlideGestures({
    zoomable: false,
    tapZones: 'anywhere',
    onNext: next,
    onPrev: prev,
    slideWidth: width,
    slideHeight: width * aspect,
    resetKey: step,
  })

  const total = controller.slideCount()
  return (
    <div
      ref={layerRef}
      className="mobile-pptx-show"
      role="dialog"
      aria-modal="true"
      aria-label={t('readersPptxPresent')}
      data-testid="pptx-show"
    >
      <div className="mobile-pptx-show-stage" {...gestures.handlers} data-testid="pptx-show-stage">
        {slideIndex === null ? (
          <div className="mobile-pptx-show-end" role="status" data-testid="pptx-show-end">
            <p className="mobile-pptx-show-end-title">{t('readersPptxShowEnd')}</p>
            <p className="mobile-pptx-show-end-hint">{t('readersPptxShowEndHint')}</p>
          </div>
        ) : (
          <PptxSlide
            entry={controller.entry(slideIndex)}
            width={width}
            aspect={aspect}
            label={t('readersPptxSlideA11y', { current: slideIndex + 1, total })}
            text={controller.slideText(slideIndex)}
            failedText={t('readersPptxSlideFailed')}
          />
        )}
      </div>
      <button
        type="button"
        className="mobile-pptx-show-close"
        onClick={close}
        aria-label={t('readersA11yClosePresent')}
        title={t('readersA11yClosePresent')}
        data-testid="pptx-show-close"
      >
        <IconClose size={22} />
      </button>
    </div>
  )
}
