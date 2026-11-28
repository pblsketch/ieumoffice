import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  BOOKLET_BINDINGS,
  DEFAULT_LABEL_PRESET_ID,
  DPI_CHOICES,
  hasActiveHeaderFooter,
  hasActiveWatermark,
  HEADER_FOOTER_SLOT_KINDS,
  LABEL_FILLS,
  LABEL_PAPERS,
  LABEL_PRESETS,
  LAYOUT_MODES,
  NUP_COUNTS,
  NUP_ORDERS,
  ORIENTATION_CHOICES,
  PAPER_NAMES,
  POSTER_OVERLAP_MM_MAX,
  POSTER_OVERLAP_MM_MIN,
  POSTER_TILES_MAX,
  POSTER_TILES_MIN,
  resolveLabelSpec,
  SCALE_PERCENT_MAX,
  SCALE_PERCENT_MIN,
  SCALING_MODES,
  SIDES_FILTERS,
  validateLabelSpec,
  WATERMARK_ANGLE_MAX,
  WATERMARK_ANGLE_MIN,
  WATERMARK_FONT_SIZE_MAX,
  WATERMARK_FONT_SIZE_MIN,
  WATERMARK_IMAGE_SCALE_MAX,
  WATERMARK_IMAGE_SCALE_MIN,
  WATERMARK_KINDS,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  type DpiChoice,
  type HeaderFooterOptions,
  type HeaderFooterSlot,
  type HeaderFooterSlotKind,
  type LabelPaper,
  type LabelSpec,
  type LayoutMode,
  type OrientationChoice,
  type PageSize,
  type PaperChoice,
  type PrintLayoutOptions,
  type ScalingMode,
  type WatermarkKind,
  type WatermarkOptions,
} from '@genoffice/print-layout/plan'
import { printLayoutText, type PrintLayoutStringKey } from '../strings-print-layout'
import { PrintLayoutProgressLine } from './ArrangedPreview'
import { type PrintLayoutPreviewRequest } from './hooks'
import {
  labelCellsOf,
  labelPresetText,
  normalizePanelOptions,
  printLayoutIssueText,
  printLayoutProblem,
  takesNewPrintRoute,
  type PrintLayoutCapabilities,
  type PrintLayoutProgress,
} from './model'
import { PrintLayoutSchematic } from './PrintLayoutSchematic'
import './print-layout.css'

/** Where the app keeps the last typed-in label grid (one per app, spec 4.1). */
export interface PrintLabelSpecStore {
  load: () => Promise<LabelSpec | null>
  save: (spec: LabelSpec) => Promise<void>
}

/** A print or save the editor is running on the new route. */
export interface PrintLayoutJob {
  /** pages turned into pictures so far; null while idle */
  progress: PrintLayoutProgress | null
  onCancel?: (() => void) | undefined
  /** why the last print or save failed, already in the user's language */
  error?: string | null | undefined
}

export interface PrintLayoutPanelProps {
  lang: Lang
  value: PrintLayoutOptions
  onChange: (next: PrintLayoutOptions) => void
  /** the print job's page sizes in points (/Rotate applied); null while the editor counts them */
  pages: readonly PageSize[] | null
  capabilities: PrintLayoutCapabilities
  labelSpecStore?: PrintLabelSpecStore | undefined
  /** draw the layout diagram inside the panel; editors that put it in their preview pass false */
  showSchematic?: boolean | undefined
  /** @deprecated kept optional for transitional callers; live preview lives in LivePrintPreview */
  onPreviewRequest?: PrintLayoutPreviewRequest | undefined
  /** @deprecated kept optional for transitional callers; PDF save lives in the destination dropdown */
  onSavePdf?: ((options: PrintLayoutOptions) => void) | undefined
  job?: PrintLayoutJob | undefined
  disabled?: boolean | undefined
}

const MODE_KEYS: Record<LayoutMode, PrintLayoutStringKey> = {
  single: 'modeSingle',
  nup: 'modeNup',
  booklet: 'modeBooklet',
  poster: 'modePoster',
  labels: 'modeLabels',
}

