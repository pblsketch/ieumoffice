/**
 * Our row/column menu (spec 2.2, 2.8-1), opened by a long press on a header
 * in edit mode: insert before/after, delete, hide, show hidden and the line
 * size, on the selected lines. Built on the shared bottom sheet; each entry
 * runs the desktop header menu's command (headerMenu.ts).
 */
import { useEffect, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import { Sheet } from '../../../components/Sheet'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'
import {
  HEADER_SIZE_MAX,
  HEADER_SIZE_MIN,
  currentAxisSpan,
  currentLineSize,
  parseLineSize,
  runHeaderAction,
  type AxisSpan,
  type HeaderAction,
  type HeaderAxis,
} from './headerMenu'

/** "3" or "3–5" for rows, "B" or "B–D" for columns. */
export function axisSpanLabel(span: AxisSpan): string {
  const name = (index: number) => (span.axis === 'row' ? String(index + 1) : columnLabel(index))
  return span.count === 1 ? name(span.start) : `${name(span.start)}–${name(span.end)}`
}

const ENTRY_KEYS: Readonly<
  Record<HeaderAxis, Readonly<Record<Exclude<HeaderAction, 'size'>, MobileStringKey>>>
> = {
  row: {
    insertBefore: 'sheetsInsertRowsAbove',
    insertAfter: 'sheetsInsertRowsBelow',
    remove: 'sheetsDeleteRows',
    hide: 'sheetsHideRows',
    show: 'sheetsShowRows',
  },
  column: {
    insertBefore: 'sheetsInsertColumnsLeft',
    insertAfter: 'sheetsInsertColumnsRight',
    remove: 'sheetsDeleteColumns',
    hide: 'sheetsHideColumns',
    show: 'sheetsShowColumns',
  },
}

const ENTRY_ORDER: readonly Exclude<HeaderAction, 'size'>[] = [
  'insertBefore',
  'insertAfter',
  'hide',
  'show',
  'remove',
]

export interface HeaderMenuSheetProps {
  readonly runtime: UniverRuntime
  /** The axis whose header was pressed; null keeps the sheet closed. */
  readonly axis: HeaderAxis | null
  readonly lang: Lang
  readonly onClose: () => void
}

export function HeaderMenuSheet({ runtime, axis, lang, onClose }: HeaderMenuSheetProps) {
  const t = (key: MobileStringKey, params?: Record<string, string | number>) =>
    translateMobile(lang, key, params)
  const [sizeText, setSizeText] = useState('')
  const [span, setSpan] = useState<AxisSpan | null>(null)

  useEffect(() => {
    if (!axis) return
    setSpan(currentAxisSpan(runtime, axis))
    const size = currentLineSize(runtime, axis)
    setSizeText(size === null ? '' : String(Math.round(size)))
  }, [runtime, axis])

  if (!axis || !span) return null
  const title = t(axis === 'row' ? 'sheetsRowMenuTitle' : 'sheetsColumnMenuTitle', {
    label: axisSpanLabel(span),
  })
  const run = (action: HeaderAction, size?: number) => {
    onClose()
    void runHeaderAction(runtime, axis, action, size)
  }
  const size = parseLineSize(sizeText)

  return (
    <Sheet
      open
      title={title}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="sheets-header-menu"
    >
      <div className="mobile-menu-stack" role="menu" aria-label={title}>
        {ENTRY_ORDER.map((action) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            className={
              action === 'remove'
                ? 'mobile-menu-row-btn m-sheets-danger-row'
                : 'mobile-menu-row-btn'
            }
            onClick={() => run(action)}
            data-testid={`sheets-header-${action}`}
          >
            <span>{t(ENTRY_KEYS[axis][action])}</span>
          </button>
        ))}
      </div>
      <form
        className="m-sheets-size-row"
        onSubmit={(event) => {
          event.preventDefault()
          if (size !== null) run('size', size)
        }}
      >
        <label className="m-sheets-size-label" htmlFor="sheets-line-size">
          {t(axis === 'row' ? 'sheetsRowHeight' : 'sheetsColumnWidth')}
        </label>
        <div className="m-sheets-size-field">
          <input
            id="sheets-line-size"
            className="mobile-input"
            type="number"
            inputMode="numeric"
            min={HEADER_SIZE_MIN}
            max={HEADER_SIZE_MAX}
            value={sizeText}
            onChange={(event) => setSizeText(event.target.value)}
            data-testid="sheets-header-size-input"
          />
          <span className="m-sheets-size-unit" aria-hidden="true">
            px
          </span>
          <button
            type="submit"
            className="mobile-touch-btn mobile-btn-secondary"
            disabled={size === null}
            data-testid="sheets-header-size"
          >
            {t('sheetsApplySize')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
