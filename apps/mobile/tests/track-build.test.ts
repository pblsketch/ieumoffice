import { describe, expect, it } from 'vitest'
import { trackAlias, trackDefine, trackPlugins, trackTestSetupFiles } from '../config/tracks'
import { aiBuild } from '../config/tracks/ai'
import { homeBuild } from '../config/tracks/home'
import { pdfBuild } from '../config/tracks/pdf'
import { pdfToolsBuild } from '../config/tracks/pdfTools'
import { readersBuild } from '../config/tracks/readers'
import { sheetsBuild } from '../config/tracks/sheets'
import { webBuild } from '../config/tracks/web'

// The merged build settings carry every track's own file; tracks fill their file, never this list.
const TRACKS = [sheetsBuild, pdfBuild, pdfToolsBuild, webBuild, readersBuild, homeBuild, aiBuild]

describe('per-track build settings', () => {
  it('merges every track file into the bundle and test settings', () => {
    expect(trackPlugins).toHaveLength(TRACKS.reduce((n, t) => n + (t.plugins?.length ?? 0), 0))
    expect(trackTestSetupFiles).toEqual(TRACKS.flatMap((t) => [...(t.testSetupFiles ?? [])]))
    for (const track of TRACKS) {
      for (const [from, to] of Object.entries(track.alias ?? {})) expect(trackAlias[from]).toBe(to)
      for (const [name, value] of Object.entries(track.define ?? {})) {
        expect(trackDefine[name]).toBe(value)
      }
    }
  })

  it('lets no two tracks claim the same alias or constant', () => {
    const aliases = TRACKS.flatMap((t) => Object.keys(t.alias ?? {}))
    const defines = TRACKS.flatMap((t) => Object.keys(t.define ?? {}))
    expect(new Set(aliases).size).toBe(aliases.length)
    expect(new Set(defines).size).toBe(defines.length)
  })
})
