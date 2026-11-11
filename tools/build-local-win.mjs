import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))
const { localBuildVersion } = require('./apps/shell/scripts/local-build-version.cjs')
const baseVersion = JSON.parse(
  readFileSync(resolve(root, 'apps/shell/package.json'), 'utf8'),
).version
const id = process.env.IEUM_LOCAL_BUILD_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, '')
const version = localBuildVersion(baseVersion, id)
const npmCli = process.env.npm_execpath
if (!npmCli || !existsSync(npmCli)) throw new Error('Run this tool with npm run dist:win:local')
if (process.argv.length > 2)
  throw new Error('Set IEUM_LOCAL_BUILD_ID to choose a local build identifier')
console.log(`Building local installer ${version}; publishing is disabled.`)
const result = spawnSync(
  process.execPath,
  [npmCli, 'run', 'dist:win', '--', '--', '--publish', 'never'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, IEUM_LOCAL_BUILD_ID: id } },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
