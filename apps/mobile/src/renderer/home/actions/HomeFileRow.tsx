import { useRef, type ReactNode } from 'react'
import { htmlLang } from '@genoffice/i18n'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import {
  HomeActCheckedIcon,
  HomeActStarIcon,
  HomeActUncheckedIcon,
} from '../../components/icons/home'
import { DocTypeIcon, IconFileText, IconImage, IconMore } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import { isPictureItem, splitFileName } from './items'
import type { HomeFileItem } from './types'
import { useHomeThumbnail } from './useHomeThumbnail'
import { useLongPress } from './useLongPress'
import './homeActions.css'

/** Today: hour and minute; other days: month and day. Empty when unknown. */
export function formatRowTime(timestamp: number | undefined, locale: string): string {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return ''
  try {
    const date = new Date(timestamp)
    const now = new Date()
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    return new Intl.DateTimeFormat(
      locale,
      sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' },
    ).format(date)
  } catch {
    return ''
  }
}

export interface HomeFileRowProps {
  readonly item: HomeFileItem
  /** Selection mode: a tap picks or unpicks the row instead of opening it, and [⋯] is hidden. */
  readonly selecting: boolean
  readonly selected: boolean
  readonly onOpen: () => void
  readonly onToggleSelect: () => void
  /** Long press (and the menu's "Select") enters selection with this row picked. */
  readonly onStartSelect: () => void
  readonly onOpenMenu: () => void
  /** Optional mobile bridge client for lazy document thumbnail loading. */
  readonly client?: MobileClient | null
  /** Drawn under the row (e.g. the "permission expired" notice). */
  readonly footer?: ReactNode
}

/**
 * One file row of the home lists (spec 3.3, design system 5.10): type icon or lazy thumbnail,
 * name, a second line with type · time · location, a star when it is a favorite, and [⋯]. 64 high.
 */
export function HomeFileRow({
  item,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
  onStartSelect,
  onOpenMenu,
  client,
  footer,
}: HomeFileRowProps) {
  const { lang, t } = useMobileLocale()
  const rowRef = useRef<HTMLLIElement | null>(null)
  const longPress = useLongPress(onStartSelect, !selecting)
  const cacheKey = `${item.key}:${item.time ?? 0}`
  const thumbnail = useHomeThumbnail(client, item.fileRef, cacheKey, rowRef)
  const time = formatRowTime(item.time, htmlLang(lang))
  const typeLabel = (item.format ?? splitFileName(item.name).ext.slice(1)).toUpperCase()
  const meta = [typeLabel, time, item.location ?? ''].filter((part) => part.length > 0)

  const onClick = () => {
    if (longPress.consumeClick()) return
    if (selecting) onToggleSelect()
    else onOpen()
  }

  return (
    <li
      ref={rowRef}
      className="mobile-doc-list-item home-act-row"
      data-testid={`home-file-row-${item.key}`}
      data-selected={selecting && selected ? 'true' : undefined}
    >
      <div className="home-act-row-line">
        <button
          type="button"
          className="mobile-doc-row-btn home-act-row-btn"
          data-testid={`home-file-row-open-${item.key}`}
          role={selecting ? 'checkbox' : undefined}
          aria-checked={selecting ? selected : undefined}
          onClick={onClick}
          {...longPress.handlers}
        >
          {selecting && (
            <span className="home-act-row-check" aria-hidden="true">
              {selected ? <HomeActCheckedIcon size={22} /> : <HomeActUncheckedIcon size={22} />}
            </span>
          )}
          <span
            className="home-act-thumb"
            data-thumb-kind={thumbnail.kind}
            data-testid={`home-file-thumb-${item.key}`}
            aria-hidden="true"
          >
            {thumbnail.kind === 'image' ? (
              <img
                className="home-act-thumb-img"
                src={`data:${thumbnail.mime};base64,${thumbnail.dataBase64}`}
                alt=""
                loading="lazy"
              />
            ) : thumbnail.kind === 'text' ? (
              <>
                <span className="home-act-thumb-paper">
                  {thumbnail.title && (
                    <span className="home-act-thumb-title">{thumbnail.title}</span>
                  )}
                  <span className="home-act-thumb-snippet">{thumbnail.snippet}</span>
                </span>
                <span className="home-act-thumb-list-fallback">
                  {item.format ? (
                    <DocTypeIcon format={item.format} size={34} />
                  ) : (
                    <span className="home-act-row-glyph">
                      {isPictureItem(item) ? <IconImage size={20} /> : <IconFileText size={20} />}
                    </span>
                  )}
                </span>
              </>
            ) : item.format ? (
              <DocTypeIcon format={item.format} size={34} />
            ) : (
              <span className="home-act-row-glyph">
                {isPictureItem(item) ? <IconImage size={20} /> : <IconFileText size={20} />}
              </span>
            )}
            {thumbnail.kind !== 'none' && typeLabel && (
              <span className="home-act-thumb-badge">{typeLabel}</span>
            )}
          </span>
          <span className="mobile-doc-row-main">
            <span className="mobile-doc-row-info">
              <span className="mobile-list-name">{item.name}</span>
              {meta.length > 0 && <span className="mobile-doc-row-meta">{meta.join(' · ')}</span>}
            </span>
            {item.favorite && (
              <span className="home-act-star" role="img" aria-label={t('homeActFavoriteMark')}>
                <HomeActStarIcon size={16} fill="currentColor" />
              </span>
            )}
          </span>
        </button>
        {!selecting && (
          <button
            type="button"
            className="mobile-icon-btn"
            data-testid={`home-file-row-more-${item.key}`}
            aria-haspopup="dialog"
            aria-label={t('homeActRowMenu', { name: item.name })}
            title={t('homeActRowMenu', { name: item.name })}
            onClick={onOpenMenu}
          >
            <IconMore size={20} />
          </button>
        )}
      </div>
      {footer}
    </li>
  )
}
