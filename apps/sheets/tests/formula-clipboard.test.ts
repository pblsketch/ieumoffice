import { describe, expect, it } from 'vitest'

import {
  a1FormulaToR1C1,
  decodeHtmlEntities,
  escapeHtmlAttr,
  extractExternalHtmlFormulas,
  r1c1FormulaToA1,
  resolveExternalFormulaAt,
  stripClipboardFormulaMarkers,
} from '../src/renderer/formula-clipboard'
import { pasteSpecialAvailability } from '../src/renderer/paste-special'

describe('HTML attribute escaping and marker stripping', () => {
  it('escapes and decodes HTML attribute characters cleanly', () => {
    const raw = '=IF(A1<>"a&b",1,2)\n'
    const escaped = escapeHtmlAttr(raw)
    expect(escaped).toBe('=IF(A1&lt;&gt;&quot;a&amp;b&quot;,1,2)&#10;')
    expect(decodeHtmlEntities(escaped)).toBe(raw)
  })

  it('strips _xlfn., _xlws., and _xlpm. outside strings, quoted sheets, and brackets', () => {
    expect(
      stripClipboardFormulaMarkers(
        '=_xlfn.LET(_xlpm.x,A1,_xlfn._xlws.FILTER(B1:B5,B1:B5>_xlpm.x))',
      ),
    ).toBe('=LET(x,A1,FILTER(B1:B5,B1:B5>x))')
    expect(
      stripClipboardFormulaMarkers('=CONCAT("_xlfn.XLOOKUP(",\'Data_xlfn.A\'!A1,Table1[_xlpm.k])'),
    ).toBe('=CONCAT("_xlfn.XLOOKUP(",\'Data_xlfn.A\'!A1,Table1[_xlpm.k])')
    expect(stripClipboardFormulaMarkers('=Budget_xlpm.Total+A1')).toBe('=Budget_xlpm.Total+A1')
  })
})

describe('a1FormulaToR1C1 and r1c1FormulaToA1', () => {
  it('converts relative, absolute, mixed, and range references both ways', () => {
    // Anchor at row 4, col 2 (C5)
    const a1 = '=SUM(A1:A4)+$B$2+B$1+$A5+C5'
    const r1c1 = a1FormulaToR1C1(a1, 4, 2)
    expect(r1c1).toBe('=SUM(R[-4]C[-2]:R[-1]C[-2])+R2C2+R1C[-1]+RC1+RC')
    // Pasting the R1C1 formula one row down and one column right (D6 -> row 5, col 3)
    expect(r1c1FormulaToA1(r1c1, 5, 3)).toBe('=SUM(B2:B5)+$B$2+C$1+$A6+D6')
  })

  it('handles Korean bare and quoted sheet names, whole rows, and whole columns', () => {
    // Anchor at row 1, col 1 (B2)
    const a1 = "=SUM(매출!A1:A5)+'2026 요약'!$B$1+SUM(B:C)+SUM(2:4)"
    const r1c1 = a1FormulaToR1C1(a1, 1, 1)
    expect(r1c1).toBe("=SUM(매출!R[-1]C[-1]:R[3]C[-1])+'2026 요약'!R1C2+SUM(C:C[1])+SUM(R:R[2])")
    // Re-anchor at row 2, col 2 (C3)
    expect(r1c1FormulaToA1(r1c1, 2, 2)).toBe("=SUM(매출!B2:B6)+'2026 요약'!$B$1+SUM(C:D)+SUM(3:5)")
  })

  it('leaves string literals, function names, lowercase params, and structured refs untouched', () => {
    const a1 = '=IF(A1="R1C1",LOG10(B1),SUM(Table1[Q1]))'
    const r1c1 = a1FormulaToR1C1(a1, 0, 2)
    expect(r1c1).toBe('=IF(RC[-2]="R1C1",LOG10(RC[-1]),SUM(Table1[Q1]))')
    expect(r1c1FormulaToA1(r1c1, 0, 2)).toBe(a1)
    // Lowercase LET/LAMBDA parameters named `rc` or `r1c1` are not R1C1 refs.
    expect(r1c1FormulaToA1('=LET(rc,R[-1]C,r1c1,rc*2,r1c1)', 2, 1)).toBe(
      '=LET(rc,B2,r1c1,rc*2,r1c1)',
    )
  })

  it('turns out-of-bounds R1C1 offsets into #REF!', () => {
    expect(r1c1FormulaToA1('=R[-5]C[0]+1', 1, 0)).toBe('=#REF!+1')
    expect(r1c1FormulaToA1('=매출!R[0]C[-3]', 0, 1)).toBe('=매출!#REF!')
  })
})

