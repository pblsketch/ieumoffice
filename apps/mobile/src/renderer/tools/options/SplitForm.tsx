/**
 * Split's options (spec 5.3, owner decision 8): the PC window's four modes —
 * ranges, fixed (pages per file or file count), bookmarks (level, leading
 * pages) and largest file size — with the name prefix and the name pattern.
 * The PC's subfolder and "cut in the editor" are not on the phone.
 *
 * Bookmarks are not read here: a PDF without any is refused when it runs
 * ('no-bookmarks', shown by the flow).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  parseSplitRangeList,
  planSplitParts,
  type SplitSizeUnit,
} from '@genoffice/pdf-ops/split-plan'
import { useMobileLocale } from '../../i18n'
import { ChoiceGroup, TextField, ToggleRow } from './fields'
import type { ToolOptionsFormProps } from './index'
import { AUTO_RANGES_KEY, bytesToSize, defaultSplitRanges, sizeToBytes } from './split-values'

type Mode = 'ranges' | 'fixed' | 'bookmarks' | 'maxSize'
type Pattern = 'numbered' | 'range' | 'bookmark'

const MODES: readonly Mode[] = ['ranges', 'fixed', 'bookmarks', 'maxSize']

const modeOf = (raw: Record<string, unknown>): Mode =>
  MODES.includes(raw.splitMode as Mode) ? (raw.splitMode as Mode) : 'ranges'

const patternOf = (raw: Record<string, unknown>): Pattern =>
  raw.splitPattern === 'range' || raw.splitPattern === 'bookmark' ? raw.splitPattern : 'numbered'

/** The pattern a mode starts with: bookmark titles for bookmarks, numbers otherwise */
const modePattern = (mode: Mode): Pattern => (mode === 'bookmarks' ? 'bookmark' : 'numbered')

/** The source name without its ending, the prefix split uses when none is typed */
const baseName = (name: string) => name.replace(/\.pdf$/i, '') || 'document'

export function SplitForm({ pageCount, input, raw, onChange, error }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const set = (patch: Record<string, unknown>) => onChange({ ...raw, ...patch })
  const mode = modeOf(raw)
  const pattern = patternOf(raw)

  // fill the two halves as the range, like the PC window does for the picked file,
  // and fill them again for another page count until the user types a range
  useEffect(() => {
    const auto = defaultSplitRanges(pageCount)
    const filled = raw[AUTO_RANGES_KEY]
    const untouched = typeof filled === 'string' && raw.splitRanges === filled
    if (raw.splitRanges === undefined || (untouched && filled !== auto)) {
      onChange({ ...raw, splitRanges: auto, [AUTO_RANGES_KEY]: auto })
    }
  }, [raw, onChange, pageCount])

  const switchMode = (next: Mode) => {
    // a pattern still at the mode's own default follows the new mode; a picked one stays
    const nextPattern =
      pattern === modePattern(mode)
        ? modePattern(next)
        : next !== 'bookmarks' && pattern === 'bookmark'
          ? 'numbered'
          : pattern
    set({ splitMode: next, splitPattern: nextPattern })
  }

  const ranges = typeof raw.splitRanges === 'string' ? raw.splitRanges : ''
  const mergeRanges = raw.splitMergeRanges === true
  const fixedKind = raw.splitFixedKind === 'fileCount' ? 'fileCount' : 'pagesPerFile'
  const fixedValue =
    typeof raw.splitFixedValue === 'number' && Number.isInteger(raw.splitFixedValue)
      ? Math.min(Math.max(raw.splitFixedValue, 1), Math.max(pageCount, 1))
      : 1

  const preview = useMemo(() => {
    if (mode === 'ranges') {
      const parsed = parseSplitRangeList(ranges, pageCount)
      if (!parsed.ok) return null
      return planSplitParts({ mode, ranges: parsed.ranges, mergeRanges }, pageCount)
    }
    if (mode === 'fixed') {
      return planSplitParts({ mode, kind: fixedKind, value: fixedValue }, pageCount)
    }
    return null
  }, [mode, ranges, mergeRanges, fixedKind, fixedValue, pageCount])
  const previewText =
    preview?.ok && !preview.dynamic
      ? preview.parts.length === 1
        ? t('pdfToolsSplitPreviewOne')
        : t('pdfToolsSplitPreviewCount', { n: preview.parts.length })
      : null

  const pageHint = t(pageCount === 1 ? 'pdfToolsPageCountOne' : 'pdfToolsPageCount', {
    n: pageCount,
  })
  const prefix = typeof raw.splitPrefix === 'string' ? raw.splitPrefix : ''

  return (
    <>
      <ChoiceGroup
        name={t('pdfToolsToolSplit')}
        columns={2}
        value={mode}
        onPick={switchMode}
        choices={[
          { value: 'ranges', label: t('pdfToolsSplitModeRanges') },
          { value: 'fixed', label: t('pdfToolsSplitModeFixed') },
          { value: 'bookmarks', label: t('pdfToolsSplitModeBookmarks') },
          { value: 'maxSize', label: t('pdfToolsSplitModeMaxSize') },
        ]}
      />

      {mode === 'ranges' && (
        <>
          <TextField
            label={t('pdfToolsSplitRangesLabel')}
            value={ranges}
            placeholder={defaultSplitRanges(pageCount)}
            hint={pageHint}
            error={error === 'range' ? error : null}
            onChange={(value) => set({ splitRanges: value })}
          />
          <ToggleRow
            label={t('pdfToolsSplitMergeRanges')}
            checked={mergeRanges}
            onChange={(on) => set({ splitMergeRanges: on })}
          />
        </>
      )}

      {mode === 'fixed' && (
        <>
          <ChoiceGroup
            name={t('pdfToolsSplitModeFixed')}
            value={fixedKind}
            onPick={(kind) => set({ splitFixedKind: kind })}
            choices={[
              { value: 'pagesPerFile', label: t('pdfToolsSplitFixedEvery') },
              { value: 'fileCount', label: t('pdfToolsSplitFixedCount') },
            ]}
          />
          <FixedValueField
            label={t(
              fixedKind === 'pagesPerFile' ? 'pdfToolsOptChunk' : 'pdfToolsSplitFixedFilesLabel',
            )}
            value={fixedValue}
            pageCount={pageCount}
            hint={pageHint}
            onValue={(value) => set({ splitFixedValue: value })}
          />
        </>
      )}

      {mode === 'bookmarks' && (
        <>
          <ChoiceGroup
            legend={t('pdfToolsSplitBookmarkLevel')}
            value={raw.splitBookmarkLevel === 2 ? 2 : 1}
            onPick={(level) => set({ splitBookmarkLevel: level })}
            choices={[
              { value: 1, label: t('pdfToolsSplitBookmarkLevel1') },
              { value: 2, label: t('pdfToolsSplitBookmarkLevel2') },
            ]}
          />
          <ToggleRow
            label={t('pdfToolsSplitIncludeLeading')}
            checked={raw.splitIncludeLeading !== false}
            onChange={(on) => set({ splitIncludeLeading: on })}
          />
        </>
      )}

      {mode === 'maxSize' && (
        <MaxSizeField
          bytes={typeof raw.splitMaxBytes === 'number' ? raw.splitMaxBytes : 0}
          error={error === 'invalid-size' ? error : null}
          onBytes={(bytes) => set({ splitMaxBytes: bytes })}
        />
      )}

      {previewText && (
        <p className="pdf-tools-field-hint" aria-live="polite">
          {previewText}
        </p>
      )}

      <TextField
        label={t('pdfToolsSplitPrefix')}
        value={prefix}
        placeholder={input ? baseName(input.name) : undefined}
        onChange={(value) => set({ splitPrefix: value })}
      />
      <ChoiceGroup
        legend={t('pdfToolsSplitPattern')}
        value={pattern}
        onPick={(next) => set({ splitPattern: next })}
        choices={[
          { value: 'numbered', label: t('pdfToolsSplitPatternNumbered') },
          { value: 'range', label: t('pdfToolsSplitPatternRange') },
          ...(mode === 'bookmarks'
            ? [{ value: 'bookmark' as const, label: t('pdfToolsSplitPatternBookmark') }]
            : []),
        ]}
      />
    </>
  )
}

