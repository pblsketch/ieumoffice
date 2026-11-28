import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs build script without type declarations
import { isRuntimeFile } from '../collect-deps.mjs'

// The packaged app ships jsdom's tree beside the CLI bundle; files no runtime
// reads are left out to keep the installer's file count down (decision 0166).
describe('collect-deps: files the packaged CLI ships', () => {
  it('keeps code, data and stylesheets', () => {
    for (const name of [
      'index.js',
      'index.cjs',
      'index.mjs',
      'package.json',
      'default-stylesheet.css',
      'xhr-sync-worker.js',
      'data.json',
    ])
      expect(isRuntimeFile(name), name).toBe(true)
  })

  it('leaves out declarations, source maps, build caches and docs', () => {
    for (const name of [
      'index.d.ts',
      'index.d.cts',
      'index.d.mts',
      'index.js.map',
      'tsconfig.tsbuildinfo',
      'README.md',
      'CHANGELOG.md',
      'readme.markdown',
      'History.mdown',
      '.gitkeep',
    ])
      expect(isRuntimeFile(name), name).toBe(false)
  })

  it('keeps every license and notice text whatever its extension', () => {
    for (const name of [
      'LICENSE',
      'LICENSE.md',
      'license.md',
      'LICENCE.md',
      'NOTICE.md',
      'COPYING',
      'PATENTS.md',
    ])
      expect(isRuntimeFile(name), name).toBe(true)
  })
})
