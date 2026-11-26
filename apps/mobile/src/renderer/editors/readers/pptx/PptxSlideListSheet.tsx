import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet } from '../../../components/Sheet'
import type { PptxController } from './pptxDocument'
import { PptxSlide, useElementSize } from './PptxSlide'
import type { PptxTranslate } from './pptxTypes'

/** Without IntersectionObserver, the cells this far around the current slide count as visible. */
const FALLBACK_VISIBLE_SPAN = 6
/** Thumbnail width before the cell is measured. */
const FALLBACK_THUMB_PX = 160

function SlideCell({
  controller,
  index,
  current,
  visible,
  t,
  onPick,
  register,
}: {
  readonly controller: PptxController
  readonly index: number
  readonly current: boolean
  readonly visible: boolean
  readonly t: PptxTranslate
  readonly onPick: (index: number) => void
  readonly register: (index: number, el: HTMLElement | null) => void
}) {
  const cellRef = useRef<HTMLButtonElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    register(index, cellRef.current)
    return () => register(index, null)
  }, [index, register])
  const size = useElementSize(boxRef)
  const hidden = controller.isHidden(index)
  const total = controller.slideCount()
  const width = Math.max(1, Math.floor(size.width > 0 ? size.width : FALLBACK_THUMB_PX))
  const label = t('readersPptxSlideLabel', { n: index + 1 })
  return (
    <li className="mobile-pptx-grid-item">
      <button
        type="button"
        ref={cellRef}
        className="mobile-pptx-grid-cell"
        data-index={index}
        data-hidden={hidden ? 'true' : undefined}
        aria-current={current ? 'true' : undefined}
        onClick={() => onPick(index)}
        data-testid={`pptx-grid-cell-${index}`}
      >
        <div className="mobile-pptx-grid-thumb" ref={boxRef}>
          {visible && (
            <PptxSlide
              entry={controller.entry(index)}
              width={width}
              aspect={controller.aspect()}
              label={t('readersPptxSlideA11y', { current: index + 1, total })}
              text=""
              failedText={t('readersPptxSlideFailed')}
            />
          )}
        </div>
        <span className="mobile-pptx-grid-label">
          <span>{label}</span>
          {hidden && <span className="mobile-pptx-badge">{t('readersPptxHidden')}</span>}
        </span>
      </button>
    </li>
  )
}

/**
 * The slide list: a grid of small slide pictures, drawn only while their cell is on screen.
 * The current slide is marked, hidden slides are dimmed with a badge; a tap goes there.
 */
export function PptxSlideListSheet({
  open,
  controller,
  current,
  t,
  onClose,
  onPick,
}: {
  readonly open: boolean
  readonly controller: PptxController
  readonly current: number
  readonly t: PptxTranslate
  readonly onClose: () => void
  readonly onPick: (index: number) => void
}) {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set())
  const cells = useRef(new Map<number, HTMLElement>())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const count = controller.slideCount()

  // Which cells are on screen
  useEffect(() => {
    if (!open) {
      setVisible(new Set())
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      const around = new Set<number>()
      for (let i = current - FALLBACK_VISIBLE_SPAN; i <= current + FALLBACK_VISIBLE_SPAN; i += 1) {
        if (i >= 0 && i < count) around.add(i)
      }
      setVisible(around)
      return
    }
    const observer = new IntersectionObserver((records) => {
      setVisible((prev) => {
        const next = new Set(prev)
        for (const record of records) {
          const index = Number((record.target as HTMLElement).dataset.index)
          if (record.isIntersecting) next.add(index)
          else next.delete(index)
        }
        return next
      })
    })
    observerRef.current = observer
    for (const el of cells.current.values()) observer.observe(el)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
    // the current slide only seeds the fallback when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count])

  // The visible cells' slides stay built while the sheet is open
  useEffect(() => {
    controller.hold('list', open ? [...visible] : [])
  }, [controller, open, visible])
  useEffect(() => () => controller.hold('list', []), [controller])

  // Bring the current slide's cell into view on open
  useEffect(() => {
    if (!open) return
    cells.current.get(current)?.scrollIntoView?.({ block: 'center' })
    // only when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const register = useCallback((index: number, el: HTMLElement | null) => {
    const known = cells.current.get(index)
    if (known === el) return
    if (known) observerRef.current?.unobserve(known)
    if (el) {
      cells.current.set(index, el)
      observerRef.current?.observe(el)
    } else cells.current.delete(index)
  }, [])

  return (
    <Sheet
      open={open}
      title={t('readersPptxSlideList')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      initialDetent="large"
      testId="pptx-slide-list-sheet"
    >
      <ul className="mobile-pptx-grid">
        {Array.from({ length: count }, (_, index) => (
          <SlideCell
            key={index}
            controller={controller}
            index={index}
            current={index === current}
            visible={visible.has(index)}
            t={t}
            onPick={onPick}
            register={register}
          />
        ))}
      </ul>
    </Sheet>
  )
}