interface FixedValueFieldProps {
  readonly label: string
  readonly value: number
  readonly pageCount: number
  readonly hint: string
  onValue(value: number): void
}

/** A whole number from 1 to the page count; a field left empty goes back to the value */
function FixedValueField({ label, value, pageCount, hint, onValue }: FixedValueFieldProps) {
  const [text, setText] = useState(() => String(value))
  return (
    <TextField
      label={label}
      value={text}
      inputMode="numeric"
      hint={hint}
      onChange={(next) => {
        setText(next)
        const n = Number(next.trim())
        if (next.trim() !== '' && Number.isInteger(n) && n >= 1) {
          onValue(Math.min(n, Math.max(pageCount, 1)))
          if (n > pageCount) setText(String(Math.max(pageCount, 1)))
        }
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

interface MaxSizeFieldProps {
  readonly bytes: number
  readonly error: 'invalid-size' | null
  onBytes(bytes: number): void
}

/** The largest size per file: a number and KB or MB, kept as bytes */
function MaxSizeField({ bytes, error, onBytes }: MaxSizeFieldProps) {
  const { t } = useMobileLocale()
  // the number stays as typed; the unit only changes what it means
  const [start] = useState(() => bytesToSize(bytes))
  const [text, setText] = useState(start.text)
  const [unit, setUnit] = useState<SplitSizeUnit>(start.unit)
  return (
    <>
      <TextField
        label={t('pdfToolsSplitMaxSizeLabel')}
        value={text}
        inputMode="decimal"
        error={error}
        hint={t('pdfToolsSplitMaxSizeNote')}
        onChange={(next) => {
          setText(next)
          onBytes(sizeToBytes(next, unit))
        }}
      />
      <ChoiceGroup
        name={t('pdfToolsSplitMaxSizeLabel')}
        columns={2}
        value={unit}
        onPick={(next) => {
          setUnit(next)
          onBytes(sizeToBytes(text, next))
        }}
        choices={[
          { value: 'MB', label: 'MB' },
          { value: 'KB', label: 'KB' },
        ]}
      />
    </>
  )
}
