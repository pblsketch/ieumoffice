/**
 * Compact deck-options bar above the Slides AI composer:
 * 1. Purpose-specific deck structure chips (Auto | Weekly Report | Proposal | Lecture | Product Overview),
 *    orthogonal to the 12 visual styles in TemplateGallery. Automatically yields when a file-backed
 *    `ieum-template` skill chip is attached.
 * 2. Opt-in speaker-notes separation toggle (default OFF for 100% baseline prompt parity).
 */
import type { Lang } from '@genoffice/i18n'
import {
  SLIDE_DECK_STRUCTURES,
  type SlideDeckStructureId,
} from '@genoffice/pipelines/slides/templates'
import { slidesDeckOptionText, slidesDeckStructureLabel } from './strings-deck-options'

export interface DeckOptionsBarProps {
  lang: Lang
  structureId: SlideDeckStructureId | null
  onSelectStructure: (id: SlideDeckStructureId | null) => void
  /** True when the user attached a skill carrying a file-backed .pptx template */
  lockedBySkillTemplate?: boolean
  speakerNotesSeparate: boolean
  onToggleSpeakerNotes: (enabled: boolean) => void
}

export function DeckOptionsBar({
  lang,
  structureId,
  onSelectStructure,
  lockedBySkillTemplate = false,
  speakerNotesSeparate,
  onToggleSpeakerNotes,
}: DeckOptionsBarProps) {
  return (
    <div className="ai-deck-options" data-testid="slides-deck-options">
      <div className="ai-deck-struct-row">
        <span className="ai-deck-struct-label">{slidesDeckOptionText(lang, 'structureLabel')}</span>
        {lockedBySkillTemplate ? (
          <span className="ai-deck-struct-locked" role="status">
            {slidesDeckOptionText(lang, 'structureLockedBySkillTemplate')}
          </span>
        ) : (
          <div
            className="ai-deck-struct-chips"
            role="group"
            aria-label={slidesDeckOptionText(lang, 'structureLabel')}
          >
            <button
              type="button"
              className="ai-deck-struct-chip"
              data-deck-structure="auto"
              aria-pressed={structureId === null}
              onClick={() => onSelectStructure(null)}
            >
              {slidesDeckOptionText(lang, 'structureAuto')}
            </button>
            {SLIDE_DECK_STRUCTURES.map((structure) => (
              <button
                key={structure.id}
                type="button"
                className="ai-deck-struct-chip"
                data-deck-structure={structure.id}
                aria-pressed={structureId === structure.id}
                data-tip={lang === 'ko' ? structure.summaryKo : structure.summaryEn}
                onClick={() =>
                  onSelectStructure(structureId === structure.id ? null : structure.id)
                }
              >
                {slidesDeckStructureLabel(lang, structure.id)}
              </button>
            ))}
          </div>
        )}
      </div>
      <label
        className="ai-deck-notes-toggle"
        data-tip={slidesDeckOptionText(lang, 'speakerNotesTip')}
      >
        <input
          type="checkbox"
          checked={speakerNotesSeparate}
          onChange={(e) => onToggleSpeakerNotes(e.target.checked)}
        />
        <span>{slidesDeckOptionText(lang, 'speakerNotesLabel')}</span>
      </label>
    </div>
  )
}
