/**
 * No-AI live style Tweaks panel for HTML documents (T14).
 * Works independently of AI settings (`aiVisible === false`).
 */
import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import { tweaksText, type TweaksStringKey } from '@genoffice/ui'
import {
  HTML_TWEAKS_PALETTES,
  type HtmlTweaksDensity,
  type HtmlTweaksPaletteId,
  type HtmlTweaksRadius,
  type HtmlTweaksState,
} from './html-tweaks'

const PALETTE_LABEL: Record<HtmlTweaksPaletteId, TweaksStringKey> = {
  default: 'paletteDefault',
  editorial: 'paletteEditorial',
  navy: 'paletteNavy',
  forest: 'paletteForest',
  slate: 'paletteSlate',
  'warm-sand': 'paletteWarmSand',
}

export interface HtmlTweaksPanelProps {
  lang: Lang
  value: HtmlTweaksState
  onChange(next: HtmlTweaksState): void
  onReset(): void
  onClose(): void
}

export function HtmlTweaksPanel({
  lang,
  value,
  onChange,
  onReset,
  onClose,
}: HtmlTweaksPanelProps): ReactElement {
  const t = (key: TweaksStringKey) => tweaksText(lang, key)
  const densities: readonly [HtmlTweaksDensity, TweaksStringKey][] = [
    ['compact', 'densityCompact'],
    ['normal', 'densityNormal'],
    ['relaxed', 'densityRelaxed'],
  ]
  const radii: readonly [HtmlTweaksRadius, TweaksStringKey][] = [
    ['sharp', 'radiusSharp'],
    ['normal', 'radiusNormal'],
    ['rounded', 'radiusRounded'],
  ]

  return (
    <aside className="ieum-tweaks-panel" aria-label={t('title')} data-testid="html-tweaks-panel">
      <div className="ieum-tweaks-head">
        <h3 className="ieum-tweaks-title">{t('title')}</h3>
        <button type="button" className="ieum-tweaks-btn" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <p className="ieum-tweaks-sub">{t('subtitle')}</p>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('palette')}</span>
        <div className="ieum-tweaks-grid">
          {HTML_TWEAKS_PALETTES.map((pal) => (
            <button
              key={pal.id}
              type="button"
              className={`ieum-tweaks-chip${value.palette === pal.id ? ' is-active' : ''}`}
              aria-pressed={value.palette === pal.id}
              onClick={() => onChange({ ...value, palette: pal.id, accent: pal.accent })}
            >
              {t(PALETTE_LABEL[pal.id])}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-group">
        <label className="ieum-tweaks-label">
          <span>{t('accent')}</span>
          <input
            type="color"
            value={value.accent}
            aria-label={t('accent')}
            onChange={(e) => onChange({ ...value, accent: e.target.value })}
          />
        </label>
      </div>

      <div className="ieum-tweaks-group">
        <label className="ieum-tweaks-label">
          <span>{t('fontScale')}</span>
          <span>{value.fontScalePct}%</span>
        </label>
        <input
          className="ieum-tweaks-range"
          type="range"
          min={85}
          max={125}
          step={5}
          value={value.fontScalePct}
          onChange={(e) => onChange({ ...value, fontScalePct: Number(e.target.value) })}
        />
      </div>

      <div className="ieum-tweaks-group">
        <label className="ieum-tweaks-label">
          <span>{t('lineHeight')}</span>
          <span>{value.lineHeight.toFixed(2)}</span>
        </label>
        <input
          className="ieum-tweaks-range"
          type="range"
          min={1.35}
          max={1.85}
          step={0.05}
          value={value.lineHeight}
          onChange={(e) => onChange({ ...value, lineHeight: Number(e.target.value) })}
        />
      </div>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('density')}</span>
        <div className="ieum-tweaks-seg">
          {densities.map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`ieum-tweaks-chip${value.density === id ? ' is-active' : ''}`}
              aria-pressed={value.density === id}
              onClick={() => onChange({ ...value, density: id })}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('radius')}</span>
        <div className="ieum-tweaks-seg">
          {radii.map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`ieum-tweaks-chip${value.radius === id ? ' is-active' : ''}`}
              aria-pressed={value.radius === id}
              onClick={() => onChange({ ...value, radius: id })}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-foot">
        <button type="button" className="ieum-tweaks-btn" onClick={onReset}>
          {t('reset')}
        </button>
      </div>
    </aside>
  )
}
