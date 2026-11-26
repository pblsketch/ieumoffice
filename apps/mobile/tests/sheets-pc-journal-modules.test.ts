// The desktop code the phone's edit journal reuses or re-states. These fail
// when that desktop code changes, so the change is noticed and carried over
// to apps/mobile/src/renderer/editors/sheets/journal/ (see its header).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as editJournal from '../../sheets/src/renderer/edit-journal'

const RENDERER = resolve(__dirname, '../../sheets/src/renderer')

/** Whitespace-insensitive digest of the desktop text between two markers. */
function blockDigest(file: string, start: string, end: string): string {
  const text = readFileSync(resolve(RENDERER, file), 'utf8')
  const from = text.indexOf(start)
  const to = text.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`marker not found in ${file}: ${start}`)
  const block = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(block).digest('hex')
}

describe('the desktop code behind the phone edit journal', () => {
  it('still has the listener and the edit gate the phone re-states', () => {
    // A new digest means the desktop's App.tsx listener changed: carry the
    // change over to journal/editJournal.ts, then update the digest here.
    expect(
      blockDigest(
        'App.tsx',
        'const journalDisposable = runtime.univerAPI.addEvent(',
        'const structuralDisposable =',
      ),
      'App.tsx journalDisposable',
    ).toBe('e46876c34ca05ac6af112c12de6711a8e36dd0e2b46de9fcc272fe13755d2201')
    expect(
      blockDigest(
        'App.tsx',
        'const structuralDisposable = runtime.univerAPI.addEvent(',
        '// File-menu accelerators',
      ),
      'App.tsx structuralDisposable',
    ).toBe('1dc39a27fcd2d098e3e270aaf61dca5bcd61b52e6be4947cb9099a2790eede68')
  })

  it('exports the journal functions the phone calls', () => {
    for (const name of [
      'createEditJournal',
      'isSheetRemoved',
      'journalSize',
      'recordCfChange',
      'recordDefinedNamesChange',
      'recordDvChange',
      'recordFilterChange',
      'recordNoteChange',
      'recordPageSetup',
      'recordRemoveNumfmt',
      'recordSetNumfmt',
      'recordSetRangeValues',
      'recordSheetHidden',
      'recordSheetInsert',
      'recordSheetOrderChange',
      'recordSheetRemove',
      'recordSheetRename',
      'recordSheetTabColor',
      'recordStructuralOp',
      'shiftVisualForStructuralOp',
      'toSaveStructuralOps',
      'toSaveSheetOps',
    ]) {
      expect(typeof (editJournal as Record<string, unknown>)[name], name).toBe('function')
    }
  })

  it('loads the glob boundary with the names and values the listener expects', async () => {
    const boundary = await import('../src/renderer/editors/sheets/journal/pcJournalModules')
    const constants = boundary.pcAppConstants as unknown as Record<string, unknown>
    expect(constants.SET_RANGE_VALUES_MUTATION).toBe('sheet.mutation.set-range-values')
    expect(constants.SET_NUMFMT_MUTATION).toBe('sheet.mutation.set.numfmt')
    expect(constants.REMOVE_NUMFMT_MUTATION).toBe('sheet.mutation.remove.numfmt')
    expect(constants.SET_FROZEN_MUTATION).toBe('sheet.mutation.set-frozen')
    expect(constants.REORDER_RANGE_MUTATION).toBe('sheet.mutation.reorder-range')
    expect(constants.COPY_SHEET_COMMAND).toBe('sheet.command.copy-sheet')
    for (const name of [
      'ROW_COLUMN_MUTATIONS',
      'MERGE_MUTATIONS',
      'AXIS_ATTR_MUTATIONS',
      'FILTER_MUTATIONS',
      'CF_MUTATIONS',
      'DV_MUTATIONS',
      'DEFINED_NAME_MUTATIONS',
      'NOTE_MUTATIONS',
      'SHEET_LIFECYCLE_MUTATIONS',
      'STRUCTURE_LOCK_COMMANDS',
      'STRUCTURAL_EDIT_COMMAND_PATTERN',
      'RANGE_SHIFT_COMMAND_PATTERN',
      'SORT_COMMAND_PATTERN',
      'FILTER_COMMAND_PATTERN',
      'DV_EDIT_COMMAND_PATTERN',
      'BLOCKED_COMMAND_PATTERN',
      'SET_RANGE_VALUES_COMMAND',
      'TOGGLE_GRIDLINES_MUTATION',
      'SET_RIGHT_TO_LEFT_MUTATION',
      'SET_ZOOM_OPERATION',
      'SET_ZOOM_COMMAND',
      'OPEN_FILTER_PANEL_OPERATION',
      'MOVE_RANGE_MUTATION',
      'MOVE_RANGE_COMMAND',
      'MOVE_ROWS_MUTATION',
      'MOVE_ROWS_COMMAND',
      'AUTO_FILL_COMMAND',
    ]) {
      expect(constants[name], name).toBeDefined()
    }
    expect(typeof constants.pixelsToCharacterWidth).toBe('function')
    const functions: Record<string, readonly string[]> = {
      pcUniverSyncJournal: [
        'journalRangeSnapshot',
        'matrixBounds',
        'workbookStructureLocked',
        'loadVisibleRange',
      ],
      pcLargeFilter: ['isLargeFilterSheet', 'extendLargeFilterRange'],
      pcReorderGate: [
        'reorderGate',
        'fullLoadGate',
        'largestRangeCells',
        'rangeHasStreamedFormulas',
        'reorderCommandRanges',
      ],
      pcPlanOperations: ['structuralDeleteFormulaErrorSync'],
    }
    for (const [module, names] of Object.entries(functions)) {
      const loaded = (boundary as unknown as Record<string, Record<string, unknown>>)[module]
      for (const name of names) {
        expect(typeof loaded?.[name], `${module}.${name}`).toBe('function')
      }
    }
  }, 180_000)

  it('keeps the desktop save flow the default save calls', async () => {
    const { pcSaveActions } = await import('../src/renderer/editors/sheets/save/documentSlot')
    expect(typeof (await pcSaveActions()).handleSave).toBe('function')
  }, 180_000)
})
