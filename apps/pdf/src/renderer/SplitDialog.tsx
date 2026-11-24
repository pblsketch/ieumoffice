import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Lang, Params } from '@genoffice/i18n'
import {
  cutAfterToRanges,
  formatPartPages,
  formatSplitOutputNames,
  formatSplitRangeList,
  parseSplitRangeList,
  planSplitParts,
  rangesToCutAfter,
  splitSubfolderName,
  type SplitBookmarkEntry,
  type SplitFixedKind,
  type SplitMode,
  type SplitNamingPattern,
  type SplitOutputOptions,
  type SplitPlanRequest,
  type SplitRange,
  type SplitSizeUnit,
} from '../shared/split-plan'
import { splitText, type SplitStringKey } from './i18n/strings-split'
import { PdfThumb } from './PdfThumb'

export interface SplitDialogProps {
  lang: Lang
  doc: PDFDocumentProxy | null
  /** Maps visible 0-based page position to 0-based original page index */
  visList: readonly number[]
  /** Pending page rotation deltas keyed by original page index */
  rotations: ReadonlyMap<number, number>
  pageCount: number
  baseName: string
  bookmarks: readonly SplitBookmarkEntry[]
  bookmarksLoading: boolean
  /** Optional initial scissor cut positions (1-based page numbers) */
  initialCutAfter?: readonly number[]
  busy: boolean
  progress: { done: number; total: number } | null
  onSplit: (plan: SplitPlanRequest, output: SplitOutputOptions) => void
  onCancelSplit: () => void
  onClose: () => void
}

function ScissorIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

const FIXED_PAGE_PRESETS = [1, 2, 5, 10] as const
const FIXED_COUNT_PRESETS = [2, 3, 4, 5] as const
const SIZE_MB_PRESETS = [5, 10, 20, 50] as const

