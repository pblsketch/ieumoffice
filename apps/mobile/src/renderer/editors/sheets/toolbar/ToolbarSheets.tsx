/**
 * The sheets the edit toolbar opens (lazy chunk): one non-modal sheet per
 * group (the grid stays usable above it), the pickers inside them (font,
 * size, number format), Find and Replace, and the desktop's full-load offer
 * before a sort or filter of a streamed workbook.
 *
 * Every button sends the desktop ribbon's command string through the
 * desktop dispatcher (runRibbon.ts); toggles echo the selection the way the
 * desktop ribbon does (selection-format.ts `toSelectionFormat`). Labels the
 * desktop ribbon has come from the desktop's strings (22 languages).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'
import { Sheet } from '../../../components/Sheet'
import { IconChevronNext, IconChevronPrevious } from '../../../components/icons/sheets'
import type { MobileStringKey } from '../../../i18n'
import type { EditorHost } from '../../editorKind'
import { tFor, type StringKey } from '../../../../../../sheets/src/renderer/i18n/locale'
import {
  categoryOptionForPattern,
  NUMBER_FORMAT_LABEL,
} from '../../../../../../sheets/src/renderer/number-format'
import {
  selectionFormatEquals,
  toSelectionFormat,
  type SelectionFormat,
} from '../../../../../../sheets/src/renderer/selection-format'
import type { MobileGrid } from '../grid/mobileGrid'
import { toastUnlessStatus } from '../journal/statusLines'
import type { SheetsGridAccess } from '../workspace/slots'
import {
  findInWorkbook,
  replaceable,
  replaceHit,
  revealHit,
  type FindHit,
  type FindOptions,
} from './find'
import {
  colorCommand,
  fontFamilyChoices,
  fontFamilyCommand,
  fontSizeCommand,
  numberFormatChoices,
  RIBBON_FONT_SIZES,
  TOOLBAR_SWATCHES,
  toolbarGroups,
  type ToolbarGroup,
  type ToolbarItem,
  type ToolbarPicker,
  type ToolbarSection,
} from './groups'
import type { ToolbarPanel } from './panels'
import { createToolbarCommands, type FullLoadPrompt, type ToolbarCommands } from './runRibbon'

export interface ToolbarSheetsProps {
  readonly panel: ToolbarPanel
  readonly host: EditorHost
  readonly grid: SheetsGridAccess
  readonly lang: Lang
  /** Edit mode: Find offers Replace only then. */
  readonly editing: boolean
  readonly t: (key: MobileStringKey) => string
  readonly onOpen: (panel: ToolbarPanel) => void
  readonly onClose: () => void
}

type Label = ToolbarItem['label']

