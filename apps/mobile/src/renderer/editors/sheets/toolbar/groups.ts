/**
 * What the edit toolbar offers, as data: the four groups
 * ([셀 서식][행·열][정렬·필터][삽입]), their sections and items, and the
 * desktop ribbon command string each item sends. The strings are the ones
 * the desktop ribbon (apps/sheets/src/renderer/ExcelShell.tsx) sends for the
 * same button, built with the desktop's own helpers (number formats, font
 * sizes, border color); `tests/sheets-toolbar-groups.test.ts` checks them
 * against the desktop ribbon text.
 *
 * Charts, pivot tables and conditional formatting are view-only in 1판: no
 * group sends a command that edits them (the same test checks it).
 */
import type { Lang } from '@genoffice/i18n'
import { STANDARD_COLORS, THEME_COLORS } from '@genoffice/ui'
import {
  accountingStyle,
  COMMA_STYLE,
  PERCENT_STYLE,
  ribbonCurrencySymbol,
} from '../../../../../../sheets/src/renderer/excel-format-shortcuts'
import type { StringKey } from '../../../../../../sheets/src/renderer/i18n/locale'
import { numberFormatCategories } from '../../../../../../sheets/src/renderer/number-format'
import { DEFAULT_FONT_FAMILIES } from '../../../../../../sheets/src/renderer/system-fonts'
import type { MobileStringKey } from '../../../i18n'

export type ToolbarGroupId = 'format' | 'rows' | 'sort' | 'insert'

/** Toggle state an item echoes from the selection (`SelectionFormat`). */
export type ToolbarToggle =
  | { readonly kind: 'flag'; readonly flag: 'bold' | 'italic' | 'underline' | 'strike' | 'wrap' }
  | { readonly kind: 'horizontal'; readonly value: string }
  | { readonly kind: 'vertical'; readonly value: string }

export interface ToolbarItem {
  readonly id: string
  /** The desktop ribbon command string. */
  readonly command: string
  /** Label from the desktop's strings (22 languages), or the phone's own. */
  readonly label: { readonly pc: StringKey } | { readonly own: MobileStringKey }
  /** Short text drawn as the button face (B, I, U, …); otherwise the label. */
  readonly face?: string
  readonly toggle?: ToolbarToggle
}

/** A row that opens a picker inside the same sheet instead of sending a command. */
export type ToolbarPicker = 'fontFamily' | 'fontSize' | 'numberFormat' | 'find' | 'replace'

export interface ToolbarSection {
  readonly id: string
  readonly title: { readonly pc: StringKey } | { readonly own: MobileStringKey }
  readonly pickers?: readonly ToolbarPicker[]
  /** Color swatches that each send `${swatchCommand}:#RRGGBB`. */
  readonly swatches?: {
    readonly command: 'font-color' | 'fill'
    readonly clear: ToolbarItem
  }
  readonly items: readonly ToolbarItem[]
}

export interface ToolbarGroup {
  readonly id: ToolbarGroupId
  readonly title: MobileStringKey
  readonly sections: readonly ToolbarSection[]
}

/** The desktop ribbon's border color until one is picked (ExcelShell `borderColor`). */
export const RIBBON_BORDER_COLOR = '#000000'

/** The desktop ribbon's font size list (ExcelShell `fontSizes`). */
export const RIBBON_FONT_SIZES: readonly number[] = [9, 10, 11, 12, 14, 16, 18, 22, 26]

/** Swatches of the shared Word-style palette (@genoffice/ui), theme row then standard row. */
export const TOOLBAR_SWATCHES: readonly { readonly name: string; readonly hex: string }[] = [
  ...THEME_COLORS.slice(0, 10),
  ...STANDARD_COLORS,
].map((swatch) => ({ name: swatch.name, hex: `#${swatch.hex.toUpperCase()}` }))

const pc = (key: StringKey) => ({ pc: key })
const own = (key: MobileStringKey) => ({ own: key })

function item(
  id: string,
  command: string,
  label: ToolbarItem['label'],
  extra: Partial<ToolbarItem> = {},
): ToolbarItem {
  return { id, command, label, ...extra }
}

const BORDERS: readonly [string, StringKey][] = [
  ['all', 'appBorderAll'],
  ['outer', 'appBorderOuter'],
  ['thick-outer', 'appBorderThickOuter'],
  ['top', 'appBorderTop'],
  ['bottom', 'appBorderBottom'],
  ['left', 'appBorderLeft'],
  ['right', 'appBorderRight'],
  ['none', 'appBorderNone'],
]