export function SplitDialog({
  lang,
  doc,
  visList,
  rotations,
  pageCount,
  baseName,
  bookmarks,
  bookmarksLoading,
  initialCutAfter,
  busy,
  progress,
  onSplit,
  onCancelSplit,
  onClose,
}: SplitDialogProps): ReactElement {
  const t = (key: SplitStringKey, params?: Params) => splitText(lang, key, params)

  const initialRanges = useMemo<SplitRange[]>(() => {
    if (initialCutAfter && initialCutAfter.length > 0) {
      return cutAfterToRanges(initialCutAfter, pageCount)
    }
    if (pageCount >= 2) {
      const mid = Math.floor(pageCount / 2)
      return [
        { start: 1, end: mid },
        { start: mid + 1, end: pageCount },
      ]
    }
    return [{ start: 1, end: Math.max(1, pageCount) }]
  }, [initialCutAfter, pageCount])

  const [mode, setMode] = useState<SplitMode>('ranges')
  const [ranges, setRanges] = useState<SplitRange[]>(initialRanges)
  const [rangeText, setRangeText] = useState<string>(() => formatSplitRangeList(initialRanges))
  const [rangeTextError, setRangeTextError] = useState(false)
  const [mergeRanges, setMergeRanges] = useState(false)

  const [fixedKind, setFixedKind] = useState<SplitFixedKind>('pagesPerFile')
  const [fixedValue, setFixedValue] = useState<number>(1)

  const [bookmarkLevel, setBookmarkLevel] = useState<1 | 2>(1)
  const [includeLeadingPages, setIncludeLeadingPages] = useState(true)

  const [sizeValue, setSizeValue] = useState<number>(10)
  const [sizeUnit, setSizeUnit] = useState<SplitSizeUnit>('MB')

  const [prefix, setPrefix] = useState<string>(baseName)
  const [pattern, setPattern] = useState<SplitNamingPattern>('numbered')
  const [patternTouched, setPatternTouched] = useState(false)
  const [createSubfolder, setCreateSubfolder] = useState(true)
  const [showFileList, setShowFileList] = useState(false)

  // Lazy-render visible thumbnails in the grid so large PDFs open immediately
  const gridRef = useRef<HTMLDivElement>(null)
  const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(() => {
    const initial = new Set<number>()
    for (let i = 1; i <= Math.min(pageCount, 24); i++) initial.add(i)
    return initial
  })

  useEffect(() => {
    const root = gridRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const entry of entries) {
            const p = Number((entry.target as HTMLElement).dataset.page)
            if (!Number.isInteger(p)) continue
            if (entry.isIntersecting) {
              if (!next.has(p)) {
                next.add(p)
                changed = true
              }
            } else if (next.has(p)) {
              next.delete(p)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      { root, rootMargin: '220px 0px' },
    )
    const nodes = root.querySelectorAll<HTMLElement>('[data-page]')
    nodes.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [pageCount])

  // Escape closes when idle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const maxBytes = useMemo(
    () => Math.round(sizeValue * (sizeUnit === 'MB' ? 1024 * 1024 : 1024)),
    [sizeValue, sizeUnit],
  )

  const plan = useMemo<SplitPlanRequest>(() => {
    switch (mode) {
      case 'ranges':
        return { mode: 'ranges', ranges, mergeRanges }
      case 'fixed':
        return { mode: 'fixed', kind: fixedKind, value: fixedValue }
      case 'bookmarks':
        return {
          mode: 'bookmarks',
          level: bookmarkLevel,
          includeLeadingPages,
          bookmarks: [...bookmarks],
        }
      case 'maxSize':
        return { mode: 'maxSize', maxBytes }
    }
  }, [
    mode,
    ranges,
    mergeRanges,
    fixedKind,
    fixedValue,
    bookmarkLevel,
    includeLeadingPages,
    bookmarks,
    maxBytes,
  ])

  const planned = useMemo(
    () => planSplitParts(plan, pageCount, bookmarks),
    [plan, pageCount, bookmarks],
  )

  const outputOptions = useMemo<SplitOutputOptions>(
    () => ({
      prefix: prefix.trim() || baseName,
      pattern,
      createSubfolder,
    }),
    [prefix, baseName, pattern, createSubfolder],
  )

  const previewNames = useMemo(
    () =>
      planned.ok && !planned.dynamic
        ? formatSplitOutputNames(planned.parts, `${baseName}.pdf`, outputOptions)
        : [],
    [planned, baseName, outputOptions],
  )

  /** Map each 1-based page to its visual output group index (0-based) for grid badges */
  const pageGroupMap = useMemo(() => {
    const map = new Map<number, number>()
    if (!planned.ok || planned.dynamic) return map
    planned.parts.forEach((part, idx) => {
      for (const p of part.pages) {
        if (!map.has(p)) map.set(p, idx)
      }
    })
    return map
  }, [planned])

  /** Active scissor cuts (1-based page after which a cut sits) for the current plan */
  const activeCuts = useMemo<ReadonlySet<number>>(() => {
    if (!planned.ok || planned.dynamic) return new Set()
    const partRanges: SplitRange[] = []
    for (const part of planned.parts) {
      if (part.pages.length === 0) continue
      const first = part.pages[0]!
      const last = part.pages[part.pages.length - 1]!
      if (last - first + 1 === part.pages.length) {
        partRanges.push({ start: first, end: last })
      } else {
        return new Set()
      }
    }
    const cuts = rangesToCutAfter(partRanges, pageCount)
    return new Set(cuts ?? [])
  }, [planned, pageCount])

  const applyRanges = (next: SplitRange[]) => {
    setRanges(next)
    setRangeText(formatSplitRangeList(next))
    setRangeTextError(false)
  }

  const toggleCutAfter = (page: number) => {
    if (busy || page < 1 || page >= pageCount) return
    const nextCuts = new Set(activeCuts)
    if (nextCuts.has(page)) nextCuts.delete(page)
    else nextCuts.add(page)
    setMode('ranges')
    setMergeRanges(false)
    applyRanges(cutAfterToRanges([...nextCuts], pageCount))
  }

  const cutEveryPage = () => {
    if (busy) return
    const cuts = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => i + 1)
    setMode('ranges')
    setMergeRanges(false)
    applyRanges(cutAfterToRanges(cuts, pageCount))
  }

  const clearAllCuts = () => {
    if (busy) return
    setMode('ranges')
    setMergeRanges(false)
    applyRanges([{ start: 1, end: pageCount }])
  }

  const switchMode = (next: SplitMode) => {
    setMode(next)
    if (!patternTouched) {
      setPattern(next === 'bookmarks' ? 'bookmark' : 'numbered')
    }
  }

  const onRangeTextChange = (value: string) => {
    setRangeText(value)
    const parsed = parseSplitRangeList(value, pageCount)
    if (parsed.ok) {
      setRanges(parsed.ranges)
      setRangeTextError(false)
    } else {
      setRangeTextError(true)
    }
  }

  const updateRangeBound = (index: number, field: 'start' | 'end', raw: string) => {
    const num = Math.max(1, Math.min(pageCount, Math.floor(Number(raw) || 1)))
    const next = ranges.map((r, i) => (i === index ? { ...r, [field]: num } : r))
    applyRanges(next)
  }

  const addRangeRow = () => {
    const lastEnd = ranges[ranges.length - 1]?.end ?? 0
    const nextStart = Math.min(pageCount, lastEnd + 1)
    applyRanges([...ranges, { start: nextStart, end: pageCount }])
  }

  const removeRangeRow = (index: number) => {
    if (ranges.length <= 1) return
    applyRanges(ranges.filter((_, i) => i !== index))
  }

  const canRun = !busy && planned.ok && !(mode === 'ranges' && rangeTextError)
  const multipleOutputs = planned.ok && (planned.dynamic || planned.parts.length >= 2)
  const subfolderLabel = splitSubfolderName(baseName, prefix)

  const handleSubmit = () => {
    if (!canRun) return
    onSplit(plan, outputOptions)
  }

  return (
    <div
      className="pdf-modal-mask pdf-split-mask"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="pdf-modal pdf-split-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-split-head">
          <div className="pdf-modal-title">{t('title')}</div>
          <button
            type="button"
            className="pdf-split-close"
            aria-label={t('cancel')}
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="pdf-split-body">
          {/* Left pane: visual page thumbnails with scissor dividers */}
          <div className="pdf-split-visual">
            <div className="pdf-split-visual-bar">
              <span className="pdf-split-visual-hint">
                {mode === 'maxSize' ? t('visualSizeHint') : t('visualHint')}
              </span>
              {mode !== 'maxSize' && pageCount > 1 && (
                <div className="pdf-split-visual-actions">
                  <button
                    type="button"
                    className="pdf-modal-btn pdf-split-mini-btn"
                    disabled={busy}
                    onClick={cutEveryPage}
                  >
                    {t('cutAll')}
                  </button>
                  <button
                    type="button"
                    className="pdf-modal-btn pdf-split-mini-btn"
                    disabled={busy || activeCuts.size === 0}
                    onClick={clearAllCuts}
                  >
                    {t('clearCuts')}
                  </button>
                </div>
              )}
            </div>

            <div className="pdf-split-grid" ref={gridRef}>
              {Array.from({ length: pageCount }, (_, visIdx) => {
                const pageNo = visIdx + 1
                const origIdx = visList[visIdx] ?? visIdx
                const groupIdx = pageGroupMap.get(pageNo)
                const isIncluded = mode === 'maxSize' || groupIdx !== undefined
                const hasCut = activeCuts.has(pageNo)
                const groupBucket = groupIdx !== undefined ? groupIdx % 4 : -1
                return (
                  <Fragment key={pageNo}>
                    <div
                      className={`pdf-split-tile${isIncluded ? '' : ' excluded'}${groupBucket >= 0 ? ` g-${groupBucket}` : ''}`}
                      data-page={pageNo}
                    >
                      <div className="pdf-split-tile-head">
                        <span className="pdf-split-page-num">{t('pageNum', { n: pageNo })}</span>
                        {groupIdx !== undefined && (
                          <span className="pdf-split-group-badge">
                            {t('fileBadge', { n: groupIdx + 1 })}
                          </span>
                        )}
                      </div>
                      <div className="pdf-split-thumb-frame">
                        {doc ? (
                          <PdfThumb
                            doc={doc}
                            pageNo={origIdx + 1}
                            rotationDelta={rotations.get(origIdx) ?? 0}
                            visible={visiblePages.has(pageNo)}
                            rasterW={120}
                          />
                        ) : (
                          <div className="pdf-split-thumb-placeholder">{pageNo}</div>
                        )}
                      </div>
                    </div>
                    {pageNo < pageCount && (
                      <button
                        type="button"
                        className={`pdf-split-cut-btn${hasCut ? ' active' : ''}`}
                        aria-label={t('toggleCut', { page: pageNo })}
                        aria-pressed={hasCut}
                        title={t('toggleCut', { page: pageNo })}
                        disabled={busy || mode === 'maxSize'}
                        onClick={() => toggleCutAfter(pageNo)}
                      >
                        <span className="pdf-split-cut-line" />
                        <span className="pdf-split-cut-icon">
                          <ScissorIcon />
                        </span>
                      </button>
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>

          {/* Right pane: 4 modes + preview + output options */}
          <div className="pdf-split-controls">
            <div className="pdf-split-tabs" role="tablist">
              {(
                [
                  ['ranges', 'modeRanges'],
                  ['fixed', 'modeFixed'],
                  ['bookmarks', 'modeBookmarks'],
                  ['maxSize', 'modeMaxSize'],
                ] as const
              ).map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  className={`pdf-split-tab${mode === id ? ' active' : ''}`}
                  disabled={busy}
                  onClick={() => switchMode(id)}
                >
                  {t(key)}
                </button>
              ))}
            </div>

            <div className="pdf-split-panel">
              {mode === 'ranges' && (
                <div className="pdf-split-section">
                  <label className="pdf-split-field">
                    <span className="pdf-split-label">{t('rangeInputLabel')}</span>
                    <input
                      type="text"
                      className={`pdf-modal-input${rangeTextError ? ' invalid' : ''}`}
                      value={rangeText}
                      disabled={busy}
                      onChange={(e) => onRangeTextChange(e.target.value)}
                    />
                  </label>
                  {rangeTextError && (
                    <div className="pdf-split-error">
                      {t('errInvalidRange', { total: pageCount })}
                    </div>
                  )}

                  <div className="pdf-split-range-list">
                    {ranges.map((r, idx) => (
                      <div className="pdf-split-range-row" key={idx}>
                        <span className="pdf-split-range-tag">
                          {t('rangeRowLabel', { n: idx + 1 })}
                        </span>
                        <input
                          type="number"
                          className="pdf-modal-input pdf-split-num"
                          aria-label={`${t('rangeRowLabel', { n: idx + 1 })} ${t('rangeFrom')}`}
                          min={1}
                          max={pageCount}
                          value={r.start}
                          disabled={busy}
                          onChange={(e) => updateRangeBound(idx, 'start', e.target.value)}
                        />
                        <span className="pdf-split-dash">–</span>
                        <input
                          type="number"
                          className="pdf-modal-input pdf-split-num"
                          aria-label={`${t('rangeRowLabel', { n: idx + 1 })} ${t('rangeTo')}`}
                          min={1}
                          max={pageCount}
                          value={r.end}
                          disabled={busy}
                          onChange={(e) => updateRangeBound(idx, 'end', e.target.value)}
                        />
                        <button
                          type="button"
                          className="pdf-split-row-del"
                          aria-label={t('removeRange')}
                          title={t('removeRange')}
                          disabled={busy || ranges.length <= 1}
                          onClick={() => removeRangeRow(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="pdf-split-row-actions">
                    <button
                      type="button"
                      className="pdf-modal-btn pdf-split-mini-btn"
                      disabled={busy}
                      onClick={addRangeRow}
                    >
                      + {t('addRange')}
                    </button>
                  </div>

                  <label className="pdf-split-check">
                    <input
                      type="checkbox"
                      checked={mergeRanges}
                      disabled={busy}
                      onChange={(e) => setMergeRanges(e.target.checked)}
                    />
                    <span>{t('mergeRanges')}</span>
                  </label>
                </div>
              )}

              {mode === 'fixed' && (
                <div className="pdf-split-section">
                  <div className="pdf-split-radios">
                    <label className="pdf-split-check">
                      <input
                        type="radio"
                        name="pdf-split-fixed-kind"
                        checked={fixedKind === 'pagesPerFile'}
                        disabled={busy}
                        onChange={() => setFixedKind('pagesPerFile')}
                      />
                      <span>{t('fixedPagesPerFile')}</span>
                    </label>
                    <label className="pdf-split-check">
                      <input
                        type="radio"
                        name="pdf-split-fixed-kind"
                        checked={fixedKind === 'fileCount'}
                        disabled={busy}
                        onChange={() => setFixedKind('fileCount')}
                      />
                      <span>{t('fixedFileCount')}</span>
                    </label>
                  </div>

                  <label className="pdf-split-field">
                    <span className="pdf-split-label">
                      {fixedKind === 'pagesPerFile' ? t('fixedEvery') : t('fixedParts')}
                    </span>
                    <input
                      type="number"
                      className="pdf-modal-input pdf-split-num-wide"
                      min={1}
                      max={pageCount}
                      value={fixedValue}
                      disabled={busy}
                      onChange={(e) =>
                        setFixedValue(
                          Math.max(1, Math.min(pageCount, Math.floor(Number(e.target.value) || 1))),
                        )
                      }
                    />
                  </label>

                  <div className="pdf-split-presets">
                    {(fixedKind === 'pagesPerFile' ? FIXED_PAGE_PRESETS : FIXED_COUNT_PRESETS)
                      .filter((n) => n <= pageCount)
                      .map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`pdf-split-chip${fixedValue === n ? ' active' : ''}`}
                          disabled={busy}
                          onClick={() => setFixedValue(n)}
                        >
                          {fixedKind === 'pagesPerFile'
                            ? n === 1
                              ? t('presetAllSingle')
                              : t('presetEvery', { n })
                            : t('fileBadge', { n })}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {mode === 'bookmarks' && (
                <div className="pdf-split-section">
                  {bookmarksLoading ? (
                    <div className="pdf-split-hint">{t('bookmarksLoading')}</div>
                  ) : bookmarks.length === 0 ? (
                    <div className="pdf-split-empty">{t('noBookmarks')}</div>
                  ) : (
                    <>
                      <div className="pdf-split-label">{t('bookmarkLevel')}</div>
                      <div className="pdf-split-radios">
                        <label className="pdf-split-check">
                          <input
                            type="radio"
                            name="pdf-split-bm-level"
                            checked={bookmarkLevel === 1}
                            disabled={busy}
                            onChange={() => setBookmarkLevel(1)}
                          />
                          <span>{t('bookmarkLevel1')}</span>
                        </label>
                        <label className="pdf-split-check">
                          <input
                            type="radio"
                            name="pdf-split-bm-level"
                            checked={bookmarkLevel === 2}
                            disabled={busy}
                            onChange={() => setBookmarkLevel(2)}
                          />
                          <span>{t('bookmarkLevel2')}</span>
                        </label>
                      </div>
                      <label className="pdf-split-check">
                        <input
                          type="checkbox"
                          checked={includeLeadingPages}
                          disabled={busy}
                          onChange={(e) => setIncludeLeadingPages(e.target.checked)}
                        />
                        <span>{t('includeLeading')}</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {mode === 'maxSize' && (
                <div className="pdf-split-section">
                  <label className="pdf-split-field">
                    <span className="pdf-split-label">{t('maxSizeLabel')}</span>
                    <div className="pdf-split-size-row">
                      <input
                        type="number"
                        className="pdf-modal-input pdf-split-num-wide"
                        min={1}
                        step="any"
                        value={sizeValue}
                        disabled={busy}
                        onChange={(e) => setSizeValue(Math.max(0, Number(e.target.value) || 0))}
                      />
                      <select
                        className="pdf-modal-input pdf-split-unit"
                        value={sizeUnit}
                        disabled={busy}
                        onChange={(e) => setSizeUnit(e.target.value === 'KB' ? 'KB' : 'MB')}
                      >
                        <option value="MB">MB</option>
                        <option value="KB">KB</option>
                      </select>
                    </div>
                  </label>
                  <div className="pdf-split-presets">
                    {SIZE_MB_PRESETS.map((mb) => (
                      <button
                        key={mb}
                        type="button"
                        className={`pdf-split-chip${sizeUnit === 'MB' && sizeValue === mb ? ' active' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          setSizeUnit('MB')
                          setSizeValue(mb)
                        }}
                      >
                        {mb} MB
                      </button>
                    ))}
                  </div>
                  <div className="pdf-split-hint">{t('maxSizeHint')}</div>
                  {!planned.ok && planned.error === 'invalid-size' && (
                    <div className="pdf-split-error">{t('errInvalidSize')}</div>
                  )}
                </div>
              )}

              {/* Live preview summary */}
              <div className="pdf-split-preview">
                <div className="pdf-split-preview-head">
                  <span className="pdf-split-preview-count">
                    {!planned.ok
                      ? mode === 'bookmarks' && bookmarks.length === 0
                        ? t('noBookmarks')
                        : mode === 'maxSize'
                          ? t('errInvalidSize')
                          : t('errInvalidRange', { total: pageCount })
                      : planned.dynamic
                        ? t('previewDynamic')
                        : planned.parts.length === 1
                          ? t('previewCountOne')
                          : t('previewCount', { n: planned.parts.length })}
                  </span>
                  {planned.ok && !planned.dynamic && previewNames.length > 0 && (
                    <button
                      type="button"
                      className="pdf-split-link-btn"
                      onClick={() => setShowFileList((v) => !v)}
                    >
                      {showFileList ? t('previewToggleHide') : t('previewToggleShow')}
                    </button>
                  )}
                </div>
                {showFileList && planned.ok && !planned.dynamic && (
                  <ul className="pdf-split-file-list">
                    {planned.parts.map((part, idx) => (
                      <li key={idx} className="pdf-split-file-item">
                        <span className="pdf-split-file-name" title={previewNames[idx]}>
                          {previewNames[idx]}
                        </span>
                        <span className="pdf-split-file-pages">{formatPartPages(part.pages)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Output options */}
              <div className="pdf-split-output">
                <div className="pdf-split-subhead">{t('outputSection')}</div>
                <div className="pdf-split-output-grid">
                  <label className="pdf-split-field">
                    <span className="pdf-split-label">{t('outputPrefix')}</span>
                    <input
                      type="text"
                      className="pdf-modal-input"
                      value={prefix}
                      placeholder={baseName}
                      disabled={busy}
                      onChange={(e) => setPrefix(e.target.value)}
                    />
                  </label>
                  <label className="pdf-split-field">
                    <span className="pdf-split-label">{t('outputPattern')}</span>
                    <select
                      className="pdf-modal-input"
                      value={pattern}
                      disabled={busy}
                      onChange={(e) => {
                        setPattern(e.target.value as SplitNamingPattern)
                        setPatternTouched(true)
                      }}
                    >
                      <option value="numbered">{t('patternNumbered')}</option>
                      <option value="range">{t('patternRange')}</option>
                      {mode === 'bookmarks' && (
                        <option value="bookmark">{t('patternBookmark')}</option>
                      )}
                    </select>
                  </label>
                </div>
                {multipleOutputs && (
                  <label className="pdf-split-check">
                    <input
                      type="checkbox"
                      checked={createSubfolder}
                      disabled={busy}
                      onChange={(e) => setCreateSubfolder(e.target.checked)}
                    />
                    <span>{t('createSubfolder', { folder: subfolderLabel })}</span>
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="pdf-split-foot">
          {busy ? (
            <>
              <span className="pdf-split-progress">
                {t('splitting', {
                  done: progress?.done ?? 0,
                  total: progress?.total ?? pageCount,
                })}
              </span>
              <button type="button" className="pdf-modal-btn" onClick={onCancelSplit}>
                {t('cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pdf-modal-btn" onClick={onClose}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="pdf-modal-btn primary"
                disabled={!canRun}
                onClick={handleSubmit}
              >
                {t('splitAction')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
