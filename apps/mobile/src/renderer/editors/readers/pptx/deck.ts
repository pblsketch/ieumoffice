/**
 * An opened PowerPoint deck for the mobile reader: the PC engine's model plus what a
 * reading screen asks of it (render data per slide, notes, hidden flag, plain text) and
 * the `blob:` URLs of the media those slides show. No UI here.
 *
 * The engine keeps every inflated zip part in its archive; this module keeps no reference
 * to the input bytes. Render data is cached per slide until `releaseSlide`, which also lets
 * go of that slide's media URLs. Load this module with a dynamic import: it pulls in the
 * engine.
 */
import { getSlideHidden, getSlideNotes, openPptx, type OpenedPptx } from '@genoffice/pptx-engine'
import { buildRenderSlide, type RenderSlide } from '@genoffice/pptx-render'
import { createSlideMediaStore, type SlideMediaStore } from './media'
import { slideText } from './text'

/** Why a deck did not open: over the engine's zip limits, or not a readable deck */
export type PptxOpenFailure = 'too-large' | 'damaged'

/** Thrown by `openDeck`; the screen shows its "cannot open" message for both reasons */
export class PptxOpenError extends Error {
  readonly reason: PptxOpenFailure
  constructor(reason: PptxOpenFailure, cause: unknown) {
    super(
      `pptx open failed (${reason}): ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    )
    this.name = 'PptxOpenError'
    this.reason = reason
  }
}

export interface PptxDeck {
  readonly slideCount: number
  /** Slide size in EMU */
  readonly size: { readonly cx: number; readonly cy: number }
  /** Part path of a slide (ppt/slides/slideN.xml): the saved reading position's identity */
  slidePath(index: number): string
  /** Index of the slide with that part path, or -1 */
  indexOfPath(partPath: string): number
  /** Render data at that width (cached until released or asked at another width) */
  renderSlide(index: number, fitWidthPx: number): RenderSlide
  /** Drops the slide's render data and the media URLs only it holds */
  releaseSlide(index: number): void
  /** Speaker notes, lines separated by LF ('' when none) */
  slideNotes(index: number): string
  /** Hidden in slide shows (<p:sld show="0">) */
  isHidden(index: number): boolean
  /** Text of the slide's boxes, tables and groups, one paragraph per line */
  slideText(index: number): string
  /** Revokes every URL and drops the deck; later calls throw */
  dispose(): void
}

function openFailure(err: unknown): PptxOpenError {
  const message = err instanceof Error ? err.message : String(err)
  // The zip gates (engine and @genoffice/zip-gate) reject over-limit packages with this prefix
  return new PptxOpenError(/^zip rejected\b/.test(message) ? 'too-large' : 'damaged', err)
}

/** Opens a deck. Rejects with `PptxOpenError` when the engine refuses the bytes. */
export async function openDeck(bytes: Uint8Array): Promise<PptxDeck> {
  let opened: OpenedPptx
  try {
    opened = await openPptx(bytes)
  } catch (err) {
    throw openFailure(err)
  }
  return wrapDeck(opened)
}

function wrapDeck(source: OpenedPptx): PptxDeck {
  let opened: OpenedPptx | null = source
  let media: SlideMediaStore | null = createSlideMediaStore(source.archive)
  const renders = new Map<number, { widthPx: number; slide: RenderSlide }>()
  const texts = new Map<number, string>()
  const slideCount = source.deck.slides.length
  const size = { cx: source.deck.size.cx, cy: source.deck.size.cy }

  const live = (): { opened: OpenedPptx; media: SlideMediaStore } => {
    if (!opened || !media) throw new Error('pptx deck is disposed')
    return { opened, media }
  }
  const slideAt = (index: number) => {
    const { opened } = live()
    const slide = Number.isInteger(index) ? opened.deck.slides[index] : undefined
    if (!slide) throw new RangeError(`slide index ${index} is outside 0..${slideCount - 1}`)
    return slide
  }

  return {
    slideCount,
    size,
    slidePath: (index) => slideAt(index).path,
    indexOfPath: (partPath) => live().opened.deck.slides.findIndex((s) => s.path === partPath),
    renderSlide(index, fitWidthPx) {
      const slide = slideAt(index)
      const cached = renders.get(index)
      if (cached && cached.widthPx === fitWidthPx) return cached.slide
      const { opened, media } = live()
      try {
        const render = buildRenderSlide(slide, opened.deck.size, {
          fitWidthPx,
          media: media.resolverFor(index),
          slideNo: index + 1,
        })
        renders.set(index, { widthPx: fitWidthPx, slide: render })
        return render
      } catch (err) {
        // A slide that cannot be drawn keeps nothing alive
        renders.delete(index)
        media.release(index)
        throw err
      }
    },
    releaseSlide(index) {
      renders.delete(index)
      media?.release(index)
    },
    slideNotes(index) {
      const slide = slideAt(index)
      // Some writers keep CR LF inside a note paragraph; lines are LF for display and search
      return getSlideNotes(live().opened.archive, slide.path).replace(/\r\n?/g, '\n')
    },
    isHidden: (index) => getSlideHidden(slideAt(index)),
    slideText(index) {
      const slide = slideAt(index)
      let text = texts.get(index)
      if (text === undefined) texts.set(index, (text = slideText(slide)))
      return text
    },
    dispose() {
      media?.dispose()
      media = null
      opened = null
      renders.clear()
      texts.clear()
    },
  }
}
