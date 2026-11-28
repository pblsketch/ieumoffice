/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  SLIDE_DECK_STRUCTURES,
  findSlideDeckStructure,
  formatDeckStructurePromptNote,
} from '@genoffice/pipelines/slides/templates'
import { DeckOptionsBar } from '../src/renderer/ai/DeckOptionsBar'
import {
  slidesDeckOptionText,
  slidesDeckStructureLabel,
} from '../src/renderer/ai/strings-deck-options'
import {
  SPEAKER_NOTES_SEPARATE_DEFAULT,
  SPEAKER_NOTES_SEPARATE_DIRECTIVE,
} from '../src/renderer/ai/speaker-notes-option'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Slides DeckOptionsBar & prompt harmony', () => {
  it('covers all UI languages for deck structure and speaker-notes labels', () => {
    for (const lang of LANGS) {
      expect(slidesDeckOptionText(lang, 'structureLabel').trim().length).toBeGreaterThan(0)
      expect(slidesDeckOptionText(lang, 'structureAuto').trim().length).toBeGreaterThan(0)
      expect(
        slidesDeckOptionText(lang, 'structureLockedBySkillTemplate').trim().length,
      ).toBeGreaterThan(0)
      expect(slidesDeckOptionText(lang, 'speakerNotesLabel').trim().length).toBeGreaterThan(0)
      expect(slidesDeckOptionText(lang, 'speakerNotesTip').trim().length).toBeGreaterThan(0)
      for (const s of SLIDE_DECK_STRUCTURES) {
        expect(slidesDeckStructureLabel(lang, s.id).trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('renders Auto + 4 structure chips and speaker-notes checkbox, toggling cleanly', () => {
    const onSelectStructure = vi.fn()
    const onToggleSpeakerNotes = vi.fn()
    act(() => {
      root.render(
        createElement(DeckOptionsBar, {
          lang: 'ko',
          structureId: null,
          onSelectStructure,
          speakerNotesSeparate: SPEAKER_NOTES_SEPARATE_DEFAULT,
          onToggleSpeakerNotes,
        }),
      )
    })

    const chips = container.querySelectorAll<HTMLButtonElement>('.ai-deck-struct-chip')
    expect(chips.length).toBe(5)
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')

    act(() => chips[2]!.click())
    expect(onSelectStructure).toHaveBeenCalledWith('proposal')

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false)
    act(() => checkbox.click())
    expect(onToggleSpeakerNotes).toHaveBeenCalledWith(true)
  })

  it('yields structure chips when a file-backed skill template is attached', () => {
    act(() => {
      root.render(
        createElement(DeckOptionsBar, {
          lang: 'ko',
          structureId: 'proposal',
          onSelectStructure: vi.fn(),
          lockedBySkillTemplate: true,
          speakerNotesSeparate: false,
          onToggleSpeakerNotes: vi.fn(),
        }),
      )
    })
    expect(container.querySelectorAll('.ai-deck-struct-chip').length).toBe(0)
    expect(container.querySelector('.ai-deck-struct-locked')?.textContent).toContain('스킬 템플릿')
  })

  it('keeps default systemPrompt byte-identical when Auto/OFF and injects notes only when enabled', () => {
    let structureId: 'proposal' | null = null
    let separate = false
    const baseAccess: DeckAccess = {
      getSlides: () => [],
      getCurrent: () => 0,
      getSelectedIds: () => [],
      applySlide: () => {},
      applyDeck: () => {},
      fitWidthPx: 960,
    }
    const baselineSkill = createSlidesSkill(baseAccess)
    const liveSkill = createSlidesSkill({
      ...baseAccess,
      deckStructure: () => (structureId ? findSlideDeckStructure(structureId) : undefined),
      speakerNotesSeparate: () => separate,
    })

    // Default Auto + OFF: 0 extra bytes
    expect(liveSkill.systemPrompt).toBe(baselineSkill.systemPrompt)

    // Structure selected
    structureId = 'proposal'
    expect(liveSkill.systemPrompt).toContain(
      formatDeckStructurePromptNote(findSlideDeckStructure('proposal')),
    )
    expect(liveSkill.systemPrompt).not.toContain(SPEAKER_NOTES_SEPARATE_DIRECTIVE)

    // Speaker-notes separation ON
    separate = true
    expect(liveSkill.systemPrompt).toContain(SPEAKER_NOTES_SEPARATE_DIRECTIVE)
  })
})
