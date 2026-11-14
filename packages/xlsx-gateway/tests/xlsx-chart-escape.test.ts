import { describe, expect, it } from 'vitest'
import { applyChartEdit } from '../src/gateway/xlsx-chart'

const BAR_CHART =
  '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:chart>' +
  '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Old</a:t></a:r></a:p></c:rich></c:tx>' +
  '<c:overlay val="0"/></c:title>' +
  '<c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:cat/><c:val/></c:ser>' +
  '<c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx/><c:valAx/></c:plotArea>' +
  '</c:chart></c:chartSpace>'

describe('applyChartEdit title XML 1.0 defence', () => {
  it('strips illegal C0 controls from chart titles before escaping', () => {
    const xml = applyChartEdit(BAR_CHART, {
      chartPath: 'xl/charts/chart1.xml',
      title: 'Q1\u0001Revenue & <Growth>',
    })
    expect(xml).toContain('<a:t>Q1Revenue &amp; &lt;Growth&gt;</a:t>')
    expect(xml).not.toContain('\u0001')
    // eslint-disable-next-line no-control-regex -- the forbidden chars are the subject
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false)
  })

  it('keeps tab, LF and CR in chart titles', () => {
    const xml = applyChartEdit(BAR_CHART, {
      chartPath: 'xl/charts/chart1.xml',
      title: 'a\tb\nc\rd',
    })
    expect(xml).toContain('<a:t>a\tb\nc\rd</a:t>')
  })

  // buildSeriesReplacement: category caches rebuilt from cell values are the
  // more likely route for control characters to reach chart XML, since those
  // strings come straight from the sheet rather than a typed chart title
  it('strips illegal controls from a rebuilt series name and category cache', () => {
    const xml = applyChartEdit(BAR_CHART, {
      chartPath: 'xl/charts/chart1.xml',
      seriesSet: [
        {
          name: 'Q1\u0001Revenue',
          categories: ['Jan\u0001', 'Feb￾', 'Mar\uD840'],
          values: [1, 2, 3],
        },
      ],
    })
    expect(xml).toContain('<c:tx><c:v>Q1Revenue</c:v></c:tx>')
    expect(xml).toContain('<c:v>Jan</c:v>')
    expect(xml).toContain('<c:v>Feb</c:v>')
    expect(xml).toContain('<c:v>Mar</c:v>')
    // eslint-disable-next-line no-control-regex -- the forbidden chars are the subject
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false)
    expect(xml).not.toContain('￾')
    expect(xml).not.toContain('\uD840')
  })
})