/** ExcelShell: `onCommand(\`border:${value}:${borderColor}\`)`. */
export function borderCommand(kind: string, color: string = RIBBON_BORDER_COLOR): string {
  return `border:${kind}:${color}`
}

/** ExcelShell: font and fill color picks. */
export function colorCommand(target: 'font-color' | 'fill', hex: string | null): string {
  if (hex) return `${target}:${hex}`
  return target === 'font-color' ? 'font-color:auto' : 'fill:none'
}

/** ExcelShell NumberFormatSelect: `format:${category.pattern}`. */
export function numberFormatChoices(
  lang: Lang,
): readonly { readonly label: string; readonly command: string }[] {
  return numberFormatCategories(lang).map((category) => ({
    label: category.label,
    command: `format:${category.pattern}`,
  }))
}

export function fontFamilyCommand(family: string): string {
  return `font-family:${family}`
}

export function fontSizeCommand(size: number): string {
  return `font-size:${size}`
}

/** The font families the picker lists (the desktop's candidates; a phone cannot list its fonts). */
export function fontFamilyChoices(current: string | null): readonly string[] {
  return current && !DEFAULT_FONT_FAMILIES.includes(current)
    ? [current, ...DEFAULT_FONT_FAMILIES]
    : DEFAULT_FONT_FAMILIES
}

