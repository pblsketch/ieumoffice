// The secondary bar while typing in a text box (spec 3.3, design system 5.4/5.6):
// bold, size, color and one of the three app fonts, plus delete and confirm. Every
// button keeps the focus in the input box (pointerdown default prevented), so the
// keyboard stays up; color and font swap the row in place instead of opening a sheet.
import { useState, type ReactNode } from 'react'
import type { Params } from '@genoffice/i18n'
import { COLOR_PRESETS } from '../../../../../../../pdf/src/renderer/color-presets'
import type { MobileStringKey } from '../../../../i18n/strings'
import {
  IconTextBack,
  IconTextBold,
  IconTextConfirm,
  IconTextDelete,
  IconTextMinus,
  IconTextPlus,
} from './icons'
import { TEXT_FONTS, fontCss, type TextFontId } from './textModel'

export interface TextStyleState {
  readonly bold: boolean
  readonly size: number
  /** CSS hex; undefined = the document's own color (edits only). */
  readonly color: string | undefined
  /** undefined = the document's own face (edits only). */
  readonly font: TextFontId | undefined
  /** Editing document text: "the document's own" is a choice for color and font. */
  readonly documentStyle: boolean
  /** Shown on the document-color swatch. */
  readonly documentInk?: string
}

export interface TextStyleBarProps {
  readonly state: TextStyleState
  readonly busy: boolean
  readonly t: (key: MobileStringKey, params?: Params) => string
  onBold(): void
  onSize(dir: 1 | -1): void
  onColor(color: string | undefined): void
  onFont(font: TextFontId | undefined): void
  onDelete(): void
  onConfirm(): void
}

type Panel = 'main' | 'color' | 'font'

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

function BarButton({
  label,
  pressed,
  disabled,
  onPress,
  testId,
  className,
  children,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onPress: () => void
  testId?: string
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`m-pdf-text-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onPointerDown={keepFocus}
      onClick={onPress}
    >
      {children}
    </button>
  )
}

export function TextStyleBar({ state, busy, t, ...on }: TextStyleBarProps) {
  const [panel, setPanel] = useState<Panel>('main')
  const fontLabel = TEXT_FONTS.find((f) => f.id === state.font)?.label ?? t('pdfTextFontDocument')
  const back = (
    <BarButton label={t('pdfTextBack')} onPress={() => setPanel('main')} testId="pdf-text-back">
      <IconTextBack size={20} />
    </BarButton>
  )
  return (
    <div
      className="m-pdf-text-bar"
      role="toolbar"
      aria-label={t('pdfTextStyleBar')}
      data-testid="pdf-text-bar"
    >
      {panel === 'main' && (
        <>
          <div className="m-pdf-text-bar-scroll">
            <BarButton
              label={t('pdfTextBold')}
              pressed={state.bold}
              onPress={on.onBold}
              testId="pdf-text-bold"
            >
              <IconTextBold size={20} />
            </BarButton>
            <div className="m-pdf-text-size" role="group" aria-label={t('pdfTextSize')}>
              <BarButton
                label={t('pdfTextSizeDown')}
                onPress={() => on.onSize(-1)}
                testId="pdf-text-size-down"
              >
                <IconTextMinus size={18} />
              </BarButton>
              <span className="m-pdf-text-size-value" data-testid="pdf-text-size">
                {Math.round(state.size * 10) / 10}
              </span>
              <BarButton
                label={t('pdfTextSizeUp')}
                onPress={() => on.onSize(1)}
                testId="pdf-text-size-up"
              >
                <IconTextPlus size={18} />
              </BarButton>
            </div>
            <BarButton
              label={t('pdfTextColor')}
              onPress={() => setPanel('color')}
              testId="pdf-text-color"
            >
              <span
                className="m-pdf-text-swatch"
                data-document={state.color === undefined || undefined}
                style={{ background: state.color ?? state.documentInk }}
              />
            </BarButton>
            <button
              type="button"
              className="m-pdf-text-font-chip"
              aria-label={`${t('pdfTextFont')}: ${fontLabel}`}
              data-testid="pdf-text-font"
              onPointerDown={keepFocus}
              onClick={() => setPanel('font')}
              style={{ fontFamily: fontCss(state.font) }}
            >
              {fontLabel}
            </button>
          </div>
          <BarButton
            label={t('pdfTextDelete')}
            onPress={on.onDelete}
            disabled={busy}
            testId="pdf-text-delete"
            className="m-pdf-text-btn-danger"
          >
            <IconTextDelete size={20} />
          </BarButton>
          <BarButton
            label={t('pdfTextDone')}
            onPress={on.onConfirm}
            disabled={busy}
            testId="pdf-text-confirm"
            className="m-pdf-text-btn-primary"
          >
            <IconTextConfirm size={20} />
          </BarButton>
        </>
      )}
      {panel === 'color' && (
        <>
          {back}
          <div className="m-pdf-text-bar-scroll" role="radiogroup" aria-label={t('pdfTextColor')}>
            {state.documentStyle && (
              <button
                type="button"
                role="radio"
                aria-checked={state.color === undefined}
                className="m-pdf-text-btn"
                aria-label={t('pdfTextColorDocument')}
                title={t('pdfTextColorDocument')}
                onPointerDown={keepFocus}
                onClick={() => {
                  on.onColor(undefined)
                  setPanel('main')
                }}
              >
                <span
                  className="m-pdf-text-swatch"
                  data-document
                  style={{ background: state.documentInk }}
                />
              </button>
            )}
            {COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={state.color?.toLowerCase() === hex.toLowerCase()}
                className="m-pdf-text-btn"
                aria-label={`${t('pdfTextColor')} ${hex}`}
                data-testid={`pdf-text-color-${hex.slice(1).toLowerCase()}`}
                onPointerDown={keepFocus}
                onClick={() => {
                  on.onColor(hex.toLowerCase())
                  setPanel('main')
                }}
              >
                <span className="m-pdf-text-swatch" style={{ background: hex }} />
              </button>
            ))}
          </div>
        </>
      )}
      {panel === 'font' && (
        <>
          {back}
          <div className="m-pdf-text-bar-scroll" role="radiogroup" aria-label={t('pdfTextFont')}>
            {state.documentStyle && (
              <button
                type="button"
                role="radio"
                aria-checked={state.font === undefined}
                className="m-pdf-text-font-chip"
                onPointerDown={keepFocus}
                onClick={() => {
                  on.onFont(undefined)
                  setPanel('main')
                }}
              >
                {t('pdfTextFontDocument')}
              </button>
            )}
            {TEXT_FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={state.font === f.id}
                className="m-pdf-text-font-chip"
                style={{ fontFamily: f.css }}
                data-testid={`pdf-text-font-${f.id}`}
                onPointerDown={keepFocus}
                onClick={() => {
                  on.onFont(f.id)
                  setPanel('main')
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
