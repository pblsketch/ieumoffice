import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  describeExtraRoot,
  describeSystemRoot,
  discoverLocalDriveRoots,
  readExtraRoots,
  withExtraRoot,
  withoutExtraRoot,
} from '../src/main/folder-roots'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folder-roots-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readExtraRoots', () => {
  it('keeps absolute string entries once, dropping the default save folder', () => {
    const roots = readExtraRoots(
      { folderRoots: ['/a/b', '/a/b/', 'relative', 7, '/a/b/../b', '/save', '/c'] },
      '/save',
    )
    expect(roots).toEqual(['/a/b', '/c'])
  })

  it('tolerates a missing or malformed setting', () => {
    expect(readExtraRoots({}, '/save')).toEqual([])
    expect(readExtraRoots({ folderRoots: 'nope' }, '/save')).toEqual([])
  })
})

describe('withExtraRoot / withoutExtraRoot', () => {
  it('appends a new folder and refuses one that is already a root', () => {
    expect(withExtraRoot(['/a'], '/save', '/b')).toEqual(['/a', '/b'])
    expect(withExtraRoot(['/a'], '/save', '/a/')).toBeNull()
    expect(withExtraRoot(['/a'], '/save', '/save')).toBeNull()
  })

  it('removes by resolved path only', () => {
    expect(withoutExtraRoot(['/a', '/b'], '/a/')).toEqual(['/b'])
    expect(withoutExtraRoot(['/a', '/b'], '/a/b')).toEqual(['/a', '/b'])
  })
})

describe('describeExtraRoot', () => {
  it('reports a writable folder usable and removable without creating anything', () => {
    const missing = join(dir, 'missing')
    expect(describeExtraRoot(missing)).toEqual({
      path: missing,
      name: 'missing',
      usable: false,
      readable: false,
      removable: true,
    })
    expect(describeExtraRoot(dir)).toMatchObject({ usable: true, readable: true, removable: true })
  })

  it('a file or a read-only folder is not usable; the read-only folder still lists', () => {
    const file = join(dir, 'f.txt')
    writeFileSync(file, 'x')
    expect(describeExtraRoot(file)).toMatchObject({ usable: false, readable: false })
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const ro = join(dir, 'ro')
    mkdirSync(ro)
    chmodSync(ro, 0o555)
    try {
      expect(describeExtraRoot(ro)).toMatchObject({ usable: false, readable: true })
    } finally {
      chmodSync(ro, 0o755)
    }
  })

  it('describeSystemRoot tags OS locations as non-removable with their Explorer role', () => {
    expect(describeSystemRoot(join(dir, 'missing'), 'desktop')).toBeNull()
    expect(describeSystemRoot(dir, 'desktop', 'Desktop')).toEqual({
      path: dir,
      name: 'Desktop',
      usable: true,
      readable: true,
      removable: false,
      kind: 'desktop',
    })
  })

  it('discoverLocalDriveRoots returns empty on non-Windows platforms', () => {
    expect(discoverLocalDriveRoots('linux')).toEqual([])
    expect(discoverLocalDriveRoots('darwin')).toEqual([])
  })
})
