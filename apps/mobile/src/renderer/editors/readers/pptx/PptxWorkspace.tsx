/**
 * The PowerPoint reading screen: one slide at a time inside the shared EditorShell, the
 * notes panel, the slide list and search sheets, and the full-screen show. All deck state
 * lives in the controller (the EditorDocument closure); this component only draws it.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { IconBack, IconChevronDown, IconChevronRight } from '../../../components/MobileIcons'
import {
  IconReaderGrid,
  IconReaderNotes,
  IconReaderPresent,
  IconReaderSearch,
} from '../../../components/icons/readers'
import { translateMobile } from '../../../i18n'
import { EditorShell, type EditorQuickActionItem } from '../../../shell/EditorShell'
import { useViewportLayout } from '../../../shell/useViewportLayout'
import type { EditorHost, EditorWorkspaceProps } from '../../editorKind'
import { useReaderKeepScreenOn } from '../shared/keepScreenOn'
import type { PptxController } from './pptxDocument'
import { PptxOpening } from './PptxOpening'
import { PptxSearchSheet } from './PptxSearchSheet'
import { PptxShow, showStartStep, visibleSlides } from './PptxShow'
import { fittedSlideWidth, PptxSlide, useElementSize } from './PptxSlide'
import { PptxSlideListSheet } from './PptxSlideListSheet'
import type { PptxTranslate } from './pptxTypes'
import { useSlideGestures } from './slideGestures'
import './pptxReader.css'

export interface PptxWorkspaceProps extends EditorWorkspaceProps {
  readonly controller: PptxController
  readonly host: EditorHost
  readonly openingDelayMs: number
}

/** The slide on screen with swipe, edge taps and pinch zoom. */
function SlideStage({
  controller,
  current,
  t,
}: {
  readonly controller: PptxController
  readonly current: number
  readonly t: PptxTranslate
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const box = useElementSize(boxRef)
  const aspect = controller.aspect()
  const width = fittedSlideWidth(box, aspect)
  const total = controller.slideCount()
  const gestures = useSlideGestures({
    zoomable: true,
    tapZones: 'edges',
    onNext: () => controller.goTo(controller.current() + 1),
    onPrev: () => controller.goTo(controller.current() - 1),
    slideWidth: width,
    slideHeight: width * aspect,
    resetKey: current,
  })
  const { zoom, x, y } = gestures.view
  return (
    <div
      className="mobile-pptx-stage"
      {...gestures.handlers}
      data-zoomed={zoom > 1 ? 'true' : undefined}
      data-testid="pptx-stage"
    >
      <div className="mobile-pptx-fit" ref={boxRef}>
        <div
          className="mobile-pptx-zoom"
          style={zoom > 1 ? { transform: `translate(${x}px, ${y}px) scale(${zoom})` } : undefined}
        >
          <PptxSlide
            entry={controller.entry(current)}
            width={width}
            aspect={aspect}
            label={t('readersPptxSlideA11y', { current: current + 1, total })}
            text={controller.slideText(current)}
            failedText={t('readersPptxSlideFailed')}
          />
        </div>
      </div>
    </div>
  )
}

/** Speaker notes of the current slide, collapsible; the open state is remembered. */
function NotesPanel({
  controller,
  current,
  t,
}: {
  readonly controller: PptxController
  readonly current: number
  readonly t: PptxTranslate
}) {
  const bodyId = useId()
  const open = controller.notesOpen()
  const notes = controller.slideNotes(current)
  return (
    <section className="mobile-pptx-notes" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="mobile-pptx-notes-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={t('readersA11yNotes')}
        onClick={() => controller.setNotesOpen(!open)}
        data-testid="pptx-notes-toggle"
      >
        <IconReaderNotes size={18} />
        <span className="mobile-pptx-notes-title">{t('readersPptxNotes')}</span>
        <span className="mobile-pptx-notes-chevron" aria-hidden="true">
          <IconChevronDown size={18} />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="mobile-pptx-notes-body" data-testid="pptx-notes-body">
          {notes ? (
            <p className="mobile-pptx-notes-text">{notes}</p>
          ) : (
            <p className="mobile-pptx-notes-empty">{t('readersPptxNotesEmpty')}</p>
          )}
        </div>
      )}
    </section>
  )
}

