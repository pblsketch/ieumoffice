/**
 * No-AI live style Tweaks panel for Slides (T14).
 * Supports Current slide / Whole deck scope toggle and works even when AI is off.
 */
import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import { tweaksText, type TweaksStringKey } from '@genoffice/ui'
import {
  SLIDES_TWEAKS_PALETTES,
  type SlidesTweaksPaletteId,
  type SlidesTweaksScope,
  type SlidesTweaksState,
} from './slides-tweaks'

const PALETTE_LABEL: Record<SlidesTweaksPaletteId, TweaksStringKey> = {
  default: 'paletteDefault',
  editorial: 'paletteEditorial',
  navy: 'paletteNavy',
  forest: 'paletteForest',
  slate: 'paletteSlate',
  'warm-sand': 'paletteWarmSand',
}

export interface SlidesTweaksPanelProps {
  lang: Lang
  value: SlidesTweaksState
  onChange(next: SlidesTweaksState): void
  onReset(): void
  onClose(): void
}

export function SlidesTweaksPanel({
  lang,
  value,
  onChange,
  onReset,
  onClose,
}: SlidesTweaksPanelProps): ReactElement {
  const t = (key: TweaksStringKey) => tweaksText(lang, key)
  const scopes: readonly [SlidesTweaksScope, TweaksStringKey][] = [
    ['current', 'scopeCurrentSlide'],
    ['deck', 'scopeWholeDeck'],
  ]

  return (
    <aside className="ieum-tweaks-panel" aria-label={t('title')} data-testid="slides-tweaks-panel">
      <div className="ieum-tweaks-head">
        <h3 className="ieum-tweaks-title">{t('title')}</h3>
        <button type="button" className="ieum-tweaks-btn" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <p className="ieum-tweaks-sub">{t('subtitle')}</p>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('scope')}</span>
        <div className="ieum-tweaks-seg" role="radiogroup" aria-label={t('scope')}>
          {scopes.map(([id, key]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.scope === id}
              className={`ieum-tweaks-chip${value.scope === id ? ' is-active' : ''}`}
              onClick={() => onChange({ ...value, scope: id })}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('palette')}</span>
        <div className="ieum-tweaks-grid">
          {SLIDES_TWEAKS_PALETTES.map((pal) => (
            <button
              key={pal.id}
              type="button"
              className={`ieum-tweaks-chip${value.palette === pal.id ? ' is-active' : ''}`}
              aria-pressed={value.palette === pal.id}
              onClick={() => onChange({ ...value, palette: pal.id })}
            >
              {t(PALETTE_LABEL[pal.id])}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-group">
        <label className="ieum-tweaks-label">
          <span>{t('fontScale')}</span>
          <span>{value.fontScalePct}%</span>
        </label>
        <input
          className="ieum-tweaks-range"
          type="range"
          min={90}
          max={115}
          step={5}
          value={value.fontScalePct}
          onChange={(e) => onChange({ ...value, fontScalePct: Number(e.target.value) })}
        />
      </div>

      <div className="ieum-tweaks-foot">
        <button type="button" className="ieum-tweaks-btn" onClick={onReset}>
          {t('reset')}
        </button>
      </div>
    </aside>
  )
}
