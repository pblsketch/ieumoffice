/**
 * Multi-scope Find & Replace tab for the HWP left workpane.
 *
 * Searches across body paragraphs, tables (including nested tables), text boxes,
 * and footnotes/endnotes via the editor plugin bridge (`findMatches`,
 * `replaceFindMatches`, `revealFindMatch`, `listStyles`). Renders all matches
 * without truncation using fixed-row windowing, supports paragraph-style and
 * character-format filtering (with or without a text query), supports replacing
 * the active match, checked matches, or all matches in a single undo step, and
 * surfaces a manual refresh banner when the document changes externally.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import type {
  FindCharFormat,
  FindMatch,
  FindOptions,
  FindReplaceSelection,
  FindReplaceTarget,
  FindScopeKind,
  FindUnsupportedScope,
} from '../../../studio-plugin/find.mjs'
import type { AgentBridge } from '../ai/agent-bridge'
import { useFindI18n, type FindStringKey } from '../i18n/find'
import './find-tab.css'

/** Fixed pixel height of each virtualized match row. */
export const FIND_ROW_HEIGHT = 56
/** Extra rows rendered above and below the scroll viewport. */
export const FIND_VIRTUAL_OVERSCAN = 6
/** Fallback viewport height used before layout measurement (e.g. jsdom). */
export const FIND_FALLBACK_VIEWPORT_HEIGHT = 400

export type FindTabBridge = Pick<
  AgentBridge,
  'findMatches' | 'replaceFindMatches' | 'revealFindMatch' | 'listStyles'
> &
  Partial<Pick<AgentBridge, 'documentRevision'>>

export interface FindTabProps {
  bridge: FindTabBridge
  /** Increments whenever the document changes externally (App.tsx docTick). */
  changeTick?: number
  /** Increments when Ctrl+F or View > Workpane > Find asks to focus the search input. */
  focusTick?: number
  /** Whether the Find tab panel is currently visible on screen. */
  visible?: boolean
}

type TriState = 'any' | 'on' | 'off'

interface ReplaceNotice {
  replaced: number
  skippedObjects: number
  skippedCitations: number
  skippedStale: number
}

interface ErrorNotice {
  key: 'findErrorFailed' | 'findReplaceErrorFailed'
  error: string
}

function cycleTriState(current: TriState): TriState {
  if (current === 'any') return 'on'
  if (current === 'on') return 'off'
  return 'any'
}

function triStateLabelKey(state: TriState): FindStringKey {
  if (state === 'on') return 'findTriOn'
  if (state === 'off') return 'findTriOff'
  return 'findTriAny'
}

function scopeLabelKey(kind: FindScopeKind): FindStringKey {
  switch (kind) {
    case 'body':
      return 'findScopeBody'
    case 'table':
      return 'findScopeTable'
    case 'textbox':
      return 'findScopeTextbox'
    case 'footnote':
      return 'findScopeFootnote'
    case 'endnote':
      return 'findScopeEndnote'
  }
}

function unsupportedScopeLabelKey(scope: FindUnsupportedScope): FindStringKey {
  switch (scope) {
    case 'nested_table':
      return 'findScopeNestedTable'
    case 'footnote':
      return 'findScopeFootnote'
    case 'endnote':
      return 'findScopeEndnote'
  }
}

function toReplaceTarget(match: FindMatch): FindReplaceTarget {
  return {
    kind: match.kind,
    sec: match.sec,
    para: match.para,
    offset: match.offset,
    length: match.length,
    matchText: match.matchText,
    ...(match.path ? { path: match.path } : {}),
    ...(match.noteControl !== undefined ? { noteControl: match.noteControl } : {}),
    ...(match.notePara !== undefined ? { notePara: match.notePara } : {}),
  }
}

