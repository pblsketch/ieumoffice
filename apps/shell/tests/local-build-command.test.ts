import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const scratch = mkdtempSync(join(tmpdir(), 'ieum-local-packaging-'))
const fakeNpm = join(scratch, 'npm-fixture.cjs')
const repo = resolve(import.meta.dirname, '../../..')
const sourceVersion = JSON.parse(
  readFileSync(join(repo, 'apps/shell/package.json'), 'utf8'),
).version
writeFileSync(
  fakeNpm,
  'console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),id:process.env.IEUM_LOCAL_BUILD_ID}));process.exit(Number(process.env.LOCAL_TEST_EXIT||0));\n',
)

afterAll(() => {
  if (
    dirname(resolve(scratch)) !== resolve(tmpdir()) ||
    !basename(scratch).startsWith('ieum-local-packaging-')
  ) {
    throw new Error('Refusing cleanup outside the test temporary directory')
  }
  rmSync(scratch, { recursive: true })
})

function run(args: string[] = [], id = 'check.1', exit = '0') {
  return spawnSync(process.execPath, [join(repo, 'tools/build-local-win.mjs'), ...args], {
    cwd: scratch,
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: fakeNpm, IEUM_LOCAL_BUILD_ID: id, LOCAL_TEST_EXIT: exit },
  })
}

describe('local Windows installer command', () => {
  it('builds from the source root and forces publishing off', () => {
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    const call = JSON.parse(result.stdout.split(/\r?\n/).find((line) => line.startsWith('{'))!)
    expect(call).toEqual({
      args: ['run', 'dist:win', '--', '--', '--publish', 'never'],
      cwd: repo,
      id: 'check.1',
    })
    expect(result.stdout).toContain(`${sourceVersion}+local.check.1`)
  })

  it('reports the real build failure instead of claiming success', () => {
    const result = run([], 'check.1', '9')
    expect(result.status, result.stderr).toBe(9)
  })

  it('rejects arguments that would override publishing', () => {
    const result = run(['--publish', 'always'])
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('"args"')
    expect(result.stderr).toContain('Set IEUM_LOCAL_BUILD_ID')
  })

  it('rejects an unsafe version before starting npm', () => {
    const result = run([], '../elsewhere')
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('"args"')
    expect(result.stderr).toContain('IEUM_LOCAL_BUILD_ID must contain')
  })
})
