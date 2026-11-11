import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { localBuildVersion } = require('../scripts/local-build-version.cjs') as {
  localBuildVersion: (base: string, id?: string) => string
}
// Use the updater's actual comparison dependency to cover the reported regression.
const semver = require('semver') as { compare: (a: string, b: string) => number }

describe('personal build update precedence', () => {
  it('does not offer the same official release as an upgrade', () => {
    expect(semver.compare('0.12.12', '0.12.12-local.20261111.1')).toBeGreaterThan(0)
    const local = localBuildVersion('0.12.12', '20261111.2')
    expect(local).toBe('0.12.12+local.20261111.2')
    expect(semver.compare('0.12.12', local)).toBe(0)
    expect(semver.compare('0.12.13', local)).toBeGreaterThan(0)
  })

  it('preserves the official version when local packaging was not requested', () => {
    expect(localBuildVersion('0.12.12')).toBe('0.12.12')
  })

  it('preserves an existing prerelease and its update ordering', () => {
    const local = localBuildVersion('0.13.0-beta.1', 'check.1')
    expect(semver.compare(local, '0.13.0-beta.1')).toBe(0)
    expect(semver.compare('0.13.0', local)).toBeGreaterThan(0)
  })

  it('retains existing build metadata', () => {
    expect(semver.compare(localBuildVersion('0.12.12+ci.4', 'check.2'), '0.12.12')).toBe(0)
  })

  it.each(['', '../release', 'two words', 'a+b', 'a..b', 'x'.repeat(65)])(
    'rejects an unsafe or empty build identifier: %s',
    (id) => expect(() => localBuildVersion('0.12.12', id)).toThrow(),
  )

  it.each(['01.12.12', '0.12', '0.12.12-beta.01', 'not-a-version'])(
    'rejects an invalid base: %s',
    (base) => expect(() => localBuildVersion(base, 'check.1')).toThrow(),
  )
})
