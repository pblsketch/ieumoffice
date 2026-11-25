import { describe, expect, it } from 'vitest'
import { applyAndroidConfig, applyIosConfig } from '../scripts/apply-native-config.mjs'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The per-track slots in the "open with other apps" declarations. Each editor track adds its own
// lines directly under its own marker, so parallel tracks never edit the same lines.
const TRACKS = ['T1 sheets', 'T2 pdf', 'T4 html', 'T5 readers']
const ANDROID_MARKERS = TRACKS.map((t) => `<!-- ${t} MIME types -->`)
const IOS_DOCUMENT_MARKERS = TRACKS.map((t) => `<!-- ${t} document types -->`)
const IOS_IMPORTED_MARKERS = TRACKS.map((t) => `<!-- ${t} imported types -->`)

// The formats declared before any track adds its own. They stay first and unchanged; a track adds
// its own formats only below its marker, so this test never needs a track's edit.
const BASE_MIME_TYPES = [
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/hwp+zip',
  'application/vnd.hancom.hwpx',
  'text/markdown',
  'text/plain',
  'application/octet-stream',
]
const BASE_ITEM_CONTENT_TYPES = [
  'com.hancom.hwp',
  'com.hancom.hwpx',
  'net.daringfireball.markdown',
  'public.plain-text',
]
const BASE_UT_TYPE_IDS = ['com.hancom.hwp', 'com.hancom.hwpx']

