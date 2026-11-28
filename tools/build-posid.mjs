#!/usr/bin/env node
/**
 * PosidOffice release build script.
 *
 *   node tools/build-posid.mjs [--version X.Y.Z] [--date YYYY-MM-DD]
 *                              [--target win|mac|linux|portable] [--no-dist]
 *   (--target portable builds a single no-install Windows .exe instead of the
 *   NSIS installer; settings still live in %APPDATA%\PosidOffice)
 *
 * - --version writes apps/shell/package.json's "version" before bundling. That
 *   is the exact string app.getVersion() returns, so it becomes the version
 *   shown in Help → About PosidOffice and embedded in the installer metadata.
 *   The change stays in the working tree (a real release bumps it anyway).
 * - --date is exported as GENOFFICE_BUILD_DATE; electron.vite.config.ts bakes
 *   it into __GENOFFICE_BUILD_DATE__, the second token of the About dialog's
 *   version line ("Version 0.12.4 · 2026-10-30"). Defaults to today.
 * - Steps: third-party notices → npm run build:all (every editor + CLI +
 *   shell bundle; electron-builder needs packages/cli/dist and each app's
 *   out/) → electron-builder (skipped with --no-dist for a quick bundle check).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shellDir = join(root, 'apps', 'shell')

function usage(exitCode) {
  console.log(
    'Usage: node tools/build-posid.mjs [--version X.Y.Z] [--date YYYY-MM-DD] ' +
      '[--target win|mac|linux|portable] [--no-dist]',
  )
  process.exit(exitCode)
}

const args = process.argv.slice(2)
let version = ''
let buildDate = ''
let target = process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'win'
let runDist = true
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--version') version = args[++i] ?? ''
  else if (arg === '--date') buildDate = args[++i] ?? ''
  else if (arg === '--target') target = args[++i] ?? ''
  else if (arg === '--no-dist') runDist = false
  else if (arg === '-h' || arg === '--help') usage(0)
  else {
    console.error(`unknown argument: ${arg}`)
    usage(1)
  }
}
if (!['win', 'mac', 'linux', 'portable'].includes(target)) {
  console.error(`--target must be win, mac, linux or portable (got "${target}")`)
  usage(1)
}
if (version && !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error(`--version must look like 1.2.3 or 1.2.3-beta.1 (got "${version}")`)
  usage(1)
}
if (buildDate && !/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) {
  console.error(`--date must be YYYY-MM-DD (got "${buildDate}")`)
  usage(1)
}
if (!buildDate) buildDate = new Date().toISOString().slice(0, 10)

if (version) {
  const pkgPath = join(shellDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  console.log(`version: ${pkg.version} -> ${version}`)
  pkg.version = version
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

const env = { ...process.env, GENOFFICE_BUILD_DATE: buildDate }
function run(command, extraArgs, cwd = shellDir) {
  console.log(`> ${command} ${extraArgs.join(' ')}`)
  const r = spawnSync(command, extraArgs, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log(`build date: ${buildDate}`)
run('npm', ['run', 'notices'])
// electron-builder extraResources require every editor's out/ bundle and
// packages/cli/dist/genoffice.cjs — build:all covers all of them
run('npm', ['run', 'build:all'], root)
// the Windows packages (installer and portable exe alike) expect the xlsx
// sidecar under the -gnu target dir; native:build (inside build:all) only
// produces target/release/
if (runDist && (target === 'win' || target === 'portable')) {
  run(
    'cargo',
    [
      'build',
      '--release',
      '--manifest-path',
      'native/xlsx-engine/Cargo.toml',
      '--config',
      'native/xlsx-engine/.cargo/config.toml',
      '--target',
      'x86_64-pc-windows-gnu',
    ],
    join(root, 'apps', 'sheets'),
  )
}
if (runDist) {
  if (target === 'portable') run('node', [join(root, 'tools', 'gen-portable-splash.mjs')], root)
  run('npx', [
    'electron-builder',
    ...(target === 'portable' ? ['--win', 'portable'] : [`--${target}`]),
  ])
}
console.log('done.')
