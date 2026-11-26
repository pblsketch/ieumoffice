// "Open with" for spreadsheets: the four formats are declared under the T1
// markers (Android VIEW and SEND, iOS document types and imported types).
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const NATIVE_CONFIG = resolve(__dirname, '..', 'native-config')
const ANDROID = readFileSync(join(NATIVE_CONFIG, 'android', 'intent-filters-fragment.xml'), 'utf8')
const IOS = readFileSync(join(NATIVE_CONFIG, 'ios', 'Info-fragment.plist'), 'utf8')

const MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'text/csv',
]

/** The lines after `marker` up to the next blank line. */
function sections(text: string, marker: string): string[] {
  return text
    .split(marker)
    .slice(1)
    .map((rest) => rest.split(/\r?\n\s*\r?\n/)[0] ?? '')
}

describe('spreadsheet "open with" declarations', () => {
  it('lists the spreadsheet MIME types in both Android filters (VIEW and SEND)', () => {
    const t1 = sections(ANDROID, '<!-- T1 sheets MIME types -->')
    expect(t1).toHaveLength(2)
    for (const section of t1) {
      for (const mime of MIME_TYPES) expect(section).toContain(`android:mimeType="${mime}"`)
    }
  })

  it('declares the four document types on iOS, with the .xlsm type imported', () => {
    const [documents] = sections(IOS, '<!-- T1 sheets document types -->')
    for (const uti of [
      'org.openxmlformats.spreadsheetml.sheet',
      'org.openxmlformats.spreadsheetml.sheet.macroenabled',
      'com.microsoft.excel.xls',
      'public.comma-separated-values-text',
    ]) {
      expect(documents).toContain(`<string>${uti}</string>`)
    }
    const [imported] = sections(IOS, '<!-- T1 sheets imported types -->')
    expect(imported).toContain(
      '<string>org.openxmlformats.spreadsheetml.sheet.macroenabled</string>',
    )
    expect(imported).toContain('<string>xlsm</string>')
  })
})
