// The [Pen] sheet (spec 3.3, 3.5): tool (pen, rectangle, ellipse, line, arrow,
// eraser), color, width, and the "draw with finger too" switch. Non-modal, so the
// page stays in view while choosing.
import type { ReactNode } from 'react'
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../../components/Sheet'
import type { IconProps } from '../../../../components/icons/svgIcon'
import { cssRgb, DRAW_COLORS } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { MobileStringKey } from '../../../../i18n/strings'
import { DRAW_TOOL_CHOICES, DRAW_WIDTHS, type DrawToolChoice, type Rgb } from './drawGeometry'
import {
  IconDrawArrow,
  IconDrawEllipse,
  IconDrawEraser,
  IconDrawInk,
  IconDrawLine,
  IconDrawRect,
} from './icons'

export const DRAW_TOOL_ENTRIES: Readonly<
  Record<
    DrawToolChoice,
    { readonly label: MobileStringKey; readonly Icon: (props: IconProps) => ReactNode }
  >
> = {
  ink: { label: 'pdfDrawPen', Icon: IconDrawInk },
  rect: { label: 'pdfDrawRect', Icon: IconDrawRect },
  ellipse: { label: 'pdfDrawEllipse', Icon: IconDrawEllipse },
  line: { label: 'pdfDrawLine', Icon: IconDrawLine },
  arrow: { label: 'pdfDrawArrow', Icon: IconDrawArrow },
  eraser: { label: 'pdfDrawEraser', Icon: IconDrawEraser },
}

const COLOR_LABELS: Readonly<Record<string, MobileStringKey>> = {
  red: 'pdfDrawColorRed',
  yellow: 'pdfDrawColorYellow',
  green: 'pdfDrawColorGreen',
  blue: 'pdfDrawColorBlue',
  black: 'pdfDrawColorBlack',
}

const sameRgb = (a: Rgb, b: Rgb) => a.every((v, i) => v === b[i])

export interface DrawSheetProps {
  readonly open: boolean
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly tool: DrawToolChoice
  readonly color: Rgb
  readonly width: number
  readonly fingerDraws: boolean
  readonly onTool: (tool: DrawToolChoice) => void
  readonly onColor: (color: Rgb) => void
  readonly onWidth: (width: number) => void
  readonly onFingerDraws: (on: boolean) => void
  readonly onClose: () => void
}

export function DrawSheet({
  open,
  t,
  tool,
  color,
  width,
  fingerDraws,
  onTool,
  onColor,
  onWidth,
  onFingerDraws,
  onClose,
}: DrawSheetProps) {
  const erasing = tool === 'eraser'
  return (
    <Sheet
      open={open}
      title={t('pdfDrawSettings')}
      closeLabel={t('cancel')}
      onClose={onClose}
      modal={false}
      testId="pdf-draw-sheet"
    >
      <div className="mobile-choice-sheet m-pdf-draw-sheet">
        <div className="m-pdf-draw-group" role="radiogroup" aria-label={t('pdfDrawTool')}>
          {DRAW_TOOL_CHOICES.map((choice) => {
            const { label, Icon } = DRAW_TOOL_ENTRIES[choice]
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={tool === choice}
                className="mobile-choice-btn m-pdf-draw-tool"
                onClick={() => onTool(choice)}
                data-testid={`pdf-draw-tool-${choice}`}
              >
                <Icon size={20} />
                <span>{t(label)}</span>
              </button>
            )
          })}
        </div>
        {erasing ? (
          <p className="m-pdf-edit-hint" data-testid="pdf-draw-eraser-hint">
            {t('pdfDrawEraserHint')}
          </p>
        ) : (
          <>
            <div className="m-pdf-draw-row" role="radiogroup" aria-label={t('pdfDrawColor')}>
              {DRAW_COLORS.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  role="radio"
                  aria-checked={sameRgb(item.rgb, color)}
                  aria-label={t(COLOR_LABELS[item.name]!)}
                  className="m-pdf-draw-swatch"
                  onClick={() => onColor(item.rgb)}
                  data-testid={`pdf-draw-color-${item.name}`}
                >
                  {/* document color, shown as it will be drawn */}
                  <span
                    className="m-pdf-draw-swatch-dot"
                    style={{ background: cssRgb(item.rgb) }}
                  />
                </button>
              ))}
            </div>
            <div className="m-pdf-draw-row" role="radiogroup" aria-label={t('pdfDrawWidth')}>
              {DRAW_WIDTHS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={width === value}
                  aria-label={t('pdfDrawWidthValue', { width: value })}
                  className="m-pdf-draw-swatch"
                  onClick={() => onWidth(value)}
                  data-testid={`pdf-draw-width-${value}`}
                >
                  <span
                    className="m-pdf-draw-width-bar"
                    style={{ height: Math.max(1, value * 1.5) }}
                  />
                </button>
              ))}
            </div>
          </>
        )}
        <label className="mobile-set-row">
          <span className="m-pdf-draw-switch-text">
            <span className="mobile-set-label">{t('pdfDrawFinger')}</span>
            <span className="m-pdf-edit-hint">{t('pdfDrawFingerHint')}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mobile-switch"
            checked={fingerDraws}
            onChange={(event) => onFingerDraws(event.target.checked)}
            data-testid="pdf-draw-finger-switch"
          />
        </label>
      </div>
    </Sheet>
  )
}