describe('extractExternalHtmlFormulas and resolveExternalFormulaAt', () => {
  it('parses Google Sheets data-sheets-formula R1C1 and resolves at destination', () => {
    const html = `<google-sheets-html-origin><style>td{color:#000}</style><table>
      <tr><td data-sheets-formula="=SUM(R[-2]C[0]:R[-1]C[0])">300</td><td>plain</td></tr>
      <tr><td data-sheets-formula="=IF(R[0]C[-1]&gt;0,&quot;ok&quot;,&quot;no&quot;)">ok</td></tr>
    </table>`
    const parsed = extractExternalHtmlFormulas(html)
    expect(parsed).not.toBeNull()
    expect(parsed?.rows).toBe(2)
    expect(parsed?.cols).toBe(2)
    expect(resolveExternalFormulaAt(parsed!, 0, 0, 5, 1, 5, 1)).toBe('=SUM(B4:B5)')
    expect(resolveExternalFormulaAt(parsed!, 0, 1, 5, 2, 5, 2)).toBeNull()
    expect(resolveExternalFormulaAt(parsed!, 1, 0, 6, 1, 6, 1)).toBe('=IF(A7>0,"ok","no")')
  })

  it('guards originless Excel x:fmla on default paste and preserves it on Paste Special -> Formulas', () => {
    const relativeHtml = `<!--StartFragment--><table>
      <tr><td x:fmla="=_xlfn.XLOOKUP(A1,B1:B5,C1:C5,&quot;없음&quot;)">10</td></tr>
    </table><!--EndFragment-->`
    const parsedRel = extractExternalHtmlFormulas(relativeHtml)
    expect(parsedRel).not.toBeNull()
    // Default Ctrl+V falls back to value for originless relative Excel refs
    // so pasting off-origin never silently points at the wrong cells.
    expect(resolveExternalFormulaAt(parsedRel!, 0, 0, 5, 3, 5, 3)).toBeNull()
    // Explicit Paste Special -> Formulas installs and shifts repeated tiles.
    expect(
      resolveExternalFormulaAt(parsedRel!, 0, 0, 2, 0, 2, 0, { allowOriginlessRelative: true }),
    ).toBe('=XLOOKUP(A1,B1:B5,C1:C5,"없음")')
    expect(
      resolveExternalFormulaAt(parsedRel!, 1, 0, 3, 0, 2, 0, { allowOriginlessRelative: true }),
    ).toBe('=XLOOKUP(A2,B2:B6,C2:C6,"없음")')

    // Originless absolute/constant Excel formulas ARE safe on default paste when sheets exist.
    const absHtml = `<table><tr><td x:fmla="=_xlfn.XLOOKUP($A$1,Sheet1!$B$1:$B$5,Sheet1!$C$1:$C$5)">10</td></tr></table>`
    const parsedAbs = extractExternalHtmlFormulas(absHtml)
    expect(
      resolveExternalFormulaAt(parsedAbs!, 0, 0, 5, 3, 5, 3, {
        availableSheetNames: new Set(['sheet1']),
      }),
    ).toBe('=XLOOKUP($A$1,Sheet1!$B$1:$B$5,Sheet1!$C$1:$C$5)')
    // Missing target sheet falls back to value instead of producing #REF!.
    expect(
      resolveExternalFormulaAt(parsedAbs!, 0, 0, 5, 3, 5, 3, {
        availableSheetNames: new Set(['other']),
      }),
    ).toBeNull()
  })

  it('parses cross-tab IeumOffice HTML with data-ieum-origin and shifts relative to source', () => {
    const html = `<google-sheets-html-origin><table data-copy-id="other-tab"><tbody>
      <tr><td x:fmla="=SUM(매출!A1:A3)+$B$1" data-sheets-formula="=SUM(매출!R[-3]C:R[-1]C)+R1C2" data-ieum-origin="3,0">60</td></tr>
    </tbody></table>`
    const parsed = extractExternalHtmlFormulas(html)
    expect(parsed).not.toBeNull()
    // Pasted at row 5, col 2 (+2 rows, +2 cols from origin 3,0)
    expect(resolveExternalFormulaAt(parsed!, 0, 0, 5, 2, 5, 2)).toBe('=SUM(매출!C3:C5)+$B$1')
  })

  it('respects rowspan and colspan occupancy when indexing formula cells', () => {
    const html = `<table>
      <tr><td rowspan="2">merged</td><td x:fmla="=A1*2">20</td></tr>
      <tr><td x:fmla="=A2*3">30</td></tr>
    </table>`
    const parsed = extractExternalHtmlFormulas(html)
    expect(parsed).not.toBeNull()
    expect(parsed?.cells.has('0:1')).toBe(true)
    // Row 1 col 0 is occupied by rowspan from (0,0), so the second formula lands at (1,1)
    expect(parsed?.cells.has('1:0')).toBe(false)
    expect(parsed?.cells.has('1:1')).toBe(true)
  })

  it('enables formulas in Paste Special availability when external HTML carries formulas', () => {
    const parsed = extractExternalHtmlFormulas('<table><tr><td x:fmla="=1+1">2</td></tr></table>')
    expect(parsed).not.toBeNull()
    const withFormulas = pasteSpecialAvailability({
      kind: 'text',
      rows: [['2']],
      formulas: parsed!,
    })
    expect(withFormulas.types.has('formulas')).toBe(true)
    const plainOnly = pasteSpecialAvailability({ kind: 'text', rows: [['2']] })
    expect(plainOnly.types.has('formulas')).toBe(false)
  })
})