/** Watches the selection's format (the desktop ribbon's echo), coalesced per frame. */
export function useSelectionFormat(grid: MobileGrid | null): SelectionFormat | null {
  const [format, setFormat] = useState<SelectionFormat | null>(null)
  useEffect(() => {
    if (!grid) return
    const api = grid.runtime.univerAPI
    let frame = 0
    const read = () => {
      frame = 0
      let next: SelectionFormat | null = null
      try {
        const range = api.getActiveWorkbook()?.getActiveRange()
        if (range) next = toSelectionFormat(range.getCellStyleData() ?? {}, range.getNumberFormat())
      } catch {
        // A sheet switch briefly keeps a selection the new sheet rejects; the next event reads again.
        return
      }
      setFormat((previous) => (selectionFormatEquals(previous, next) ? previous : next))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    read()
    const selection = api.addEvent(api.Event.SelectionChanged, schedule)
    const executed = api.addEvent(api.Event.CommandExecuted, schedule)
    return () => {
      selection.dispose()
      executed.dispose()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [grid])
  return format
}

function isPressed(item: ToolbarItem, format: SelectionFormat | null): boolean | undefined {
  const toggle = item.toggle
  if (!toggle) return undefined
  if (!format) return false
  if (toggle.kind === 'flag') return format[toggle.flag]
  if (toggle.kind === 'horizontal') return format.horizontalAlignment === toggle.value
  return format.verticalAlignment === toggle.value
}

export default function ToolbarSheets(props: ToolbarSheetsProps) {
  const { host, grid, lang, t } = props
  const live = grid.grid
  const [prompt, setPrompt] = useState<FullLoadPrompt | null>(null)
  const commands = useMemo(
    () =>
      live
        ? createToolbarCommands({
            runtime: live.runtime,
            lazyWorkbookRef: live.lazyWorkbookRef,
            // The desktop's progress and per-click confirmations are not toasts (journal/statusLines.ts).
            setMessage: toastUnlessStatus((message) => host.showToast(message)),
            setPendingEdits: (count) => {
              if (count > 0) host.markDirty(true)
              host.contentChanged()
            },
            onFullLoadPrompt: setPrompt,
          })
        : null,
    [live, host],
  )
  const format = useSelectionFormat(live)
  const groups = useMemo(() => toolbarGroups(lang), [lang])
  if (!live || !commands) return null
  const pcT = (key: StringKey, params?: Record<string, string | number>) => tFor(lang, key, params)

  return (
    <>
      {props.panel === 'find' ? (
        <FindSheet
          grid={live}
          host={host}
          editing={props.editing}
          pcT={pcT}
          t={t}
          onClose={props.onClose}
        />
      ) : (
        <GroupSheet
          key={props.panel}
          group={groups.find((candidate) => candidate.id === props.panel) ?? groups[0]!}
          commands={commands}
          format={format}
          lang={lang}
          pcT={pcT}
          t={t}
          onOpen={props.onOpen}
          onClose={props.onClose}
        />
      )}
      {prompt && (
        <FullLoadSheet
          prompt={prompt}
          pcT={pcT}
          onCancel={() => setPrompt(null)}
          onStart={() => {
            setPrompt(null)
            let announced = false
            void commands
              .startFullLoad((message) => {
                // The first line says the load started; the rest is the desktop's progress chatter.
                if (announced) return
                announced = true
                host.showToast(message)
              })
              .then(() => host.showToast(t('sheetsToolbarFullLoaded')))
              .catch((error: unknown) => host.showToast({ message: String(error), tone: 'error' }))
          }}
        />
      )}
    </>
  )
}

type PcT = (key: StringKey, params?: Record<string, string | number>) => string

function labelText(label: Label, pcT: PcT, t: (key: MobileStringKey) => string): string {
  return 'pc' in label ? pcT(label.pc) : t(label.own)
}

function GroupSheet({
  group,
  commands,
  format,
  lang,
  pcT,
  t,
  onOpen,
  onClose,
}: {
  readonly group: ToolbarGroup
  readonly commands: ToolbarCommands
  readonly format: SelectionFormat | null
  readonly lang: Lang
  readonly pcT: PcT
  readonly t: (key: MobileStringKey) => string
  readonly onOpen: (panel: ToolbarPanel) => void
  readonly onClose: () => void
}) {
  const [picker, setPicker] = useState<ToolbarPicker | null>(null)
  const run = (command: string) => commands.run(command)
  let body: ReactNode
  if (picker === 'fontFamily' || picker === 'fontSize' || picker === 'numberFormat') {
    body = (
      <PickerList
        picker={picker}
        format={format}
        lang={lang}
        pcT={pcT}
        t={t}
        onBack={() => setPicker(null)}
        onPick={(command) => {
          run(command)
          setPicker(null)
        }}
      />
    )
  } else {
    body = (
      <div className="m-sheets-tb-panel">
        {group.sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            format={format}
            lang={lang}
            pcT={pcT}
            t={t}
            run={run}
            onPicker={(next) => {
              if (next === 'find' || next === 'replace') onOpen('find')
              else setPicker(next)
            }}
          />
        ))}
        {(group.id === 'format' || group.id === 'insert') && (
          <p className="m-sheets-tb-note" data-testid="sheets-toolbar-view-only">
            {t('sheetsToolbarViewOnly')}
          </p>
        )}
      </div>
    )
  }
  return (
    <Sheet
      open
      title={t(group.title)}
      closeLabel={t('cancel')}
      onClose={onClose}
      modal={false}
      testId={`sheets-toolbar-sheet-${group.id}`}
    >
      {body}
    </Sheet>
  )
}

function pickerValue(picker: ToolbarPicker, format: SelectionFormat | null, pcT: PcT): string {
  if (picker === 'fontFamily') return format?.fontFamily ?? 'Aptos'
  if (picker === 'fontSize') return String(format?.fontSize ?? 11)
  if (picker === 'numberFormat') {
    const current = categoryOptionForPattern(format?.numberFormat ?? '')
    const key = NUMBER_FORMAT_LABEL[current]
    return key ? pcT(key) : current
  }
  return ''
}

const PICKER_LABEL: Record<ToolbarPicker, StringKey> = {
  fontFamily: 'appFontFamilyTip',
  fontSize: 'appFontSizeTip',
  numberFormat: 'appGroupNumber',
  find: 'appFind',
  replace: 'appReplace',
}

function SectionView({
  section,
  format,
  pcT,
  t,
  run,
  onPicker,
}: {
  readonly section: ToolbarSection
  readonly format: SelectionFormat | null
  readonly lang: Lang
  readonly pcT: PcT
  readonly t: (key: MobileStringKey) => string
  readonly run: (command: string) => void
  readonly onPicker: (picker: ToolbarPicker) => void
}) {
  const title = labelText(section.title, pcT, t)
  const faced = section.items.filter((entry) => entry.face !== undefined)
  const labeled = section.items.filter((entry) => entry.face === undefined)
  const current = section.swatches?.command === 'fill' ? format?.fillColor : format?.fontColor
  return (
    <section className="m-sheets-tb-section" aria-label={title}>
      <h3 className="m-sheets-tb-section-title">{title}</h3>
      {section.pickers?.map((picker) => (
        <button
          key={picker}
          type="button"
          className="m-sheets-tb-picker"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPicker(picker)}
          data-testid={`sheets-tb-picker-${picker}`}
        >
          <span className="m-sheets-tb-picker-label">{pcT(PICKER_LABEL[picker])}</span>
          <span className="m-sheets-tb-picker-value">{pickerValue(picker, format, pcT)}</span>
          <IconChevronNext size={18} className="m-sheets-tb-chevron" />
        </button>
      ))}
      {section.swatches && (
        <div className="m-sheets-tb-swatches" role="toolbar" aria-label={title}>
          <button
            type="button"
            className="m-sheets-tb-swatch-clear"
            aria-pressed={!current}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => run(section.swatches!.clear.command)}
            data-testid={`sheets-tb-${section.swatches.clear.id}`}
          >
            {labelText(section.swatches.clear.label, pcT, t)}
          </button>
          {TOOLBAR_SWATCHES.map((swatch) => (
            <button
              key={swatch.hex}
              type="button"
              className="m-sheets-tb-swatch"
              aria-label={swatch.name}
              aria-pressed={current === swatch.hex}
              title={swatch.name}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => run(colorCommand(section.swatches!.command, swatch.hex))}
            >
              <span className="m-sheets-tb-swatch-chip" style={{ background: swatch.hex }} />
            </button>
          ))}
        </div>
      )}
      {faced.length > 0 && (
        <div className="m-sheets-tb-keys" role="toolbar" aria-label={title}>
          {faced.map((entry) => (
            <ItemButton key={entry.id} entry={entry} format={format} pcT={pcT} t={t} run={run} />
          ))}
        </div>
      )}
      {labeled.length > 0 && (
        <div className="m-sheets-tb-list" role="toolbar" aria-label={title}>
          {labeled.map((entry) => (
            <ItemButton key={entry.id} entry={entry} format={format} pcT={pcT} t={t} run={run} />
          ))}
        </div>
      )}
    </section>
  )
}

