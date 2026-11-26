/**
 * The phone's Univer: the mobile UI plugins Univer 0.25.1 ships
 * (`UniverMobileUIPlugin`, `UniverSheetsMobileUIPlugin` and the filter,
 * conditional-format and validation mobile UIs) over the same core plugins
 * the desktop preset registers, put together with the desktop's own
 * `createUniver` helper (apps/sheets/src/renderer/create-univer.ts).
 *
 * Features without a mobile UI plugin (sort, notes) register only their core
 * plugin, so their commands run while their screens are ours.
 */
import { LocaleType, mergeLocales } from '@univerjs/core'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverDocsUIPlugin } from '@univerjs/docs-ui'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverNetworkPlugin } from '@univerjs/network'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting'
import { UniverSheetsConditionalFormattingMobileUIPlugin } from '@univerjs/sheets-conditional-formatting-ui'
import { UniverDataValidationPlugin } from '@univerjs/data-validation'
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation'
import { UniverSheetsDataValidationMobileUIPlugin } from '@univerjs/sheets-data-validation-ui'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsFilterMobileUIPlugin } from '@univerjs/sheets-filter-ui'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui'
import { UniverSheetsNotePlugin } from '@univerjs/sheets-note'
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt'
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort'
import { FormulaBar, UniverSheetsMobileUIPlugin } from '@univerjs/sheets-ui'
import { BuiltInUIPart, IUIPartsService, UniverMobileUIPlugin } from '@univerjs/ui'
import { greenTheme } from '@univerjs/themes'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import UniverPresetSheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US'
import UniverPresetSheetsNoteEnUS from '@univerjs/preset-sheets-note/locales/en-US'
import UniverPresetSheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US'
import '@univerjs/network/facade'
import '@univerjs/sheets/facade'
import '@univerjs/ui/facade'
import '@univerjs/docs-ui/facade'
import '@univerjs/sheets-ui/facade'
import '@univerjs/engine-formula/facade'
import '@univerjs/sheets-formula/facade'
import '@univerjs/sheets-formula-ui/facade'
import '@univerjs/sheets-numfmt/facade'
import '@univerjs/sheets-filter/facade'
import '@univerjs/sheets-conditional-formatting/facade'
import '@univerjs/sheets-data-validation/facade'
import '@univerjs/sheets-note/facade'
import '@univerjs/sheets-sort/facade'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import { createUniver } from '../../../../../../sheets/src/renderer/create-univer'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

/** The plugin names the phone registers (reported by the prototype). */
export const MOBILE_UNIVER_PLUGINS = [
  'UniverNetworkPlugin',
  'UniverDocsPlugin',
  'UniverRenderEnginePlugin',
  'UniverMobileUIPlugin',
  'UniverDocsUIPlugin',
  'UniverFormulaEnginePlugin',
  'UniverSheetsPlugin',
  'UniverSheetsMobileUIPlugin',
  'UniverSheetsNumfmtPlugin',
  'UniverSheetsFormulaPlugin',
  'UniverSheetsFormulaUIPlugin (desktop: the cell editor component)',
  'UniverSheetsFilterPlugin',
  'UniverSheetsFilterMobileUIPlugin',
  'UniverSheetsConditionalFormattingPlugin',
  'UniverSheetsConditionalFormattingMobileUIPlugin',
  'UniverDataValidationPlugin',
  'UniverSheetsDataValidationPlugin',
  'UniverSheetsDataValidationMobileUIPlugin',
  'UniverSheetsNotePlugin',
  'UniverSheetsSortPlugin',
] as const

export interface MobileUniverOptions {
  /** The element (or its id) Univer mounts into. */
  readonly container: HTMLElement | string
  readonly darkMode: boolean
}

export function createMobileUniver(options: MobileUniverOptions): UniverRuntime {
  const runtime = createUniver({
    theme: greenTheme,
    darkMode: options.darkMode,
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        UniverPresetSheetsCoreEnUS,
        UniverPresetSheetsConditionalFormattingEnUS,
        UniverPresetSheetsFilterEnUS,
        UniverPresetSheetsDataValidationEnUS,
        UniverPresetSheetsNoteEnUS,
        UniverPresetSheetsSortEnUS,
      ),
    },
    presets: [],
    plugins: [
      UniverNetworkPlugin,
      UniverDocsPlugin,
      UniverRenderEnginePlugin,
      [
        UniverMobileUIPlugin,
        {
          container: options.container,
          header: true,
          toolbar: false,
          // The sheet switcher is ours (grid/SheetSwitcher.tsx: 48 px tabs,
          // add and rename in edit mode); Univer's mobile sheet bar is not shown.
          footer: false,
          contextMenu: true,
          // Univer focuses its hidden cell input at start, which raises the
          // virtual keyboard on open (seen on Android); the grid opens to read.
          disableAutoFocus: true,
        },
      ],
      UniverDocsUIPlugin,
      UniverFormulaEnginePlugin,
      // OOXML resolves style defaults as cell over row over column (as on the desktop).
      [UniverSheetsPlugin, { isRowStylePrecedeColumnStyle: true }],
      [UniverSheetsMobileUIPlugin, { formulaBar: true, footer: false }],
      UniverSheetsNumfmtPlugin,
      UniverSheetsFormulaPlugin,
      // Desktop plugin: Univer's cell editor (EditorContainer) draws the
      // formula editor component this plugin registers; the mobile sheets UI
      // has no editor of its own.
      UniverSheetsFormulaUIPlugin,
      UniverSheetsFilterPlugin,
      UniverSheetsFilterMobileUIPlugin,
      UniverSheetsConditionalFormattingPlugin,
      UniverSheetsConditionalFormattingMobileUIPlugin,
      UniverDataValidationPlugin,
      UniverSheetsDataValidationPlugin,
      UniverSheetsDataValidationMobileUIPlugin,
      UniverSheetsNotePlugin,
      UniverSheetsSortPlugin,
    ] as never,
  })
  return runtime
}

/**
 * The mobile sheets UI registers no header part, so there is no formula bar;
 * this puts the desktop one there. Call after the first workbook unit exists
 * (the UI services start with it).
 */
export function installDesktopFormulaBar(runtime: UniverRuntime): { dispose(): void } {
  return runtime.univer
    .__getInjector()
    .get(IUIPartsService)
    .registerComponent(BuiltInUIPart.HEADER, () => FormulaBar)
}