const SCALING_KEYS: Record<ScalingMode, PrintLayoutStringKey> = {
  actual: 'scalingActual',
  fit: 'scalingFit',
  shrink: 'scalingShrink',
  custom: 'scalingCustom',
}

const ORIENTATION_KEYS: Record<OrientationChoice, PrintLayoutStringKey> = {
  auto: 'orientationAuto',
  portrait: 'orientationPortrait',
  landscape: 'orientationLandscape',
}

const WATERMARK_KEYS: Record<WatermarkKind, PrintLayoutStringKey> = {
  none: 'watermarkNone',
  text: 'watermarkText',
  image: 'watermarkImage',
}

const SLOT_KEYS: Record<HeaderFooterSlotKind, PrintLayoutStringKey> = {
  none: 'slotNone',
  title: 'slotTitle',
  date: 'slotDate',
  pageNumber: 'slotPageNumber',
  custom: 'slotCustom',
}

type HfSlotName =
  'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight'

const HF_HEADER_SLOTS: ReadonlyArray<[HfSlotName, PrintLayoutStringKey]> = [
  ['topLeft', 'slotLeft'],
  ['topCenter', 'slotCenter'],
  ['topRight', 'slotRight'],
]

const HF_FOOTER_SLOTS: ReadonlyArray<[HfSlotName, PrintLayoutStringKey]> = [
  ['bottomLeft', 'slotLeft'],
  ['bottomCenter', 'slotCenter'],
  ['bottomRight', 'slotRight'],
]

type LabelNumberField = Exclude<keyof LabelSpec, 'paper'>

const LABEL_FIELDS: ReadonlyArray<[LabelNumberField, PrintLayoutStringKey, string]> = [
  ['cols', 'labelCols', 'label-cols'],
  ['rows', 'labelRows', 'label-rows'],
  ['cellWidthMm', 'labelCellWidth', 'label-cell-width'],
  ['cellHeightMm', 'labelCellHeight', 'label-cell-height'],
  ['topMarginMm', 'labelTopMargin', 'label-top'],
  ['leftMarginMm', 'labelLeftMargin', 'label-left'],
  ['hPitchMm', 'labelHPitch', 'label-h-pitch'],
  ['vPitchMm', 'labelVPitch', 'label-v-pitch'],
]

type LabelDraft = { paper: LabelPaper } & Record<LabelNumberField, string>

const CUSTOM = 'custom'
const MAX_WATERMARK_IMAGE_BYTES = 10 * 1024 * 1024

/** The grid custom entry starts from when nothing is remembered: the first preset */
function presetSpec(): LabelSpec {
  return resolveLabelSpec({ kind: 'preset', id: DEFAULT_LABEL_PRESET_ID })!
}

function draftOf(spec: LabelSpec): LabelDraft {
  const d = { paper: spec.paper } as LabelDraft
  for (const [field] of LABEL_FIELDS) d[field] = String(spec[field])
  return d
}

const readNumber = (text: string): number => {
  const t = text.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

function specOf(draft: LabelDraft): LabelSpec {
  const spec = { paper: draft.paper } as LabelSpec
  for (const [field] of LABEL_FIELDS) spec[field] = readNumber(draft[field])
  return spec
}

const specKey = (spec: LabelSpec): string => JSON.stringify(specOf(draftOf(spec)))

/** Fields to mark invalid for a typed-in grid */
function invalidFields(spec: LabelSpec): Set<LabelNumberField> {
  const bad = new Set<LabelNumberField>()
  const r = validateLabelSpec(spec)
  if (r.ok) return bad
  if (r.error.code === 'label-spec-off-paper') {
    for (const [f] of LABEL_FIELDS) bad.add(f)
    return bad
  }
  if (r.error.code === 'label-pitch-below-cell') {
    if (spec.hPitchMm < spec.cellWidthMm) bad.add('hPitchMm')
    if (spec.vPitchMm < spec.cellHeightMm) bad.add('vPitchMm')
    return bad
  }
  for (const [f] of LABEL_FIELDS) {
    const v = spec[f]
    const ok =
      f === 'cols' || f === 'rows'
        ? Number.isInteger(v) && v > 0
        : f === 'topMarginMm' || f === 'leftMarginMm'
          ? Number.isFinite(v) && v >= 0
          : Number.isFinite(v) && v > 0
    if (!ok) bad.add(f)
  }
  return bad
}

const numText = (n: number): string => (Number.isFinite(n) ? String(n) : '')

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="gs-pl-field">
      <span className="gs-pl-field-label">{props.label}</span>
      {props.children}
    </label>
  )
}

