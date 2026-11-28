import { describe, expect, it } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import {
  DEFAULT_SLIDES_TWEAKS,
  buildSlidesTweaksTxn,
  buildSlidesTweaksTxnChunks,
  targetSlideIndexesForScope,
} from '../src/renderer/tweaks/slides-tweaks'

const makeSlide = (index: number): RenderSlide =>
  ({
    index,
    scale: 1,
    widthPx: 960,
    heightPx: 540,
    nodes: [
      {
        kind: 'shape',
        sourceId: `title-${index}`,
        text: { lines: [{ runs: [{ text: 'Heading', fontSizePx: 37.33 }] }] },
      },
      {
        kind: 'shape',
        sourceId: `body-${index}`,
        text: { lines: [{ runs: [{ text: 'Body', fontSizePx: 21.33 }] }] },
      },
    ],
  }) as unknown as RenderSlide

describe('Slides No-AI Style Tweaks', () => {
  it('respects Current slide vs Whole deck scope and emits valid pptx-ops', () => {
    const slides = [makeSlide(0), makeSlide(1), makeSlide(2)]
    expect(targetSlideIndexesForScope(3, 1, 'current')).toEqual([1])
    expect(targetSlideIndexesForScope(3, 1, 'deck')).toEqual([0, 1, 2])

    const currentTxn = buildSlidesTweaksTxn(slides, 1, {
      ...DEFAULT_SLIDES_TWEAKS,
      scope: 'current',
      palette: 'navy',
      fontScalePct: 110,
    })
    const ops = currentTxn.ops as Array<Record<string, unknown>>
    expect(ops[0]).toEqual({
      op: 'setBackground',
      target: { slide: 1 },
      kind: 'solid',
      color: '#F8FAFC',
    })
    expect(ops[1]).toEqual({
      op: 'setFont',
      target: { slide: 1, el: 'title-1' },
      font: { color: '#1E3A5F', fontSizePt: 31 },
    })
    expect(ops[2]).toEqual({
      op: 'setFont',
      target: { slide: 1, el: 'body-1' },
      font: { color: '#0F172A', fontSizePt: 18 },
    })

    const deckTxn = buildSlidesTweaksTxn(slides, 1, {
      ...DEFAULT_SLIDES_TWEAKS,
      scope: 'deck',
      palette: 'forest',
      fontScalePct: 95,
    })
    const deckSlidesTouched = new Set(
      (deckTxn.ops as Array<{ target?: { slide?: number } }>).map((op) => op.target?.slide),
    )
    expect([...deckSlidesTouched].sort()).toEqual([0, 1, 2])
  })

  it('chunks large decks into <= 50-op transactions for applySessionTxn', () => {
    const largeDeck = Array.from({ length: 25 }, (_, i) => makeSlide(i))
    const chunks = buildSlidesTweaksTxnChunks(largeDeck, 0, {
      ...DEFAULT_SLIDES_TWEAKS,
      scope: 'deck',
      palette: 'editorial',
      fontScalePct: 100,
    })
    expect(chunks.length).toBe(2)
    expect(chunks[0]!.ops.length).toBe(50)
    expect(chunks[1]!.ops.length).toBe(25)
  })
})
