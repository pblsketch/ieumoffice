// Every track's build settings, merged for vite.config.ts and vitest.config.ts. This list is complete;
// tracks change only their own file.
import type { Plugin } from 'vite'
import { aiBuild } from './ai'
import { homeBuild } from './home'
import { pdfBuild } from './pdf'
import { pdfToolsBuild } from './pdfTools'
import { readersBuild } from './readers'
import { sheetsBuild } from './sheets'
import type { TrackBuild } from './types'
import { webBuild } from './web'

const TRACKS: readonly TrackBuild[] = [
  sheetsBuild,
  pdfBuild,
  pdfToolsBuild,
  webBuild,
  readersBuild,
  homeBuild,
  aiBuild,
]

export const trackPlugins: Plugin[] = TRACKS.flatMap((track) => [...(track.plugins ?? [])])
export const trackWorkerPlugins = (): Plugin[] =>
  TRACKS.flatMap((track) => [...(track.workerPlugins?.() ?? [])])
export const trackAlias: Record<string, string> = Object.assign(
  {},
  ...TRACKS.map((track) => track.alias ?? {}),
)
export const trackDefine: Record<string, string> = Object.assign(
  {},
  ...TRACKS.map((track) => track.define ?? {}),
)
export const trackTestSetupFiles: string[] = TRACKS.flatMap((track) => [
  ...(track.testSetupFiles ?? []),
])
