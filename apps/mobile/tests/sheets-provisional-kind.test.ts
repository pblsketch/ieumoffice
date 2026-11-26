import { describe, expect, it } from 'vitest'
import { findEditorKind, openableExtensions } from '../src/renderer/editors/registry'
import { sheetsEditorKinds } from '../src/renderer/editors/sheets'
import { provisionalSheetsKind } from '../src/renderer/editors/sheets/provisionalKind'
import { pinchZoomRatio } from '../src/renderer/editors/sheets/grid/pinchZoom'
import { FORMULA_KEYS } from '../src/renderer/editors/sheets/grid/FormulaKeyboardBar'

describe('the provisional spreadsheet kind', () => {
  it('is the one kind of track T1 and opens .xlsx, .xlsm, .xls and .csv', () => {
    expect(sheetsEditorKinds).toEqual([provisionalSheetsKind])
    expect(findEditorKind('xlsx')).toBe(provisionalSheetsKind)
    expect(findEditorKind('xlsm')).toBe(provisionalSheetsKind)
    expect(findEditorKind('xls')).toBe(provisionalSheetsKind)
    // CSV opens through the gateway's CSV import (XLS-T3)
    expect(findEditorKind('csv')).toBe(provisionalSheetsKind)
  })

  it('adds its extensions to the picker and the open gate after the base kinds', () => {
    const exts = openableExtensions()
    expect(exts.slice(0, 5)).toEqual(['hwp', 'hwpx', 'md', 'markdown', 'txt'])
    expect(exts).toEqual(expect.arrayContaining(['xlsx', 'xlsm', 'xls', 'csv']))
  })

  it('opens view-first with AI hidden, and creates no new documents', () => {
    expect(provisionalSheetsKind.id).toBe('sheets')
    expect(provisionalSheetsKind.hasAi).toBe(false)
    expect(provisionalSheetsKind.createFormats).toBeUndefined()
    expect(provisionalSheetsKind.recoveryFormat('xls')).toBe('xlsx')
  })
})

describe('the grid helpers', () => {
  it('scales the zoom by how far the fingers spread, inside Univer bounds', () => {
    expect(pinchZoomRatio(1, 100, 200)).toBe(2)
    expect(pinchZoomRatio(1, 200, 100)).toBe(0.5)
    expect(pinchZoomRatio(2, 100, 400)).toBe(4)
    expect(pinchZoomRatio(0.2, 300, 10)).toBe(0.1)
    expect(pinchZoomRatio(1.3, 0, 50)).toBe(1.3)
  })

  it('has the keyboard bar keys of design system 5.6', () => {
    expect(FORMULA_KEYS.map((key) => key.text)).toEqual(['=', '=SUM()', '()', ',', ':', '$'])
    // the caret lands inside the parentheses
    expect(FORMULA_KEYS.find((key) => key.id === 'sum')?.caretBack).toBe(1)
  })
})
