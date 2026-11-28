/**
 * No-AI live style Tweaks panel for Whiteboard (T14).
 * Works even when AI features are turned off.
 */
import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import { tweaksText, type TweaksStringKey } from '@genoffice/ui'
import {
  WHITEBOARD_TWEAKS_PALETTES,
  type WhiteboardBgTone,
  type WhiteboardPaletteId,
  type WhiteboardRadius,
  type WhiteboardTweaksState,
} from './whiteboard-tweaks'

const PALETTE_LABEL: Record<WhiteboardPaletteId, TweaksStringKey> = {
  default: 'paletteDefault',
  editorial: 'paletteEditorial',
  navy: 'paletteNavy',
  forest: 'paletteForest',
  slate: 'paletteSlate',
  'warm-sand': 'paletteWarmSand',
}

export interface WhiteboardTweaksPanelProps {
  lang: Lang
  value: WhiteboardTweaksState
  onChange(next: WhiteboardTweaksState): void
  onReset(): void
  onClose(): void
}

export function WhiteboardTweaksPanel({
  lang,
  value,
  onChange,
  onReset,
  onClose,
}: WhiteboardTweaksPanelProps): ReactElement {
  const t = (key: TweaksStringKey) => tweaksText(lang, key)
  const tones: readonly [WhiteboardBgTone, TweaksStringKey][] = [
    ['white', 'bgWhite'],
    ['paper', 'bgPaper'],
    ['dot-grid', 'bgDotGrid'],
    ['square-grid', 'bgSquareGrid'],
  ]
  const radii: readonly [WhiteboardRadius, TweaksStringKey][] = [
    ['sharp', 'radiusSharp'],
    ['normal', 'radiusNormal'],
    ['rounded', 'radiusRounded'],
  ]

  return (
    <aside
      className="ieum-tweaks-panel"
      aria-label={t('title')}
      data-testid="whiteboard-tweaks-panel"
    >
      <div className="ieum-tweaks-head">
        <h3 className="ieum-tweaks-title">{t('title')}</h3>
        <button type="button" className="ieum-tweaks-btn" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <p className="ieum-tweaks-sub">{t('subtitle')}</p>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('backgroundTone')}</span>
        <div className="ieum-tweaks-grid">
          {tones.map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`ieum-tweaks-chip${value.background === id ? ' is-active' : ''}`}
              aria-pressed={value.background === id}
              onClick={() => onChange({ ...value, background: id })}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="ieum-tweaks-group">
        <span className="ieum-tweaks-label">{t('palette')}</span>
        <div className="ieum-tweaks-grid">
          {WHITEBOARD_TWEAKS_PALETTES.map((pal) => (
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
          min={85}
          max={125}
          step={5}
          value={value.fontScalePct}
          onChange={(e) => onChange({ ...value, fontScalePct: Number(e.target.value) })}
        />
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

      <div className="ieum-tweaks-group">
        <label className="ieum-tweaks-label">
          <span>{t('strokeWidth')}</span>
          <span>{value.strokeWidth}px</span>
        </label>
        <input
          className="ieum-tweaks-range"
          type="range"
          min={1}
          max={4}
          step={1}
          value={value.strokeWidth}
          onChange={(e) => onChange({ ...value, strokeWidth: Number(e.target.value) })}
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