export function toolbarGroups(lang: Lang): readonly ToolbarGroup[] {
  const currency = ribbonCurrencySymbol(lang)
  return [
    {
      id: 'format',
      title: 'sheetsToolbarFormat',
      sections: [
        {
          id: 'font',
          title: pc('appGroupFont'),
          pickers: ['fontFamily', 'fontSize'],
          items: [
            item('bold', 'bold', pc('appBold'), {
              face: 'B',
              toggle: { kind: 'flag', flag: 'bold' },
            }),
            item('italic', 'italic', pc('appItalic'), {
              face: 'I',
              toggle: { kind: 'flag', flag: 'italic' },
            }),
            item('underline', 'underline', pc('appUnderline'), {
              face: 'U',
              toggle: { kind: 'flag', flag: 'underline' },
            }),
            item('strike', 'strike', pc('appStrikethrough'), {
              face: 'S',
              toggle: { kind: 'flag', flag: 'strike' },
            }),
            item('fontSmaller', 'font-size-step:-1', pc('appDecreaseFontSize'), { face: 'A−' }),
            item('fontBigger', 'font-size-step:1', pc('appIncreaseFontSize'), { face: 'A+' }),
          ],
        },
        {
          id: 'fontColor',
          title: pc('appFontColor'),
          swatches: {
            command: 'font-color',
            clear: item('fontColorAuto', colorCommand('font-color', null), pc('appAutomaticColor')),
          },
          items: [],
        },
        {
          id: 'fill',
          title: pc('appFillColor'),
          swatches: {
            command: 'fill',
            clear: item('fillNone', colorCommand('fill', null), pc('dlgFcNoFill')),
          },
          items: [],
        },
        {
          id: 'borders',
          title: pc('appBorders'),
          items: BORDERS.map(([kind, label]) =>
            item(`border-${kind}`, borderCommand(kind), pc(label)),
          ),
        },
        {
          id: 'alignment',
          title: pc('appGroupAlignment'),
          items: [
            item('alignLeft', 'align:left', pc('appAlignLeft'), {
              toggle: { kind: 'horizontal', value: 'left' },
            }),
            item('alignCenter', 'align:center', pc('appAlignCenter'), {
              toggle: { kind: 'horizontal', value: 'center' },
            }),
            item('alignRight', 'align:right', pc('appAlignRight'), {
              toggle: { kind: 'horizontal', value: 'right' },
            }),
            item('alignTop', 'valign:top', pc('appTopAlign'), {
              toggle: { kind: 'vertical', value: 'top' },
            }),
            item('alignMiddle', 'valign:middle', pc('appMiddleAlign'), {
              toggle: { kind: 'vertical', value: 'center' },
            }),
            item('alignBottom', 'valign:bottom', pc('appBottomAlign'), {
              toggle: { kind: 'vertical', value: 'bottom' },
            }),
            item('wrap', 'wrap', pc('dlgFcWrapText'), { toggle: { kind: 'flag', flag: 'wrap' } }),
            item('mergeCenter', 'merge:center', pc('appMergeCenter')),
            item('unmerge', 'merge:unmerge', pc('appUnmergeCells')),
          ],
        },
        {
          id: 'number',
          title: pc('appGroupNumber'),
          pickers: ['numberFormat'],
          items: [
            item('currency', `format:${accountingStyle(currency)}`, pc('appCurrency'), {
              face: currency,
            }),
            item('percent', `format:${PERCENT_STYLE}`, pc('appPercentTitle'), { face: '%' }),
            item('thousands', `format:${COMMA_STYLE}`, pc('appThousands'), { face: ',' }),
            item('decimalInc', 'decimal-inc', pc('appIncreaseDecimal'), { face: '.0+' }),
            item('decimalDec', 'decimal-dec', pc('appDecreaseDecimal'), { face: '.0−' }),
          ],
        },
      ],
    },
    {
      id: 'rows',
      title: 'sheetsToolbarRows',
      sections: [
        {
          id: 'cells',
          title: pc('appGroupCells'),
          items: [
            item('insertRow', 'insert-row-here', pc('appInsertRow')),
            item('deleteRow', 'delete-row-here', pc('appDeleteRow')),
            item('insertCol', 'insert-col-here', pc('appInsertCol')),
            item('deleteCol', 'delete-col-here', pc('appDeleteCol')),
            item('autofitRows', 'autofit-row-height', pc('appAutoFitRowHeight')),
            item('autofitCols', 'autofit-col-width', pc('appAutoFitColWidth')),
          ],
        },
      ],
    },
    {
      id: 'sort',
      title: 'sheetsToolbarSort',
      sections: [
        {
          id: 'sortFilter',
          title: pc('appGroupSortFilter'),
          items: [
            item('sortAsc', 'sort:asc', pc('appSortAToZ')),
            item('sortDesc', 'sort:desc', pc('appSortZToA')),
            item('filter', 'filter-toggle', pc('appFilter')),
            item('filterClear', 'filter-clear', pc('appClearFilterTitle')),
            item('filterReapply', 'filter-reapply', pc('appReapplyTitle')),
          ],
        },
        {
          id: 'find',
          title: pc('appGroupEditing'),
          pickers: ['find', 'replace'],
          items: [],
        },
      ],
    },
    {
      id: 'insert',
      title: 'sheetsToolbarInsert',
      sections: [
        {
          id: 'autoSum',
          title: pc('appAutoSum'),
          items: [
            item('sum', 'autofn:SUM', pc('appFnSum')),
            item('average', 'autofn:AVERAGE', pc('appFnAverage')),
            item('count', 'autofn:COUNT', pc('appFnCountNumbers')),
            item('max', 'autofn:MAX', pc('appFnMax')),
            item('min', 'autofn:MIN', pc('appFnMin')),
          ],
        },
        {
          id: 'insertValue',
          title: own('sheetsToolbarInsertValues'),
          items: [
            item('today', 'insert-now:date', own('sheetsToolbarToday')),
            item('now', 'insert-now:time', own('sheetsToolbarTimeNow')),
            item('newSheet', 'insert-sheet', own('sheetsToolbarNewSheet')),
          ],
        },
        {
          id: 'calculation',
          title: pc('appGroupCalculation'),
          items: [
            item('calcNow', 'calculate-now', pc('appCalculateNow')),
            item('calcSheet', 'calculate-sheet', pc('appCalculateSheet')),
          ],
        },
      ],
    },
  ]
}

/**
 * Every command string the groups can send: the items, each swatch row's
 * clear entry and first swatch, every number format choice, the first font
 * family and the font sizes (for the tests).
 */
export function toolbarCommands(
  groups: readonly ToolbarGroup[],
  options: { lang: Lang },
): string[] {
  const commands = new Set<string>()
  for (const group of groups) {
    for (const section of group.sections) {
      for (const entry of section.items) commands.add(entry.command)
      if (section.swatches) {
        commands.add(section.swatches.clear.command)
        const first = TOOLBAR_SWATCHES[0]
        if (first) commands.add(colorCommand(section.swatches.command, first.hex))
      }
      for (const picker of section.pickers ?? []) {
        if (picker === 'numberFormat') {
          for (const choice of numberFormatChoices(options.lang)) commands.add(choice.command)
        } else if (picker === 'fontFamily') {
          const first = DEFAULT_FONT_FAMILIES[0]
          if (first) commands.add(fontFamilyCommand(first))
        } else if (picker === 'fontSize') {
          for (const size of RIBBON_FONT_SIZES) commands.add(fontSizeCommand(size))
        }
      }
    }
  }
  return [...commands]
}