/**
 * The shared "page layout" panel (decision 0141 + print upgrade). Controlled:
 * the editor holds the options (see `usePrintLayoutOptions` for fresh defaults
 * on every open) and this panel keeps them within the editor's capabilities.
 */
export function PrintLayoutPanel(props: PrintLayoutPanelProps): ReactElement {
  const {
    lang,
    value,
    onChange,
    pages,
    capabilities,
    labelSpecStore,
    showSchematic = true,
    job,
    disabled = false,
  } = props
  const t = (key: PrintLayoutStringKey, params?: Record<string, string | number>) =>
    printLayoutText(lang, key, params)
  const id = useId()
  const blocked = capabilities.layoutBlockedReason

  const latest = useRef({ value, onChange, capabilities })
  latest.current = { value, onChange, capabilities }

  const emit = (patch: Partial<PrintLayoutOptions>) => {
    const cur = latest.current
    cur.onChange(normalizePanelOptions({ ...cur.value, ...patch }, cur.capabilities))
  }

  useEffect(() => {
    const cur = latest.current
    const fixed = normalizePanelOptions(cur.value, cur.capabilities)
    if (fixed !== cur.value) cur.onChange(fixed)
  }, [value, capabilities.showPaperAndFit, capabilities.layoutBlockedReason])

  const [draft, setDraft] = useState<LabelDraft | null>(() =>
    value.labels.spec.kind === 'custom' ? draftOf(value.labels.spec.spec) : null,
  )
  const savedKey = useRef<string | null>(null)
  const wmFileRef = useRef<HTMLInputElement | null>(null)

  const problem = useMemo(() => printLayoutProblem(value, pages), [value, pages])
  const cellCount = labelCellsOf(value)
  const newRoute = takesNewPrintRoute(value)
  const wmActive = hasActiveWatermark(value.watermark)
  const hfActive = hasActiveHeaderFooter(value.headerFooter)

  const setLabels = (patch: Partial<PrintLayoutOptions['labels']>) =>
    emit({ labels: { ...latest.current.value.labels, ...patch } })

  const setWatermark = (patch: Partial<WatermarkOptions>) =>
    emit({ watermark: { ...latest.current.value.watermark, ...patch } })

  const setHeaderFooter = (patch: Partial<HeaderFooterOptions>) =>
    emit({ headerFooter: { ...latest.current.value.headerFooter, ...patch } })

  const setHfSlot = (slotName: HfSlotName, patch: Partial<HeaderFooterSlot>) => {
    const cur = latest.current.value.headerFooter
    setHeaderFooter({ [slotName]: { ...cur[slotName], ...patch } })
  }

  const pickWatermarkImage = (file: File | undefined) => {
    if (!file || file.size > MAX_WATERMARK_IMAGE_BYTES) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setWatermark({ kind: 'image', imageDataUrl: reader.result })
      }
    }
    reader.readAsDataURL(file)
  }

  const chooseSpec = async (choice: string) => {
    if (choice !== CUSTOM) {
      setLabels({ spec: { kind: 'preset', id: choice } })
      return
    }
    let spec: LabelSpec
    if (draft) {
      spec = specOf(draft)
    } else {
      const loaded = await (labelSpecStore?.load() ?? Promise.resolve(null)).catch(() => null)
      const checked = loaded ? validateLabelSpec(loaded) : null
      spec = checked?.ok ? checked.spec : presetSpec()
      savedKey.current = checked?.ok ? specKey(checked.spec) : null
      setDraft(draftOf(spec))
    }
    setLabels({ spec: { kind: 'custom', spec } })
  }

  const editDraft = (patch: Partial<LabelDraft>) => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    setLabels({ spec: { kind: 'custom', spec: specOf(next) } })
  }

  const saveDraft = () => {
    if (!draft || !labelSpecStore) return
    const checked = validateLabelSpec(specOf(draft))
    if (!checked.ok) return
    const key = specKey(checked.spec)
    if (key === savedKey.current) return
    savedKey.current = key
    void labelSpecStore.save(checked.spec).catch(() => {
      if (savedKey.current === key) savedKey.current = null
    })
  }

  const customSpec = value.labels.spec.kind === 'custom' ? value.labels.spec.spec : null
  const badFields = customSpec ? invalidFields(customSpec) : new Set<LabelNumberField>()

  const numberInput = (
    pl: string,
    n: number,
    min: number,
    max: number | undefined,
    onValue: (v: number) => void,
    step = 1,
  ) => (
    <input
      type="number"
      className="gs-pl-number"
      data-pl={pl}
      min={min}
      max={max}
      step={step}
      value={numText(n)}
      disabled={disabled}
      onChange={(e) => onValue(readNumber(e.target.value))}
    />
  )

  const modeControls = (): ReactNode => {
    switch (value.mode) {
      case 'nup':
        return (
          <div className="gs-pl-sub">
            <Field label={t('nupCount')}>
              <select
                data-pl="nup-count"
                value={value.nup.count}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    nup: {
                      ...value.nup,
                      count: Number(e.target.value) as PrintLayoutOptions['nup']['count'],
                    },
                  })
                }
              >
                {NUP_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('nupOrder')}>
              <select
                data-pl="nup-order"
                value={value.nup.order}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    nup: {
                      ...value.nup,
                      order: e.target.value as PrintLayoutOptions['nup']['order'],
                    },
                  })
                }
              >
                {NUP_ORDERS.map((o) => (
                  <option key={o} value={o}>
                    {t(o === 'row' ? 'nupOrderRow' : 'nupOrderColumn')}
                  </option>
                ))}
              </select>
            </Field>
            <label className="gs-pl-check">
              <input
                type="checkbox"
                data-pl="nup-border"
                checked={value.nup.border === true}
                disabled={disabled}
                onChange={(e) => emit({ nup: { ...value.nup, border: e.target.checked } })}
              />
              <span>{t('nupBorder')}</span>
            </label>
          </div>
        )
      case 'booklet':
        return (
          <div className="gs-pl-sub">
            <Field label={t('bookletBinding')}>
              <select
                data-pl="booklet-binding"
                value={value.booklet.binding}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    booklet: {
                      binding: e.target.value as PrintLayoutOptions['booklet']['binding'],
                    },
                  })
                }
              >
                {BOOKLET_BINDINGS.map((b) => (
                  <option key={b} value={b}>
                    {t(b === 'left' ? 'bookletLeft' : 'bookletRight')}
                  </option>
                ))}
              </select>
            </Field>
            <p className="gs-pl-hint" data-pl="booklet-hint">
              {t('bookletHint')}
            </p>
          </div>
        )
      case 'poster':
        return (
          <div className="gs-pl-sub">
            <Field label={t('posterCols')}>
              {numberInput(
                'poster-cols',
                value.poster.cols,
                POSTER_TILES_MIN,
                POSTER_TILES_MAX,
                (v) => emit({ poster: { ...value.poster, cols: v } }),
              )}
            </Field>
            <Field label={t('posterRows')}>
              {numberInput(
                'poster-rows',
                value.poster.rows,
                POSTER_TILES_MIN,
                POSTER_TILES_MAX,
                (v) => emit({ poster: { ...value.poster, rows: v } }),
              )}
            </Field>
            <Field label={t('posterOverlap')}>
              {numberInput(
                'poster-overlap',
                value.poster.overlapMm,
                POSTER_OVERLAP_MM_MIN,
                POSTER_OVERLAP_MM_MAX,
                (v) => emit({ poster: { ...value.poster, overlapMm: v } }),
              )}
            </Field>
            <label className="gs-pl-check">
              <input
                type="checkbox"
                data-pl="poster-cut-marks"
                checked={value.poster.cutMarks}
                disabled={disabled}
                onChange={(e) => emit({ poster: { ...value.poster, cutMarks: e.target.checked } })}
              />
              <span>{t('posterCutMarks')}</span>
            </label>
            <label className="gs-pl-check">
              <input
                type="checkbox"
                data-pl="poster-tile-labels"
                checked={value.poster.tileLabels === true}
                disabled={disabled}
                onChange={(e) =>
                  emit({ poster: { ...value.poster, tileLabels: e.target.checked } })
                }
              />
              <span>{t('posterTileLabels')}</span>
            </label>
          </div>
        )
      case 'labels':
        return (
          <div className="gs-pl-sub">
            <Field label={t('labelSpec')}>
              <select
                data-pl="label-spec"
                value={value.labels.spec.kind === 'preset' ? value.labels.spec.id : CUSTOM}
                disabled={disabled}
                onChange={(e) => void chooseSpec(e.target.value)}
              >
                {LABEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {labelPresetText(lang, p)}
                  </option>
                ))}
                <option value={CUSTOM}>{t('labelCustom')}</option>
              </select>
            </Field>
            {customSpec && draft && (
              <fieldset className="gs-pl-custom" onBlur={saveDraft}>
                <legend className="gs-pl-legend">{t('labelCustom')}</legend>
                <Field label={t('labelPaper')}>
                  <select
                    data-pl="label-paper"
                    value={draft.paper}
                    disabled={disabled}
                    onChange={(e) => editDraft({ paper: e.target.value as LabelPaper })}
                  >
                    {LABEL_PAPERS.map((p) => (
                      <option key={p} value={p}>
                        {p === 'Letter' ? t('paperLetter') : p}
                      </option>
                    ))}
                  </select>
                </Field>
                {LABEL_FIELDS.map(([field, key, pl]) => (
                  <Field key={field} label={t(key)}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="gs-pl-number"
                      data-pl={pl}
                      value={draft[field]}
                      disabled={disabled}
                      aria-invalid={badFields.has(field) ? 'true' : undefined}
                      onChange={(e) => editDraft({ [field]: e.target.value })}
                    />
                  </Field>
                ))}
                <p className="gs-pl-hint">{t('labelPitchHint')}</p>
              </fieldset>
            )}
            <fieldset className="gs-pl-group">
              <legend className="gs-pl-legend">{t('labelFill')}</legend>
              {LABEL_FILLS.map((f) => (
                <label key={f} className="gs-pl-check">
                  <input
                    type="radio"
                    name={`${id}-label-fill`}
                    data-pl="label-fill"
                    value={f}
                    checked={value.labels.fill === f}
                    disabled={disabled}
                    onChange={() => setLabels({ fill: f })}
                  />
                  <span>{t(f === 'repeat' ? 'labelFillRepeat' : 'labelFillSequence')}</span>
                </label>
              ))}
            </fieldset>
            {value.labels.fill === 'repeat' && (
              <Field label={t('labelRepeatPage')}>
                {numberInput('label-repeat', value.labels.repeatPage, 1, pages?.length, (v) =>
                  setLabels({ repeatPage: v }),
                )}
              </Field>
            )}
            <Field label={t('labelStartCell')}>
              {numberInput('label-start', value.labels.startCell, 1, cellCount, (v) =>
                setLabels({ startCell: v }),
              )}
            </Field>
          </div>
        )
      default:
        return null
    }
  }

  const showOrientation = value.mode === 'single' || value.mode === 'nup' || value.mode === 'poster'
  const showScaling = capabilities.showPaperAndFit && value.mode === 'single'
  const paperChosen = capabilities.showPaperAndFit && value.paper !== 'source'

  const renderHfRow = (
    rowLabel: string,
    slots: ReadonlyArray<[HfSlotName, PrintLayoutStringKey]>,
  ) => (
    <div className="gs-pl-hf-row">
      <div className="gs-pl-legend">{rowLabel}</div>
      <div className="gs-pl-hf-grid">
        {slots.map(([slotName, labelKey]) => {
          const slot = value.headerFooter[slotName]
          return (
            <div key={slotName} className="gs-pl-hf-cell">
              <span className="gs-pl-field-label">{t(labelKey)}</span>
              <select
                data-pl={`hf-${slotName}`}
                value={slot.kind}
                disabled={disabled || !value.headerFooter.enabled}
                onChange={(e) =>
                  setHfSlot(slotName, { kind: e.target.value as HeaderFooterSlotKind })
                }
              >
                {HEADER_FOOTER_SLOT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(SLOT_KEYS[k])}
                  </option>
                ))}
              </select>
              {slot.kind === 'custom' && (
                <input
                  type="text"
                  className="gs-pl-range-text"
                  data-pl={`hf-${slotName}-text`}
                  value={slot.text}
                  disabled={disabled || !value.headerFooter.enabled}
                  onChange={(e) => setHfSlot(slotName, { text: e.target.value })}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <section className="gs-pl" aria-label={t('panelTitle')}>
      <div className="gs-pl-title">{t('panelTitle')}</div>
      <fieldset className="gs-pl-group">
        <legend className="gs-pl-legend">{t('modeLabel')}</legend>
        {LAYOUT_MODES.map((m) => (
          <label key={m} className="gs-pl-check">
            <input
              type="radio"
              name={`${id}-mode`}
              data-pl="mode"
              value={m}
              checked={value.mode === m}
              disabled={disabled || (!!blocked && m !== 'single')}
              onChange={() => emit({ mode: m })}
            />
            <span>{t(MODE_KEYS[m])}</span>
          </label>
        ))}
      </fieldset>
      {blocked && (
        <p className="gs-pl-hint" data-pl="blocked">
          {blocked}
        </p>
      )}
      {modeControls()}
      <fieldset className="gs-pl-group">
        <legend className="gs-pl-legend">{t('sidesLabel')}</legend>
        {SIDES_FILTERS.map((s) => (
          <label key={s} className="gs-pl-check">
            <input
              type="radio"
              name={`${id}-sides`}
              data-pl="sides"
              value={s}
              checked={value.sides === s}
              disabled={disabled}
              onChange={() => emit({ sides: s })}
            />
            <span>{t(s === 'all' ? 'sidesAll' : s === 'odd' ? 'sidesOdd' : 'sidesEven')}</span>
          </label>
        ))}
        <label className="gs-pl-check">
          <input
            type="checkbox"
            data-pl="reverse"
            checked={value.reverse}
            disabled={disabled}
            onChange={(e) => emit({ reverse: e.target.checked })}
          />
          <span>{t('reverse')}</span>
        </label>
      </fieldset>
      <div className="gs-pl-sub">
        {capabilities.showPaperAndFit && (
          <Field label={t('paperLabel')}>
            <select
              data-pl="paper"
              value={value.paper}
              disabled={disabled}
              onChange={(e) => emit({ paper: e.target.value as PaperChoice })}
            >
              <option value="source">{t('paperSource')}</option>
              {PAPER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p === 'Letter' ? t('paperLetter') : p === 'Legal' ? t('paperLegal') : p}
                </option>
              ))}
            </select>
          </Field>
        )}
        {showOrientation && (
          <Field label={t('orientationLabel')}>
            <select
              data-pl="orientation"
              value={value.orientation}
              disabled={disabled}
              onChange={(e) => emit({ orientation: e.target.value as OrientationChoice })}
            >
              {ORIENTATION_CHOICES.map((o) => (
                <option key={o} value={o}>
                  {t(ORIENTATION_KEYS[o])}
                </option>
              ))}
            </select>
          </Field>
        )}
        {showScaling && (
          <>
            <Field label={t('scalingLabel')}>
              <select
                data-pl="scaling"
                value={value.scaling}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.value as ScalingMode
                  emit({ scaling: next, fitToPaper: next === 'shrink' && paperChosen })
                }}
              >
                {SCALING_MODES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    disabled={(s === 'fit' || s === 'shrink') && !paperChosen}
                  >
                    {t(SCALING_KEYS[s])}
                  </option>
                ))}
              </select>
            </Field>
            {value.scaling === 'custom' && (
              <Field label="%">
                {numberInput(
                  'scale-percent',
                  value.scalePercent,
                  SCALE_PERCENT_MIN,
                  SCALE_PERCENT_MAX,
                  (v) => emit({ scalePercent: v }),
                  5,
                )}
              </Field>
            )}
          </>
        )}
      </div>
      <div className="gs-pl-sub">
        <label className="gs-pl-check">
          <input
            type="checkbox"
            data-pl="grayscale"
            checked={value.grayscale}
            disabled={disabled}
            onChange={(e) => emit({ grayscale: e.target.checked })}
          />
          <span>{t('grayscale')}</span>
        </label>
        <Field label={t('dpiLabel')}>
          <select
            data-pl="dpi"
            value={String(value.dpi)}
            disabled={disabled}
            onChange={(e) =>
              emit({
                dpi: (e.target.value === 'auto' ? 'auto' : Number(e.target.value)) as DpiChoice,
              })
            }
          >
            {DPI_CHOICES.map((d) => (
              <option key={d} value={String(d)}>
                {d === 'auto' ? t('dpiAuto') : t('dpiValue', { dpi: d })}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Collapsible Watermark section */}
      <details className="gs-pl-details" data-pl="watermark-section">
        <summary className="gs-pl-details-summary">
          <span>{t('watermarkTitle')}</span>
          {wmActive && <span className="gs-pl-badge">{t('activeBadge')}</span>}
        </summary>
        <div className="gs-pl-details-body">
          <div className="gs-pl-group">
            {WATERMARK_KINDS.map((k) => (
              <label key={k} className="gs-pl-check">
                <input
                  type="radio"
                  name={`${id}-wm-kind`}
                  data-pl="wm-kind"
                  value={k}
                  checked={value.watermark.kind === k}
                  disabled={disabled}
                  onChange={() => setWatermark({ kind: k })}
                />
                <span>{t(WATERMARK_KEYS[k])}</span>
              </label>
            ))}
          </div>
          {value.watermark.kind === 'text' && (
            <div className="gs-pl-sub">
              <Field label={t('watermarkTextLabel')}>
                <input
                  type="text"
                  className="gs-pl-range-text"
                  data-pl="wm-text"
                  value={value.watermark.text}
                  placeholder={t('watermarkTextPlaceholder')}
                  disabled={disabled}
                  onChange={(e) => setWatermark({ text: e.target.value })}
                />
              </Field>
              <Field label={t('watermarkColor')}>
                <input
                  type="color"
                  className="gs-pl-color"
                  data-pl="wm-color"
                  value={value.watermark.color}
                  disabled={disabled}
                  onChange={(e) => setWatermark({ color: e.target.value })}
                />
              </Field>
              <Field label={t('watermarkFontSize')}>
                {numberInput(
                  'wm-font-size',
                  value.watermark.fontSize,
                  WATERMARK_FONT_SIZE_MIN,
                  WATERMARK_FONT_SIZE_MAX,
                  (v) =>
                    setWatermark({
                      fontSize: Math.min(
                        WATERMARK_FONT_SIZE_MAX,
                        Math.max(WATERMARK_FONT_SIZE_MIN, Math.round(v) || 48),
                      ),
                    }),
                  2,
                )}
              </Field>
              <Field label={t('watermarkAngle')}>
                {numberInput(
                  'wm-angle',
                  value.watermark.angle,
                  WATERMARK_ANGLE_MIN,
                  WATERMARK_ANGLE_MAX,
                  (v) =>
                    setWatermark({
                      angle: Math.min(
                        WATERMARK_ANGLE_MAX,
                        Math.max(WATERMARK_ANGLE_MIN, Number.isFinite(v) ? Math.round(v) : -45),
                      ),
                    }),
                  5,
                )}
              </Field>
            </div>
          )}
          {value.watermark.kind === 'image' && (
            <div className="gs-pl-sub">
              <input
                ref={wmFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="gs-pl-file-hidden"
                data-pl="wm-file"
                onChange={(e) => pickWatermarkImage(e.target.files?.[0])}
              />
              <button
                type="button"
                className="gs-pl-btn"
                data-pl="wm-pick-image"
                disabled={disabled}
                onClick={() => wmFileRef.current?.click()}
              >
                {t('watermarkPickImage')}
              </button>
              {value.watermark.imageDataUrl && (
                <button
                  type="button"
                  className="gs-pl-btn"
                  data-pl="wm-clear-image"
                  disabled={disabled}
                  onClick={() => setWatermark({ imageDataUrl: undefined })}
                >
                  {t('watermarkClearImage')}
                </button>
              )}
              <Field label={t('watermarkImageScale')}>
                {numberInput(
                  'wm-image-scale',
                  value.watermark.imageScale,
                  WATERMARK_IMAGE_SCALE_MIN,
                  WATERMARK_IMAGE_SCALE_MAX,
                  (v) =>
                    setWatermark({
                      imageScale: Math.min(
                        WATERMARK_IMAGE_SCALE_MAX,
                        Math.max(WATERMARK_IMAGE_SCALE_MIN, Math.round(v) || 50),
                      ),
                    }),
                  5,
                )}
              </Field>
            </div>
          )}
          {value.watermark.kind !== 'none' && (
            <div className="gs-pl-sub">
              <Field
                label={`${t('watermarkOpacity')} (${Math.round(value.watermark.opacity * 100)}%)`}
              >
                <input
                  type="range"
                  data-pl="wm-opacity"
                  min={Math.round(WATERMARK_OPACITY_MIN * 100)}
                  max={Math.round(WATERMARK_OPACITY_MAX * 100)}
                  step={5}
                  value={Math.round(value.watermark.opacity * 100)}
                  disabled={disabled}
                  onChange={(e) => setWatermark({ opacity: Number(e.target.value) / 100 })}
                />
              </Field>
              <label className="gs-pl-check">
                <input
                  type="checkbox"
                  data-pl="wm-tile"
                  checked={value.watermark.tile}
                  disabled={disabled}
                  onChange={(e) => setWatermark({ tile: e.target.checked })}
                />
                <span>{t('watermarkTile')}</span>
              </label>
            </div>
          )}
        </div>
      </details>

      {/* Collapsible Headers & Footers section */}
      <details className="gs-pl-details" data-pl="header-footer-section">
        <summary className="gs-pl-details-summary">
          <span>{t('headerFooterTitle')}</span>
          {hfActive && <span className="gs-pl-badge">{t('activeBadge')}</span>}
        </summary>
        <div className="gs-pl-details-body">
          <label className="gs-pl-check">
            <input
              type="checkbox"
              data-pl="hf-enable"
              checked={value.headerFooter.enabled}
              disabled={disabled}
              onChange={(e) => setHeaderFooter({ enabled: e.target.checked })}
            />
            <span>{t('headerFooterEnable')}</span>
          </label>
          {value.headerFooter.enabled && (
            <>
              {renderHfRow(t('headerRow'), HF_HEADER_SLOTS)}
              {renderHfRow(t('footerRow'), HF_FOOTER_SLOTS)}
            </>
          )}
        </div>
      </details>

      {problem && (
        <p className="gs-pl-issue" role="alert" data-pl="issue">
          {printLayoutIssueText(lang, problem, { pageCount: pages?.length, cellCount })}
        </p>
      )}
      {newRoute && (
        <p className="gs-pl-hint" data-pl="system-note">
          {t('systemDialogNote')}
        </p>
      )}
      {showSchematic && <PrintLayoutSchematic lang={lang} pages={pages} options={value} />}
      {job?.progress && (
        <PrintLayoutProgressLine lang={lang} progress={job.progress} onCancel={job.onCancel} />
      )}
      {job?.error && !job.progress && (
        <p className="gs-pl-issue" role="alert" data-pl="job-error">
          {job.error}
        </p>
      )}
    </section>
  )
}