function normalizePickerHex(raw: string): string {
  const trimmed = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`
  return '#000000'
}

function parsePositiveSize(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function FindTab({
  bridge,
  changeTick = 0,
  focusTick = 0,
  visible = true,
}: FindTabProps): ReactElement {
  const { t } = useFindI18n()

  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [styles, setStyles] = useState<string[]>([])
  const [styleFilter, setStyleFilter] = useState('')
  const [boldFilter, setBoldFilter] = useState<TriState>('any')
  const [italicFilter, setItalicFilter] = useState<TriState>('any')
  const [underlineFilter, setUnderlineFilter] = useState<TriState>('any')
  const [fontFilter, setFontFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [colorFilter, setColorFilter] = useState('')

  const [replaceQuery, setReplaceQuery] = useState('')

  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [matches, setMatches] = useState<FindMatch[]>([])
  const [total, setTotal] = useState(0)
  const [unsupportedScopes, setUnsupportedScopes] = useState<FindUnsupportedScope[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(() => new Set())
  const [lastExecutedOptions, setLastExecutedOptions] = useState<FindOptions | null>(null)

  const [regexError, setRegexError] = useState<string | null>(null)
  const [errorNotice, setErrorNotice] = useState<ErrorNotice | null>(null)
  const [replaceNotice, setReplaceNotice] = useState<ReplaceNotice | null>(null)
  const [stale, setStale] = useState(false)

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FIND_FALLBACK_VIEWPORT_HEIGHT)

  const queryInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const lastFocusTickRef = useRef(0)
  const pendingFocusRef = useRef(false)
  const stylesLoadedRef = useRef(false)
  const searchSeqRef = useRef(0)
  const hasSearchedRef = useRef(false)
  const selfReplacingRef = useRef(false)
  const lastSearchRevisionRef = useRef<number | null>(null)
  const lastChangeTickRef = useRef(changeTick)

  hasSearchedRef.current = hasSearched

  const refreshStyles = useCallback(async () => {
    try {
      const result = await bridge.listStyles()
      if (result && Array.isArray(result.paragraph)) {
        setStyles(result.paragraph)
        stylesLoadedRef.current = true
      }
    } catch {
      // Editor may not be ready yet; retry on next open or filter expansion.
    }
  }, [bridge])

  // Load paragraph styles once the tab becomes visible, and refresh when filters open.
  useEffect(() => {
    if (!visible) return
    if (!stylesLoadedRef.current || filtersOpen) {
      void refreshStyles()
    }
  }, [visible, filtersOpen, changeTick, refreshStyles])

  // Focus and select query text whenever focusTick increments while visible (or upon becoming visible).
  useEffect(() => {
    if (focusTick > lastFocusTickRef.current) {
      lastFocusTickRef.current = focusTick
      pendingFocusRef.current = true
    }
    if (visible && pendingFocusRef.current) {
      pendingFocusRef.current = false
      const input = queryInputRef.current
      if (input) {
        input.focus()
        input.select()
      }
    }
  }, [focusTick, visible])

  // Mark results stale on external document changes; never auto-re-search.
  // When `documentRevision` is available, compare revisions so a debounced
  // changeTick echo from our own replace does not falsely mark fresh results stale.
  useEffect(() => {
    if (changeTick === lastChangeTickRef.current) return
    lastChangeTickRef.current = changeTick
    if (!hasSearchedRef.current || selfReplacingRef.current) return
    const readRevision = bridge.documentRevision
    const recordedRevision = lastSearchRevisionRef.current
    if (typeof readRevision === 'function' && recordedRevision !== null) {
      let cancelled = false
      const seqAtEffect = searchSeqRef.current
      void readRevision()
        .then((currentRevision) => {
          if (cancelled || searchSeqRef.current !== seqAtEffect) return
          if (typeof currentRevision === 'number' && currentRevision <= recordedRevision) return
          setStale(true)
        })
        .catch(() => {
          if (!cancelled && searchSeqRef.current === seqAtEffect) setStale(true)
        })
      return () => {
        cancelled = true
      }
    }
    setStale(true)
    return undefined
  }, [changeTick, bridge])

  const hasMatches = matches.length > 0

  // Track virtualized list viewport height via ResizeObserver when available.
  useEffect(() => {
    if (!hasMatches) return
    const el = viewportRef.current
    if (!el) return
    const syncHeight = (): void => {
      if (el.clientHeight > 0) setViewportHeight(el.clientHeight)
    }
    syncHeight()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height ?? el.clientHeight
      if (measured > 0) setViewportHeight(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMatches])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (styleFilter !== '') count += 1
    if (boldFilter !== 'any') count += 1
    if (italicFilter !== 'any') count += 1
    if (underlineFilter !== 'any') count += 1
    if (fontFilter.trim() !== '') count += 1
    if (parsePositiveSize(sizeFilter) !== undefined) count += 1
    if (colorFilter.trim() !== '') count += 1
    return count
  }, [styleFilter, boldFilter, italicFilter, underlineFilter, fontFilter, sizeFilter, colorFilter])

  const buildCurrentOptions = useCallback((): FindOptions | null => {
    const charFormat: FindCharFormat = {}
    let hasCharFormat = false
    if (boldFilter !== 'any') {
      charFormat.bold = boldFilter === 'on'
      hasCharFormat = true
    }
    if (italicFilter !== 'any') {
      charFormat.italic = italicFilter === 'on'
      hasCharFormat = true
    }
    if (underlineFilter !== 'any') {
      charFormat.underline = underlineFilter === 'on'
      hasCharFormat = true
    }
    const trimmedFont = fontFilter.trim()
    if (trimmedFont) {
      charFormat.font = trimmedFont
      hasCharFormat = true
    }
    const parsedSize = parsePositiveSize(sizeFilter)
    if (parsedSize !== undefined) {
      charFormat.size = parsedSize
      hasCharFormat = true
    }
    const trimmedColor = colorFilter.trim()
    if (trimmedColor) {
      charFormat.color = trimmedColor
      hasCharFormat = true
    }

    const hasQuery = query.length > 0
    const hasStyle = styleFilter !== ''
    if (!hasQuery && !hasStyle && !hasCharFormat) return null

    const options: FindOptions = {}
    if (hasQuery) options.query = query
    if (caseSensitive) options.caseSensitive = true
    if (wholeWord) options.wholeWord = true
    if (regex) options.regex = true
    if (hasStyle) options.style = styleFilter
    if (hasCharFormat) options.charFormat = charFormat
    return options
  }, [
    query,
    caseSensitive,
    wholeWord,
    regex,
    styleFilter,
    boldFilter,
    italicFilter,
    underlineFilter,
    fontFilter,
    sizeFilter,
    colorFilter,
  ])

  const canSearch = query.length > 0 || activeFilterCount > 0

  const executeSearch = useCallback(
    async (options: FindOptions, opts?: { keepNotice?: boolean }) => {
      const seq = ++searchSeqRef.current
      setSearching(true)
      setRegexError(null)
      setErrorNotice(null)
      if (!opts?.keepNotice) setReplaceNotice(null)

      try {
        let revBefore: number | null = null
        if (typeof bridge.documentRevision === 'function') {
          try {
            const rev = await bridge.documentRevision()
            if (typeof rev === 'number') revBefore = rev
          } catch {
            // Fall back to changeTick tracking when revision lookup fails.
          }
        }
        const result = await bridge.findMatches(options)
        if (seq !== searchSeqRef.current) return
        lastSearchRevisionRef.current = revBefore
        if (!result.ok) {
          setRegexError(result.error)
          setMatches([])
          setTotal(0)
          setUnsupportedScopes([])
          setActiveIndex(null)
          setCheckedIndices(new Set())
          setHasSearched(true)
          setLastExecutedOptions(options)
          setStale(false)
          return
        }
        setMatches(result.matches)
        setTotal(result.total)
        setUnsupportedScopes(result.unsupportedScopes ?? [])
        setActiveIndex(result.matches.length > 0 ? result.matches[0].index : null)
        setCheckedIndices(new Set())
        setHasSearched(true)
        setLastExecutedOptions(options)
        setStale(false)
        setScrollTop(0)
        if (viewportRef.current) viewportRef.current.scrollTop = 0
      } catch (err) {
        if (seq !== searchSeqRef.current) return
        setErrorNotice({
          key: 'findErrorFailed',
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (seq === searchSeqRef.current) setSearching(false)
      }
    },
    [bridge],
  )

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const options = buildCurrentOptions()
    if (!options) return
    void executeSearch(options)
  }

  const handleRefreshStale = (): void => {
    const options = lastExecutedOptions ?? buildCurrentOptions()
    if (!options) return
    void executeSearch(options)
  }

  const clearFilters = (): void => {
    setStyleFilter('')
    setBoldFilter('any')
    setItalicFilter('any')
    setUnderlineFilter('any')
    setFontFilter('')
    setSizeFilter('')
    setColorFilter('')
  }

  const activeMatch = useMemo(
    () => (activeIndex === null ? null : (matches.find((m) => m.index === activeIndex) ?? null)),
    [matches, activeIndex],
  )

  const checkedCount = checkedIndices.size
  const allChecked = matches.length > 0 && checkedCount === matches.length
  const someChecked = checkedCount > 0 && checkedCount < matches.length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someChecked
    }
  }, [someChecked])

  const toggleSelectAll = (): void => {
    if (allChecked) {
      setCheckedIndices(new Set())
    } else {
      setCheckedIndices(new Set(matches.map((m) => m.index)))
    }
  }

  const toggleRowCheck = (matchIndex: number): void => {
    setCheckedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(matchIndex)) next.delete(matchIndex)
      else next.add(matchIndex)
      return next
    })
  }

  const handleActivateMatch = (match: FindMatch): void => {
    setActiveIndex(match.index)
    void Promise.resolve(bridge.revealFindMatch(match)).catch(() => undefined)
  }

  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, match: FindMatch): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleActivateMatch(match)
    }
  }

  const runReplace = useCallback(
    async (selection: FindReplaceSelection) => {
      const options = lastExecutedOptions
      if (!options || replacing) return
      selfReplacingRef.current = true
      setReplacing(true)
      setErrorNotice(null)
      setReplaceNotice(null)
      try {
        const result = await bridge.replaceFindMatches(options, replaceQuery, selection)
        if (!result.ok) {
          setErrorNotice({ key: 'findReplaceErrorFailed', error: result.error })
          return
        }
        setReplaceNotice({
          replaced: result.replaced,
          skippedObjects: result.skippedObjects,
          skippedCitations: result.skippedCitations,
          skippedStale: result.skippedStale ?? 0,
        })
        await executeSearch(options, { keepNotice: true })
      } catch (err) {
        setErrorNotice({
          key: 'findReplaceErrorFailed',
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        selfReplacingRef.current = false
        setReplacing(false)
      }
    },
    [bridge, executeSearch, lastExecutedOptions, replaceQuery, replacing],
  )

  const handleReplaceThis = (): void => {
    if (!activeMatch || stale) return
    void runReplace({ targets: [toReplaceTarget(activeMatch)] })
  }

  const handleReplaceSelected = (): void => {
    if (checkedIndices.size === 0 || stale) return
    const targets = matches.filter((m) => checkedIndices.has(m.index)).map(toReplaceTarget)
    if (targets.length === 0) return
    void runReplace({ targets })
  }

  const handleReplaceAll = (): void => {
    if (matches.length === 0) return
    void runReplace('all')
  }

  // Virtualized window math (fixed row height, never truncates matches array).
  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : FIND_FALLBACK_VIEWPORT_HEIGHT
  const rawStartIndex = Math.floor(scrollTop / FIND_ROW_HEIGHT)
  const visibleRowCount = Math.ceil(effectiveViewportHeight / FIND_ROW_HEIGHT)
  const startIndex = Math.max(0, rawStartIndex - FIND_VIRTUAL_OVERSCAN)
  const endIndex = Math.min(matches.length, rawStartIndex + visibleRowCount + FIND_VIRTUAL_OVERSCAN)
  const visibleMatches = useMemo(
    () => matches.slice(startIndex, endIndex),
    [matches, startIndex, endIndex],
  )

  const styleOptions = useMemo(() => {
    if (!styleFilter || styles.includes(styleFilter)) return styles
    return [styleFilter, ...styles]
  }, [styles, styleFilter])

  const busy = searching || replacing

  return (
    <div className="find-tab" data-find-tab="true">
      <form className="find-search-form" onSubmit={handleSubmit}>
        <div className="find-input-row">
          <div className="find-input-wrap">
            <input
              ref={queryInputRef}
              type="text"
              className={`find-input${regexError ? ' has-error' : ''}`}
              value={query}
              placeholder={t('findQueryPlaceholder')}
              aria-label={t('findQueryLabel')}
              aria-invalid={regexError !== null}
              data-find-input="query"
              onChange={(e) => {
                setQuery(e.target.value)
                if (regexError) setRegexError(null)
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="find-input-clear"
                aria-label={t('findClearQuery')}
                title={t('findClearQuery')}
                onClick={() => {
                  setQuery('')
                  setRegexError(null)
                  queryInputRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            type="submit"
            className="find-submit-btn"
            disabled={!canSearch || busy}
            data-find-action="search"
          >
            {searching ? t('findSearching') : t('findSearchButton')}
          </button>
        </div>

        {regexError !== null && (
          <div className="find-inline-error" role="alert" data-find-error="regex">
            {t('findRegexInvalid', { error: regexError })}
          </div>
        )}

        <div className="find-options-row">
          <button
            type="button"
            className={`find-opt-btn${caseSensitive ? ' active' : ''}`}
            aria-pressed={caseSensitive}
            title={t('findOptCase')}
            aria-label={t('findOptCase')}
            data-find-option="caseSensitive"
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            className={`find-opt-btn${wholeWord ? ' active' : ''}`}
            aria-pressed={wholeWord}
            title={t('findOptWholeWord')}
            aria-label={t('findOptWholeWord')}
            data-find-option="wholeWord"
            onClick={() => setWholeWord((v) => !v)}
          >
            W
          </button>
          <button
            type="button"
            className={`find-opt-btn${regex ? ' active' : ''}`}
            aria-pressed={regex}
            title={t('findOptRegex')}
            aria-label={t('findOptRegex')}
            data-find-option="regex"
            onClick={() => {
              setRegex((v) => !v)
              setRegexError(null)
            }}
          >
            .*
          </button>

          <button
            type="button"
            className={`find-filters-toggle${filtersOpen ? ' open' : ''}${activeFilterCount > 0 ? ' has-active' : ''}`}
            aria-expanded={filtersOpen}
            data-find-action="toggle-filters"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <span>{t('findFiltersToggle')}</span>
            {activeFilterCount > 0 && (
              <span className="find-filters-badge" data-find-filter-count={activeFilterCount}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="find-filters-drawer" data-find-filters="open">
            <label className="find-filter-field">
              <span className="find-filter-label">{t('findStyleLabel')}</span>
              <select
                className="find-select"
                value={styleFilter}
                aria-label={t('findStyleLabel')}
                data-find-filter="style"
                onChange={(e) => setStyleFilter(e.target.value)}
              >
                <option value="">{t('findStyleAll')}</option>
                {styleOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <div className="find-format-toggles">
              <button
                type="button"
                className={`find-tri-btn state-${boldFilter}`}
                data-find-filter="bold"
                data-state={boldFilter}
                aria-label={`${t('findFormatBold')}: ${t(triStateLabelKey(boldFilter))}`}
                title={`${t('findFormatBold')}: ${t(triStateLabelKey(boldFilter))}`}
                onClick={() => setBoldFilter((v) => cycleTriState(v))}
              >
                <span className="find-tri-glyph find-tri-bold">B</span>
                <span className="find-tri-state">{t(triStateLabelKey(boldFilter))}</span>
              </button>
              <button
                type="button"
                className={`find-tri-btn state-${italicFilter}`}
                data-find-filter="italic"
                data-state={italicFilter}
                aria-label={`${t('findFormatItalic')}: ${t(triStateLabelKey(italicFilter))}`}
                title={`${t('findFormatItalic')}: ${t(triStateLabelKey(italicFilter))}`}
                onClick={() => setItalicFilter((v) => cycleTriState(v))}
              >
                <span className="find-tri-glyph find-tri-italic">I</span>
                <span className="find-tri-state">{t(triStateLabelKey(italicFilter))}</span>
              </button>
              <button
                type="button"
                className={`find-tri-btn state-${underlineFilter}`}
                data-find-filter="underline"
                data-state={underlineFilter}
                aria-label={`${t('findFormatUnderline')}: ${t(triStateLabelKey(underlineFilter))}`}
                title={`${t('findFormatUnderline')}: ${t(triStateLabelKey(underlineFilter))}`}
                onClick={() => setUnderlineFilter((v) => cycleTriState(v))}
              >
                <span className="find-tri-glyph find-tri-underline">U</span>
                <span className="find-tri-state">{t(triStateLabelKey(underlineFilter))}</span>
              </button>
            </div>

            <div className="find-filter-grid">
              <label className="find-filter-field">
                <span className="find-filter-label">{t('findFormatFont')}</span>
                <input
                  type="text"
                  className="find-input find-input-compact"
                  value={fontFilter}
                  placeholder={t('findFormatFontPlaceholder')}
                  aria-label={t('findFormatFont')}
                  data-find-filter="font"
                  onChange={(e) => setFontFilter(e.target.value)}
                />
              </label>

              <label className="find-filter-field find-filter-size">
                <span className="find-filter-label">{t('findFormatSize')}</span>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  className="find-input find-input-compact"
                  value={sizeFilter}
                  aria-label={t('findFormatSize')}
                  data-find-filter="size"
                  onChange={(e) => setSizeFilter(e.target.value)}
                />
              </label>
            </div>

            <div className="find-filter-field">
              <span className="find-filter-label">{t('findFormatColor')}</span>
              <div className="find-color-row">
                <input
                  type="color"
                  className="find-color-picker"
                  value={normalizePickerHex(colorFilter)}
                  aria-label={t('findFormatColorPick')}
                  title={t('findFormatColorPick')}
                  data-find-filter="color-picker"
                  onChange={(e) => setColorFilter(e.target.value)}
                />
                <input
                  type="text"
                  className="find-input find-input-compact"
                  value={colorFilter}
                  placeholder="#000000"
                  aria-label={t('findFormatColor')}
                  data-find-filter="color"
                  onChange={(e) => setColorFilter(e.target.value)}
                />
                {colorFilter.trim() !== '' && (
                  <button
                    type="button"
                    className="find-color-clear"
                    aria-label={t('findFormatColorClear')}
                    title={t('findFormatColorClear')}
                    onClick={() => setColorFilter('')}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="find-filters-footer">
                <span className="find-filters-summary">
                  {t('findFiltersCount', { count: activeFilterCount })}
                </span>
                <button
                  type="button"
                  className="find-link-btn"
                  data-find-action="clear-filters"
                  onClick={clearFilters}
                >
                  {t('findFiltersClear')}
                </button>
              </div>
            )}
          </div>
        )}
      </form>

      <div className="find-replace-section">
        <input
          type="text"
          className="find-input"
          value={replaceQuery}
          placeholder={t('findReplacePlaceholder')}
          aria-label={t('findReplaceLabel')}
          data-find-input="replace"
          onChange={(e) => setReplaceQuery(e.target.value)}
        />
        <div className="find-replace-actions">
          <button
            type="button"
            className="find-action-btn"
            disabled={!activeMatch || !lastExecutedOptions || busy || stale}
            data-find-action="replace-this"
            onClick={handleReplaceThis}
          >
            {t('findReplaceThis')}
          </button>
          <button
            type="button"
            className="find-action-btn"
            disabled={checkedCount === 0 || !lastExecutedOptions || busy || stale}
            data-find-action="replace-selected"
            onClick={handleReplaceSelected}
          >
            {checkedCount > 0
              ? `${t('findReplaceSelected')} (${checkedCount})`
              : t('findReplaceSelected')}
          </button>
          <button
            type="button"
            className="find-action-btn"
            disabled={matches.length === 0 || !lastExecutedOptions || busy}
            data-find-action="replace-all"
            onClick={handleReplaceAll}
          >
            {t('findReplaceAll')}
          </button>
        </div>
      </div>

      {stale && (
        <div className="find-stale-banner" role="status" data-find-stale="true">
          <span className="find-stale-text">{t('findStaleNotice')}</span>
          <button
            type="button"
            className="find-stale-btn"
            disabled={busy}
            data-find-action="stale-refresh"
            onClick={handleRefreshStale}
          >
            {t('findStaleAction')}
          </button>
        </div>
      )}

      {errorNotice !== null && (
        <div className="find-general-error" role="alert" data-find-error="general">
          {t(errorNotice.key, { error: errorNotice.error })}
        </div>
      )}

      {replaceNotice !== null && (
        <div className="find-replace-notice" role="status" data-find-notice="replace">
          <span>
            {replaceNotice.replaced > 0
              ? t('findReplaceDone', { replaced: replaceNotice.replaced })
              : t('findReplaceNone')}
          </span>
          {replaceNotice.skippedObjects > 0 && (
            <span className="find-notice-detail" data-find-skipped="objects">
              {t('findReplaceSkippedObjects', { count: replaceNotice.skippedObjects })}
            </span>
          )}
          {replaceNotice.skippedCitations > 0 && (
            <span className="find-notice-detail" data-find-skipped="citations">
              {t('findReplaceSkippedCitations', { count: replaceNotice.skippedCitations })}
            </span>
          )}
          {replaceNotice.skippedStale > 0 && (
            <span className="find-notice-detail" data-find-skipped="stale">
              {t('findReplaceSkippedStale', { count: replaceNotice.skippedStale })}
            </span>
          )}
        </div>
      )}

      {hasSearched && regexError === null && unsupportedScopes.length > 0 && (
        <div className="find-replace-notice" role="status" data-find-notice="unsupported-scopes">
          {t('findUnsupportedFilterScopes', {
            scopes: unsupportedScopes.map((scope) => t(unsupportedScopeLabelKey(scope))).join(', '),
          })}
        </div>
      )}

      {hasSearched && regexError === null && (
        <div className="find-summary-bar" data-find-summary="true">
          <span className="find-summary-count" data-find-total={total}>
            {t('findResultCount', { count: total })}
          </span>
          {matches.length > 0 && (
            <label className="find-select-all">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allChecked}
                data-find-action="select-all"
                onChange={toggleSelectAll}
              />
              <span>{allChecked ? t('findDeselectAll') : t('findSelectAll')}</span>
            </label>
          )}
        </div>
      )}

      {!hasSearched ? (
        <p className="find-empty-state" data-find-state="idle">
          {t('findIdleHint')}
        </p>
      ) : matches.length === 0 && regexError === null ? (
        <p className="find-empty-state" data-find-state="empty">
          {t('findNoMatches')}
        </p>
      ) : matches.length > 0 ? (
        <div
          ref={viewportRef}
          className="find-results-viewport"
          role="listbox"
          aria-label={t('findResultCount', { count: total })}
          data-find-results="true"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div className="find-results-spacer" style={{ height: matches.length * FIND_ROW_HEIGHT }}>
            <div
              className="find-results-window"
              style={{ transform: `translateY(${startIndex * FIND_ROW_HEIGHT}px)` }}
            >
              {visibleMatches.map((match) => {
                const isActive = activeIndex === match.index
                const isChecked = checkedIndices.has(match.index)
                return (
                  <div
                    key={match.index}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={0}
                    className={`find-result-row${isActive ? ' active' : ''}`}
                    style={{ height: FIND_ROW_HEIGHT }}
                    data-find-row={match.index}
                    onClick={() => handleActivateMatch(match)}
                    onKeyDown={(e) => handleRowKeyDown(e, match)}
                  >
                    <input
                      type="checkbox"
                      className="find-row-check"
                      checked={isChecked}
                      aria-label={t('findSelectMatch', { index: match.index + 1 })}
                      data-find-row-check={match.index}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRowCheck(match.index)}
                    />
                    <div className="find-row-body">
                      <div className="find-row-snippet">
                        {match.beforeText && (
                          <span className="find-snippet-context">{match.beforeText}</span>
                        )}
                        <mark className="find-match-mark">{match.matchText}</mark>
                        {match.afterText && (
                          <span className="find-snippet-context">{match.afterText}</span>
                        )}
                      </div>
                      <div className="find-row-meta">
                        <span className="find-meta-page">
                          {t('findPageLabel', { page: match.page })}
                        </span>
                        <span className="find-meta-scope" data-find-scope={match.kind}>
                          {t(scopeLabelKey(match.kind))}
                        </span>
                        {match.spansObject && (
                          <span className="find-meta-badge" data-find-badge="object">
                            {t('findBadgeObject')}
                          </span>
                        )}
                        {match.inCitation && (
                          <span className="find-meta-badge" data-find-badge="citation">
                            {t('findBadgeCitation')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
