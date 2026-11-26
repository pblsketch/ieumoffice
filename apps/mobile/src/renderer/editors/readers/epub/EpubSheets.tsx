// The sheets of the EPUB reading screen: contents, search, reading settings and the outside-link
// confirmation. Each is a design-system Sheet, so Android Back closes the top one first.
import { useEffect, useRef, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import type { ReaderSettings } from '@genoffice/mobile-bridge/readers'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { Sheet } from '../../../components/Sheet'
import type { ToastRequest } from '../../../components/Toast'
import type { MobileStringKey } from '../../../i18n/strings'
import { copyText, readerExternalUrlOpener } from '../shared/externalUrl'
import type { ReaderTocEntry } from './book'
import type { EpubSearchState } from './epubReader'
import { FONT_SCALES, LINE_HEIGHTS, READER_LAYOUTS, READER_THEMES } from './epubView'
import { SEARCH_LIMIT, type BookSearchHit } from './search'
import { stepFontScale } from '../../../../../../epub/src/renderer/reader/view-prefs'

export type Translate = (key: MobileStringKey, params?: Params) => string

export function EpubTocSheet({
  open,
  entries,
  currentIndex,
  onPick,
  onClose,
  t,
}: {
  readonly open: boolean
  readonly entries: readonly ReaderTocEntry[]
  readonly currentIndex: number
  readonly onPick: (entry: ReaderTocEntry) => void
  readonly onClose: () => void
  readonly t: Translate
}) {
  return (
    <Sheet
      open={open}
      title={t('readersToc')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      testId="epub-toc-sheet"
    >
      {entries.length === 0 ? (
        <p className="epub-sheet-note">{t('readersEpubTocEmpty')}</p>
      ) : (
        <ul className="epub-toc-list">
          {entries.map((entry, i) => (
            <li key={i}>
              <button
                type="button"
                className="epub-toc-entry"
                data-depth={Math.min(entry.depth, 6)}
                style={{
                  paddingInlineStart: `calc(var(--m-space-3) + var(--m-space-4) * ${Math.min(Math.max(entry.depth, 1), 6) - 1})`,
                }}
                aria-current={i === currentIndex ? 'true' : undefined}
                disabled={entry.spineIndex === null}
                onClick={() => onPick(entry)}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

export function EpubSearchSheet({
  open,
  search,
  onQuery,
  onPick,
  chapterName,
  onClose,
  t,
}: {
  readonly open: boolean
  readonly search: EpubSearchState
  readonly onQuery: (query: string) => void
  readonly onPick: (hit: BookSearchHit) => void
  readonly chapterName: (spineIndex: number) => string
  readonly onClose: () => void
  readonly t: Translate
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  const result = search.result
  return (
    <Sheet
      open={open}
      title={t('readersSearch')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      initialDetent="large"
      testId="epub-search-sheet"
    >
      <div className="epub-search">
        <input
          ref={inputRef}
          type="search"
          className="mobile-input"
          value={search.query}
          placeholder={t('readersSearchPlaceholder')}
          aria-label={t('readersSearch')}
          onChange={(e) => onQuery(e.target.value)}
          data-testid="epub-search-input"
        />
        <p className="epub-sheet-note" aria-live="polite" data-testid="epub-search-status">
          {search.running
            ? t('readersSearching')
            : result
              ? result.hits.length === 0
                ? t('readersSearchNone')
                : result.truncated
                  ? `${t('readersSearchCount', { count: result.hits.length })} · ${t('readersSearchLimited', { limit: SEARCH_LIMIT })}`
                  : t('readersSearchCount', { count: result.hits.length })
              : ''}
        </p>
        {result && result.hits.length > 0 && (
          <ul className="epub-search-list">
            {result.hits.map((hit, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="epub-search-hit"
                  onClick={() => onPick(hit)}
                  data-testid="epub-search-hit"
                >
                  <span className="epub-search-chapter">{chapterName(hit.spineIndex)}</span>
                  <span className="epub-search-snippet">
                    {hit.before}
                    <mark>{hit.match}</mark>
                    {hit.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}

const THEME_TEXT: Record<ReaderSettings['theme'], MobileStringKey> = {
  app: 'readersEpubThemeApp',
  light: 'readersEpubThemeLight',
  sepia: 'readersEpubThemeSepia',
  dark: 'readersEpubThemeDark',
}

const LAYOUT_TEXT: Record<ReaderSettings['layout'], MobileStringKey> = {
  paged: 'readersEpubFlowPaged',
  scroll: 'readersEpubFlowScrolled',
}

function ChoiceGroup<T>({
  label,
  values,
  current,
  text,
  disabled = false,
  onPick,
  testId,
}: {
  readonly label: string
  readonly values: readonly T[]
  readonly current: T
  readonly text: (value: T) => string
  readonly disabled?: boolean
  readonly onPick: (value: T) => void
  readonly testId: string
}) {
  return (
    <section className="epub-settings-group" aria-label={label}>
      <h3 className="epub-settings-title">{label}</h3>
      <div className="mobile-choice-grid" role="radiogroup" aria-label={label} data-testid={testId}>
        {values.map((value, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            className="mobile-choice-btn"
            aria-checked={value === current}
            disabled={disabled}
            onClick={() => onPick(value)}
          >
            {text(value)}
          </button>
        ))}
      </div>
    </section>
  )
}

export function EpubSettingsSheet({
  open,
  settings,
  fixedLayout,
  onChange,
  onClose,
  t,
}: {
  readonly open: boolean
  readonly settings: ReaderSettings
  /** pre-paginated: only the background can change */
  readonly fixedLayout: boolean
  readonly onChange: (patch: Partial<ReaderSettings>) => void
  readonly onClose: () => void
  readonly t: Translate
}) {
  const scale = settings.fontScale
  return (
    <Sheet
      open={open}
      title={t('readersSettings')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      testId="epub-settings-sheet"
    >
      <div className="epub-settings">
        {fixedLayout && (
          <p className="epub-sheet-note" data-testid="epub-fixed-note">
            {t('readersEpubFixedLayoutNote')}
          </p>
        )}
        <section className="epub-settings-group" aria-label={t('readersEpubFontSize')}>
          <h3 className="epub-settings-title">{t('readersEpubFontSize')}</h3>
          <div className="epub-font-row">
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              disabled={fixedLayout || scale <= FONT_SCALES[0]}
              onClick={() => onChange({ fontScale: stepFontScale(scale, -1) })}
              data-testid="epub-font-smaller"
            >
              {t('readersEpubFontSmaller')}
            </button>
            <span className="epub-font-value" aria-live="polite" data-testid="epub-font-value">
              {t('readersEpubFontPercent', { percent: Math.round(scale * 100) })}
            </span>
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              disabled={fixedLayout || scale >= FONT_SCALES[FONT_SCALES.length - 1]!}
              onClick={() => onChange({ fontScale: stepFontScale(scale, 1) })}
              data-testid="epub-font-larger"
            >
              {t('readersEpubFontLarger')}
            </button>
          </div>
        </section>
        <ChoiceGroup
          label={t('readersEpubLineHeight')}
          values={LINE_HEIGHTS}
          current={settings.lineHeight}
          text={(value) => (value === null ? t('readersEpubLineHeightBook') : String(value))}
          disabled={fixedLayout}
          onPick={(lineHeight) => onChange({ lineHeight })}
          testId="epub-line-height"
        />
        <ChoiceGroup
          label={t('readersEpubTheme')}
          values={READER_THEMES}
          current={settings.theme}
          text={(value) => t(THEME_TEXT[value])}
          onPick={(theme) => onChange({ theme })}
          testId="epub-theme"
        />
        <ChoiceGroup
          label={t('readersEpubFlow')}
          values={READER_LAYOUTS}
          current={settings.layout}
          text={(value) => t(LAYOUT_TEXT[value])}
          disabled={fixedLayout}
          onPick={(layout) => onChange({ layout })}
          testId="epub-layout"
        />
      </div>
    </Sheet>
  )
}

/** True for the addresses T6's bridge opens: https only. */
function opensOutside(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export function EpubLinkSheet({
  url,
  client,
  showToast,
  onClose,
  t,
}: {
  readonly url: string | null
  readonly client: MobileClient
  readonly showToast: (request: ToastRequest | string) => void
  readonly onClose: () => void
  readonly t: Translate
}) {
  const [openFailed, setOpenFailed] = useState(false)
  useEffect(() => setOpenFailed(false), [url])
  // read at use: the opener is present once track T6 is on this branch
  const opener = readerExternalUrlOpener
  const canOpen = url !== null && opener !== null && !openFailed && opensOutside(url)
  return (
    <Sheet
      open={url !== null}
      title={t('readersLinkOpenTitle')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      testId="epub-link-sheet"
    >
      <div className="epub-link">
        <p className="epub-link-url" data-testid="epub-link-url">
          {url}
        </p>
        <div className="epub-link-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={() => {
              if (url === null) return
              void copyText(url).then((ok) => {
                showToast(t(ok ? 'readersLinkCopied' : 'readersLinkCopyFailed'))
                if (ok) onClose()
              })
            }}
            data-testid="epub-link-copy"
          >
            {t('readersLinkCopy')}
          </button>
          {canOpen && (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-primary"
              onClick={() => {
                // opening refused: keep the sheet and offer the copy only
                opener(client, url).then(onClose, () => setOpenFailed(true))
              }}
              data-testid="epub-link-open"
            >
              {t('readersLinkOpen')}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