export function PptxWorkspace({
  frame,
  lang,
  controller,
  host,
  openingDelayMs,
}: PptxWorkspaceProps) {
  useSyncExternalStore(controller.subscribe, controller.version)
  const t = useCallback<PptxTranslate>((key, params) => translateMobile(lang, key, params), [lang])
  const { isTablet } = useViewportLayout()
  const status = controller.status()
  const count = controller.slideCount()
  const current = controller.current()
  const [listOpen, setListOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [show, setShow] = useState<{ sequence: number[]; start: number } | null>(null)

  // The engine refused the file: say so and leave the screen (spec 3.1)
  const onBackRef = useRef(frame.onBack)
  onBackRef.current = frame.onBack
  useEffect(() => {
    if (status !== 'failed' || !controller.takeFailure()) return
    host.showToast(host.translate('readersErrPptxOpen'))
    onBackRef.current()
  }, [controller, host, status])

  // The current slide and its neighbours stay built; farther ones are released.
  useEffect(() => {
    if (status !== 'ready') return
    controller.hold('view', [current - 1, current, current + 1])
  }, [controller, current, status])
  useEffect(() => () => controller.hold('view', []), [controller])

  const showing = show !== null
  useReaderKeepScreenOn(host.client, status === 'ready' && (count > 0 || showing))

  const openShow = useCallback(() => {
    const sequence = visibleSlides(controller)
    if (sequence.length === 0) {
      host.showToast(host.translate('readersPptxNoVisibleSlides'))
      return
    }
    setShow({ sequence, start: showStartStep(sequence, controller.current()) })
  }, [controller, host])

  const closeShow = useCallback(
    (lastIndex: number | null) => {
      setShow(null)
      if (lastIndex !== null) controller.goTo(lastIndex)
    },
    [controller],
  )

  // Arrow keys turn slides when a keyboard is attached (tablets, DeX); not under a sheet or the show
  const overlayOpen = listOpen || searchOpen || showing
  useEffect(() => {
    if (status !== 'ready' || overlayOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') controller.goTo(controller.current() + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp')
        controller.goTo(controller.current() - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, overlayOpen, status])

  const goFromSheet = useCallback(
    (index: number) => {
      setListOpen(false)
      setSearchOpen(false)
      controller.goTo(index)
    },
    [controller],
  )

  const viewTools = useMemo((): EditorQuickActionItem[] => {
    if (status !== 'ready') return []
    const search: EditorQuickActionItem = {
      id: 'pptxSearch',
      label: t('readersA11ySearch'),
      icon: <IconReaderSearch size={19} />,
      onPress: () => setSearchOpen(true),
    }
    // A deck without slides has nothing to list or show
    if (count === 0) return [search]
    return [
      {
        id: 'pptxSlideList',
        label: t('readersA11ySlideList'),
        icon: <IconReaderGrid size={19} />,
        onPress: () => setListOpen(true),
      },
      search,
      {
        id: 'pptxPresent',
        label: t('readersA11yPresent'),
        icon: <IconReaderPresent size={19} />,
        onPress: openShow,
      },
    ]
  }, [count, openShow, status, t])

  let body
  if (status !== 'ready') {
    body = <PptxOpening lang={lang} since={controller.startedAt} delayMs={openingDelayMs} />
  } else if (count === 0) {
    body = (
      <div className="mobile-empty-state" data-testid="pptx-no-slides">
        <span className="mobile-empty-icon" aria-hidden="true">
          <IconReaderGrid size={22} />
        </span>
        <p>{t('readersPptxNoSlides')}</p>
      </div>
    )
  } else {
    body = (
      <div className="mobile-pptx" data-notes={isTablet ? 'side' : 'below'}>
        <div className="mobile-pptx-main">
          <SlideStage controller={controller} current={current} t={t} />
          <nav className="mobile-pptx-nav">
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => controller.goTo(current - 1)}
              disabled={current === 0}
              aria-label={t('readersA11yPrevSlide')}
              title={t('readersA11yPrevSlide')}
              data-testid="pptx-prev"
            >
              <IconBack size={20} />
            </button>
            <span className="mobile-pptx-position" aria-live="polite" data-testid="pptx-position">
              {t('readersPosition', { current: current + 1, total: count })}
            </span>
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => controller.goTo(current + 1)}
              disabled={current >= count - 1}
              aria-label={t('readersA11yNextSlide')}
              title={t('readersA11yNextSlide')}
              data-testid="pptx-next"
            >
              <IconChevronRight size={20} />
            </button>
          </nav>
        </div>
        <NotesPanel controller={controller} current={current} t={t} />
      </div>
    )
  }

  return (
    <>
      <EditorShell {...frame} quickActions={[]} viewTools={viewTools} onFitToWidth={() => {}}>
        {body}
      </EditorShell>
      {status === 'ready' && count > 0 && (
        <>
          <PptxSlideListSheet
            open={listOpen}
            controller={controller}
            current={current}
            t={t}
            onClose={() => setListOpen(false)}
            onPick={goFromSheet}
          />
          {show && (
            <PptxShow
              controller={controller}
              sequence={show.sequence}
              startStep={show.start}
              t={t}
              onClose={closeShow}
            />
          )}
        </>
      )}
      {status === 'ready' && (
        <PptxSearchSheet
          open={searchOpen}
          controller={controller}
          t={t}
          onClose={() => setSearchOpen(false)}
          onPick={goFromSheet}
        />
      )}
    </>
  )
}