function ItemButton({
  entry,
  format,
  pcT,
  t,
  run,
}: {
  readonly entry: ToolbarItem
  readonly format: SelectionFormat | null
  readonly pcT: PcT
  readonly t: (key: MobileStringKey) => string
  readonly run: (command: string) => void
}) {
  const label = labelText(entry.label, pcT, t)
  return (
    <button
      type="button"
      className={entry.face === undefined ? 'm-sheets-tb-row' : 'm-sheets-tb-key'}
      aria-label={entry.face === undefined ? undefined : label}
      title={entry.face === undefined ? undefined : label}
      aria-pressed={isPressed(entry, format)}
      data-command={entry.command}
      data-testid={`sheets-tb-${entry.id}`}
      // Keep the grid's focus (and a cell editor's caret) where it is.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => run(entry.command)}
    >
      {entry.face === undefined ? (
        label
      ) : (
        <span className="m-sheets-tb-face" data-face={entry.id}>
          {entry.face}
        </span>
      )}
    </button>
  )
}

function PickerList({
  picker,
  format,
  lang,
  pcT,
  t,
  onBack,
  onPick,
}: {
  readonly picker: 'fontFamily' | 'fontSize' | 'numberFormat'
  readonly format: SelectionFormat | null
  readonly lang: Lang
  readonly pcT: PcT
  readonly t: (key: MobileStringKey) => string
  readonly onBack: () => void
  readonly onPick: (command: string) => void
}) {
  let choices: { key: string; label: string; detail?: string; checked: boolean; command: string }[]
  if (picker === 'fontFamily') {
    const current = format?.fontFamily ?? 'Aptos'
    choices = fontFamilyChoices(format?.fontFamily ?? null).map((family) => ({
      key: family,
      label: family,
      checked: family === current,
      command: fontFamilyCommand(family),
    }))
  } else if (picker === 'fontSize') {
    const current = format?.fontSize ?? 11
    const sizes = RIBBON_FONT_SIZES.includes(current)
      ? RIBBON_FONT_SIZES
      : [...RIBBON_FONT_SIZES, current].sort((a, b) => a - b)
    choices = sizes.map((size) => ({
      key: String(size),
      label: String(size),
      checked: size === current,
      command: fontSizeCommand(size),
    }))
  } else {
    const current = categoryOptionForPattern(format?.numberFormat ?? '')
    choices = numberFormatChoices(lang).map((choice) => {
      const key = NUMBER_FORMAT_LABEL[choice.label]
      return {
        key: choice.label,
        label: key ? pcT(key) : choice.label,
        detail: choice.command.slice('format:'.length),
        checked: choice.label === current,
        command: choice.command,
      }
    })
  }
  const title = pcT(PICKER_LABEL[picker])
  return (
    <div className="m-sheets-tb-panel" data-testid={`sheets-tb-list-${picker}`}>
      <button
        type="button"
        className="m-sheets-tb-back"
        onPointerDown={(event) => event.preventDefault()}
        onClick={onBack}
      >
        <IconChevronPrevious size={18} className="m-sheets-tb-chevron" />
        <span>{t('back')}</span>
        <span className="m-sheets-tb-back-title">{title}</span>
      </button>
      <div className="m-sheets-tb-choices" role="radiogroup" aria-label={title}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={choice.checked}
            className="m-sheets-tb-choice"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onPick(choice.command)}
            style={picker === 'fontFamily' ? { fontFamily: choice.label } : undefined}
          >
            <span className="m-sheets-tb-choice-label">{choice.label}</span>
            {choice.detail !== undefined && (
              <span className="m-sheets-tb-choice-detail">{choice.detail}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

const FIND_DEFAULTS: FindOptions = {
  text: '',
  matchCase: false,
  entireCell: false,
  workbook: false,
  formulas: false,
}

function FindSheet({
  grid,
  host,
  editing,
  pcT,
  t,
  onClose,
}: {
  readonly grid: MobileGrid
  readonly host: EditorHost
  readonly editing: boolean
  readonly pcT: PcT
  readonly t: (key: MobileStringKey) => string
  readonly onClose: () => void
}) {
  const [options, setOptions] = useState<FindOptions>(FIND_DEFAULTS)
  const [replaceText, setReplaceText] = useState('')
  const [hits, setHits] = useState<readonly FindHit[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  const setMessage = toastUnlessStatus((message) => host.showToast(message))

  const search = async (next: FindOptions = options): Promise<readonly FindHit[]> => {
    const mine = ++generation.current
    setBusy(true)
    try {
      const result = await findInWorkbook(
        grid.runtime,
        grid.lazyWorkbookRef,
        next,
        () => generation.current === mine,
      )
      if (generation.current !== mine) return []
      setHits(result.hits)
      setCapped(result.capped)
      setIndex(0)
      const first = result.hits[0]
      if (first) revealHit(grid.runtime, grid.lazyWorkbookRef, first, setMessage)
      return result.hits
    } catch (error: unknown) {
      host.showToast({ message: String(error), tone: 'error' })
      return []
    } finally {
      if (generation.current === mine) setBusy(false)
    }
  }

  const move = (step: 1 | -1) => {
    if (!hits || hits.length === 0) return
    const next = (index + step + hits.length) % hits.length
    setIndex(next)
    const hit = hits[next]
    if (hit) revealHit(grid.runtime, grid.lazyWorkbookRef, hit, setMessage)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (options.text.trim().length > 0) void search()
  }

  const replaceOne = async () => {
    const hit = hits?.[index]
    if (!hit) return
    if (!replaceHit(grid.runtime, hit, options, replaceText)) {
      host.showToast(pcT('dlgFrReplaceFailed'))
      return
    }
    await search()
  }

  const replaceAll = async () => {
    const all = await search()
    let count = 0
    for (const hit of all) {
      if (replaceable(hit, options) && replaceHit(grid.runtime, hit, options, replaceText)) {
        count += 1
      }
    }
    host.showToast(pcT('dlgFrReplacedAll', { count }))
    await search()
  }

  const set = (patch: Partial<FindOptions>) => setOptions((current) => ({ ...current, ...patch }))
  const status =
    hits === null
      ? null
      : hits.length === 0
        ? pcT('dlgFrNoMatch')
        : pcT('dlgFrMatches', {
            position: index + 1,
            // Stopped at the desktop's match cap: there are more.
            count: capped ? `${hits.length}+` : hits.length,
          })

  return (
    <Sheet
      open
      title={pcT(editing ? 'dlgFrTitle' : 'appFind')}
      closeLabel={t('cancel')}
      onClose={onClose}
      modal={false}
      testId="sheets-toolbar-sheet-find"
    >
      <form className="m-sheets-tb-panel m-sheets-tb-find" onSubmit={submit}>
        <label className="m-sheets-tb-field">
          <span>{pcT('dlgFrFindWhat')}</span>
          <input
            className="mobile-input"
            type="search"
            enterKeyHint="search"
            value={options.text}
            onChange={(event) => set({ text: event.target.value })}
            data-testid="sheets-find-input"
          />
        </label>
        {editing && (
          <label className="m-sheets-tb-field">
            <span>{pcT('dlgFrReplaceWith')}</span>
            <input
              className="mobile-input"
              type="text"
              value={replaceText}
              onChange={(event) => setReplaceText(event.target.value)}
              data-testid="sheets-replace-input"
            />
          </label>
        )}
        <div className="m-sheets-tb-options">
          <FindToggle
            label={pcT('dlgFrMatchCase')}
            checked={options.matchCase}
            onChange={(matchCase) => set({ matchCase })}
          />
          <FindToggle
            label={pcT('dlgFrMatchCell')}
            checked={options.entireCell}
            onChange={(entireCell) => set({ entireCell })}
          />
          <FindToggle
            label={`${pcT('dlgFrScope')}: ${pcT('dlgFrScopeWorkbook')}`}
            checked={options.workbook}
            onChange={(workbook) => set({ workbook })}
          />
          <FindToggle
            label={`${pcT('dlgFrLookIn')}: ${pcT('dlgFrLookInFormula')}`}
            checked={options.formulas}
            onChange={(formulas) => set({ formulas })}
          />
        </div>
        <p className="m-sheets-tb-find-status" role="status" aria-live="polite">
          {busy ? '…' : status}
        </p>
        <div className="m-sheets-tb-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost m-sheets-tb-action"
            disabled={!hits || hits.length === 0}
            onClick={() => move(-1)}
          >
            {pcT('dlgFrFindPrev')}
          </button>
          {hits && hits.length > 0 && !busy ? (
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-primary m-sheets-tb-action"
              onClick={() => move(1)}
              data-testid="sheets-find-next"
            >
              {pcT('dlgFrFindNext')}
            </button>
          ) : (
            <button
              type="submit"
              className="mobile-pill-btn mobile-btn-primary m-sheets-tb-action"
              disabled={busy || options.text.trim().length === 0}
              data-testid="sheets-find-submit"
            >
              {pcT('appFind')}
            </button>
          )}
        </div>
        {editing && (
          <div className="m-sheets-tb-actions">
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ghost m-sheets-tb-action"
              disabled={busy || !hits || hits.length === 0}
              onClick={() => void replaceOne()}
              data-testid="sheets-replace-one"
            >
              {pcT('dlgFrReplace')}
            </button>
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ghost m-sheets-tb-action"
              disabled={busy || options.text.trim().length === 0}
              onClick={() => void replaceAll()}
              data-testid="sheets-replace-all"
            >
              {pcT('dlgFrReplaceAll')}
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

function FindToggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="m-sheets-tb-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function FullLoadSheet({
  prompt,
  pcT,
  onCancel,
  onStart,
}: {
  readonly prompt: FullLoadPrompt
  readonly pcT: PcT
  readonly onCancel: () => void
  readonly onStart: () => void
}) {
  return (
    <Sheet
      open
      title={pcT('appFullLoadFilterTitle')}
      closeLabel={pcT('appDialogCancel')}
      onClose={onCancel}
      testId="sheets-full-load-sheet"
    >
      <div className="m-sheets-tb-panel">
        <p className="m-sheets-tb-body">
          {pcT(prompt === 'ask' ? 'appFullLoadFilterBody' : 'appFullLoadTooLarge')}
        </p>
        <div className="m-sheets-tb-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost m-sheets-tb-action"
            onClick={onCancel}
          >
            {pcT('appDialogCancel')}
          </button>
          {prompt === 'ask' && (
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-primary m-sheets-tb-action"
              onClick={onStart}
              data-testid="sheets-full-load-start"
            >
              {pcT('appFullLoadStart')}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
