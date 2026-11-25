import { HomeActStarIcon } from '../../components/icons/home'
import { useMobileLocale } from '../../i18n'
import type { HomeChip } from './frameModel'
import './homeFrame.css'

type Translate = ReturnType<typeof useMobileLocale>['t']

/** The words on a chip: All, Favorites, the group's name, or the format family. */
export function chipLabel(chip: HomeChip, t: Translate): string {
  switch (chip.kind) {
    case 'all':
      return t('homeListAll')
    case 'favorites':
      return t('homeListFavorites')
    case 'group':
      return chip.name
    case 'family':
      if (chip.family === 'hwp') return t('homeListFamilyHwp')
      if (chip.family === 'md') return t('homeListFamilyMd')
      return chip.family.toUpperCase()
  }
}

export interface HomeChipsProps {
  readonly chips: readonly HomeChip[]
  readonly current: string
  readonly onSelect: (id: string) => void
}

/** One-choice filter chips over the list (spec 3.3); the chosen one is pressed. */
export function HomeChips({ chips, current, onSelect }: HomeChipsProps) {
  const { t } = useMobileLocale()
  return (
    <div
      className="home-frame-chips"
      role="group"
      aria-label={t('homeListChips')}
      data-testid="home-chips"
    >
      {chips.map((chip) => {
        const pressed = chip.id === current
        return (
          <button
            key={chip.id}
            type="button"
            className="home-frame-chip"
            data-testid={`home-chip-${chip.id.replace(':', '-')}`}
            aria-pressed={pressed}
            onClick={() => onSelect(chip.id)}
          >
            {chip.kind === 'favorites' && (
              <HomeActStarIcon size={14} fill={pressed ? 'currentColor' : 'none'} />
            )}
            <span>{chipLabel(chip, t)}</span>
          </button>
        )
      })}
    </div>
  )
}
