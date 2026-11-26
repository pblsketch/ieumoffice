// The edit toolbar on a real Univer: each toolbar item sends the same Univer
// commands the desktop ribbon sends for the same command string (the desktop
// dispatcher called the way App.tsx calls it is the reference), and the
// edits land in the journal and in the save request the desktop's save flow
// builds (as in sheets-edit-journal.test.ts).
import { describe, expect, it } from 'vitest'
import { installToolbarCommands } from '../src/renderer/editors/sheets/toolbar/runRibbon'
import { pcRibbonActions } from '../src/renderer/editors/sheets/toolbar/pcToolbarModules'
import { toolbarCommands, toolbarGroups } from '../src/renderer/editors/sheets/toolbar/groups'
import { boot, desktopContext, saveRequest, seed, settle } from './helpers/sheetsToolbarBoot'

describe('the sheets edit toolbar commands', () => {
  it('sends the same Univer commands as the desktop dispatcher for every toolbar item', async () => {
    const commands = toolbarCommands(toolbarGroups('en'), { lang: 'en' }).filter(
      // AutoSum writes below a 2+ row selection; covered on its own below.
      (command) => !command.startsWith('autofn:'),
    )
    expect(commands.length).toBeGreaterThan(30)
    for (const command of commands) {
      const phone = boot()
      seed(phone.sheet)
      phone.workbook.setActiveRange(phone.sheet.getRange('A1:B3'))
      phone.executed.length = 0
      phone.toolbar.run(command)
      await settle()

      const desktop = boot()
      // The desktop's filter UI plugin registers the filter toggle.
      installToolbarCommands(desktop.runtime)
      seed(desktop.sheet)
      desktop.workbook.setActiveRange(desktop.sheet.getRange('A1:B3'))
      desktop.executed.length = 0
      if (command === 'calculate-now' || command === 'calculate-sheet') {
        // App.tsx runs these two itself (calc-options.ts), not the dispatcher.
        const calc = await import('../../sheets/src/renderer/calc-options')
        if (command === 'calculate-now') calc.calculateNow(desktop.runtime)
        else calc.calculateSheet(desktop.runtime)
      } else {
        pcRibbonActions.handleRibbonCommand(
          desktopContext(desktop.runtime, desktop.lazyWorkbookRef),
          command,
        )
      }
      await settle()
      expect(phone.executed.length, command).toBeGreaterThan(0)
      expect(phone.executed, command).toEqual(desktop.executed)
      phone.uninstall()
      desktop.uninstall()
      phone.univer.dispose()
      desktop.univer.dispose()
    }
  }, 600_000)

  it('lands format, border, number format, row, sort and filter edits in the save request', async () => {
    const { runtime, lazyWorkbookRef, sheet, workbook, toolbar } = boot()
    seed(sheet)
    workbook.setActiveRange(sheet.getRange('B1'))
    toolbar.run('bold')
    toolbar.run('fill:#FFFF00')
    toolbar.run('align:center')
    toolbar.run('border:all:#000000')
    workbook.setActiveRange(sheet.getRange('A1'))
    toolbar.run('format:0.00')
    workbook.setActiveRange(sheet.getRange('A1:A3'))
    toolbar.run('sort:asc')
    await settle()
    expect(sheet.getRange('A1').getValue()).toBe(1)
    toolbar.run('filter-toggle')
    workbook.setActiveRange(sheet.getRange('A5'))
    toolbar.run('insert-row-here')
    await settle()

    const request = await saveRequest(runtime, lazyWorkbookRef)
    const at = (row: number, column: number) =>
      request.edits.filter((edit) => edit.row === row && edit.column === column)
    const style = JSON.stringify(at(0, 1).map((edit) => (edit as { style?: unknown }).style))
    expect(style).toMatch(/bold|"b"/)
    expect(style).toMatch(/ffff00/i)
    expect(style).toMatch(/center/)
    expect(style).toMatch(/border|thin/i)
    // the 3 formatted in A1 sorted down to A3, its number format with it
    expect(JSON.stringify(at(2, 0))).toContain('0.00')
    expect(request.structuralOps.map((op) => op.kind)).toContain('insert-rows')
    expect(request.filterStates.map((filter) => filter.sheetId)).toContain('sheet-1')
  }, 180_000)

  it('writes AutoSum below the selection and adds a sheet named on from Sheet1', async () => {
    const { runtime, lazyWorkbookRef, sheet, workbook, toolbar } = boot()
    seed(sheet)
    workbook.setActiveRange(sheet.getRange('A1:A3'))
    toolbar.run('autofn:SUM')
    expect(sheet.getRange('A4').getFormula()).toBe('=SUM(A1:A3)')
    toolbar.run('insert-sheet')
    await settle()
    const names = runtime.univerAPI
      .getActiveWorkbook()!
      .getSheets()
      .map((candidate) => candidate.getSheetName())
    expect(names).toContain('Sheet2')
    const request = await saveRequest(runtime, lazyWorkbookRef)
    expect(request.sheetOps.some((op) => op.kind === 'add-sheet')).toBe(true)
    expect(
      request.edits.some(
        (edit) => edit.row === 3 && (edit as { formula?: string }).formula === '=SUM(A1:A3)',
      ),
    ).toBe(true)
  }, 180_000)

  it('offers the full load before a sort or filter of a streamed workbook', async () => {
    const { toolbar, prompts, executed, sheet, workbook, state } = boot({ preloadComplete: false })
    // A value-mode workbook (formula-mode ones preload on their own at open).
    ;(state as { formulaMode: boolean }).formulaMode = false
    seed(sheet)
    workbook.setActiveRange(sheet.getRange('A1:A3'))
    executed.length = 0
    toolbar.run('sort:asc')
    toolbar.run('filter-toggle')
    await settle()
    expect(prompts).toEqual(['ask', 'ask'])
    expect(executed.filter((id) => /sort|filter/.test(id))).toEqual([])
  }, 180_000)
})