const NATIVE_CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native-config')
const ANDROID_FRAGMENT = readFileSync(
  join(NATIVE_CONFIG, 'android', 'intent-filters-fragment.xml'),
  'utf8',
)
const IOS_FRAGMENT = readFileSync(join(NATIVE_CONFIG, 'ios', 'Info-fragment.plist'), 'utf8')

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// The `android:mimeType` values of each <intent-filter> that declares any.
function mimeTypesPerFilter(xml: string): string[][] {
  const filters = xml.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? []
  return filters
    .map((f) => [...f.matchAll(/android:mimeType="([^"]*)"/g)].map((m) => m[1]))
    .filter((types) => types.length > 0)
}

// The strings of every <array> that follows `<key>name</key>`.
function arrayStringsAfterKey(plist: string, name: string): string[] {
  const re = new RegExp(`<key>${name}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g')
  return [...plist.matchAll(re)].flatMap((m) =>
    [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((s) => s[1]),
  )
}

// The single <string> that follows each `<key>name</key>`.
function stringsAfterKey(plist: string, name: string): string[] {
  const re = new RegExp(`<key>${name}</key>\\s*<string>([^<]*)</string>`, 'g')
  return [...plist.matchAll(re)].map((m) => m[1])
}

// The text between `<key>name</key>`'s <array> and its matching </array>, for top-level arrays
// whose children are <dict>s (nested arrays are skipped by depth counting).
function topArrayBody(plist: string, name: string): string {
  const open = new RegExp(`<key>${name}</key>\\s*<array>`).exec(plist)
  if (!open) throw new Error(`no <array> after <key>${name}</key>`)
  const start = open.index + open[0].length
  const tag = /<(\/?)array>/g
  tag.lastIndex = start
  let depth = 1
  for (let m = tag.exec(plist); m; m = tag.exec(plist)) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return plist.slice(start, m.index)
  }
  throw new Error(`unclosed <array> after <key>${name}</key>`)
}

function expectAndroidSlots(xml: string): void {
  for (const marker of ANDROID_MARKERS) {
    // Once in the VIEW/EDIT filter and once in the SEND filter.
    expect(count(xml, marker)).toBe(2)
  }
  const perFilter = mimeTypesPerFilter(xml)
  expect(perFilter).toHaveLength(2)
  for (const types of perFilter) {
    expect(types.slice(0, BASE_MIME_TYPES.length)).toEqual(BASE_MIME_TYPES)
  }
  for (const type of BASE_MIME_TYPES) {
    expect(xml).toContain(`<data android:mimeType="${type}" />`)
  }
  // The markers sit inside each filter, after its base formats; anything beyond the base set
  // sits below the first marker (a track's slot), never among the base lines.
  const filters = xml.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? []
  const withMime = filters.filter((f) => f.includes('android:mimeType'))
  for (const filter of withMime) {
    const lastBase = filter.indexOf(
      `<data android:mimeType="${BASE_MIME_TYPES[BASE_MIME_TYPES.length - 1]}" />`,
    )
    const firstMarker = filter.indexOf(ANDROID_MARKERS[0])
    for (const marker of ANDROID_MARKERS) {
      expect(filter.indexOf(marker)).toBeGreaterThan(lastBase)
    }
    for (const m of filter.matchAll(/android:mimeType="([^"]*)"/g)) {
      if (!BASE_MIME_TYPES.includes(m[1])) expect(m.index).toBeGreaterThan(firstMarker)
    }
  }
}

function expectIosSlots(plist: string): void {
  const documentTypes = topArrayBody(plist, 'CFBundleDocumentTypes')
  const importedTypes = topArrayBody(plist, 'UTImportedTypeDeclarations')
  // The markers follow the last base entry of each array; tracks add their dicts below them.
  const lastBaseDocument = documentTypes.indexOf(
    `<string>${BASE_ITEM_CONTENT_TYPES[BASE_ITEM_CONTENT_TYPES.length - 1]}</string>`,
  )
  const lastBaseImported = importedTypes.indexOf(
    `<string>${BASE_UT_TYPE_IDS[BASE_UT_TYPE_IDS.length - 1]}</string>`,
  )
  for (const marker of IOS_DOCUMENT_MARKERS) {
    expect(count(plist, marker)).toBe(1)
    expect(documentTypes.indexOf(marker)).toBeGreaterThan(lastBaseDocument)
  }
  for (const marker of IOS_IMPORTED_MARKERS) {
    expect(count(plist, marker)).toBe(1)
    expect(importedTypes.indexOf(marker)).toBeGreaterThan(lastBaseImported)
  }
  expect(
    arrayStringsAfterKey(plist, 'LSItemContentTypes').slice(0, BASE_ITEM_CONTENT_TYPES.length),
  ).toEqual(BASE_ITEM_CONTENT_TYPES)
  expect(stringsAfterKey(plist, 'UTTypeIdentifier').slice(0, BASE_UT_TYPE_IDS.length)).toEqual(
    BASE_UT_TYPE_IDS,
  )
}

describe('per-track slots in the open-with declarations', () => {
  it('the fragments carry every marker, with the base formats first', () => {
    expectAndroidSlots(ANDROID_FRAGMENT)
    expectIosSlots(IOS_FRAGMENT)
  })

  it('apply-native-config keeps the markers and the base formats in the generated files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ieum-native-slots-'))
    try {
      const androidApp = join(tmp, 'android', 'app')
      const androidMain = join(androidApp, 'src', 'main')
      mkdirSync(androidMain, { recursive: true })
      writeFileSync(
        join(androidMain, 'AndroidManifest.xml'),
        '<manifest><application><activity android:name=".MainActivity"></activity></application></manifest>',
        'utf8',
      )
      const iosApp = join(tmp, 'apple', 'ieumoffice-mobile_iOS')
      mkdirSync(iosApp, { recursive: true })
      writeFileSync(
        join(iosApp, 'Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict>\n  <key>CFBundleName</key>\n  <string>IeumOffice</string>\n</dict>\n</plist>',
        'utf8',
      )

      // Applied twice: re-running the script must not duplicate the slots.
      expect(applyAndroidConfig(tmp).applied).toBe(true)
      expect(applyAndroidConfig(tmp).applied).toBe(true)
      expect(applyIosConfig(tmp).applied).toBe(true)
      expect(applyIosConfig(tmp).applied).toBe(true)

      const manifest = readFileSync(join(androidMain, 'AndroidManifest.xml'), 'utf8')
      expectAndroidSlots(manifest)
      const plist = readFileSync(join(iosApp, 'Info.plist'), 'utf8')
      expectIosSlots(plist)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
