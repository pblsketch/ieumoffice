/**
 * Rebuilds vendor/rhwp-core: the rhwp engine (`@rhwp/core`) at the pinned tag
 * with the layout patches in vendor/rhwp-core/patches (decision 0050).
 *
 *   node tools/build-rhwp-core.mjs [--keep]
 *
 * Fetches the tag into node_modules/.cache/rhwp-core (without the multi-GB
 * sample documents), checks the commit, applies the patches in order, builds
 * with `wasm-pack build --target web --release` and copies the package files
 * into vendor/rhwp-core, recording the WASM hash in its package.json.
 *
 * Needs git, rustup (the tag's rust-toolchain.toml selects the toolchain and
 * the wasm32 target) and wasm-pack. The app build itself never runs this.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'vendor', 'rhwp-core')
const MANIFEST = join(VENDOR, 'package.json')
const REPO = 'https://github.com/edwardkim/rhwp.git'
const PACKAGE_FILES = ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts']
const LICENSE_FILES = ['LICENSE', 'THIRD_PARTY_LICENSES.md']

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
// `branch` is set when the engine is pinned to a commit on an upstream branch
// ahead of a release; `tag` then only names that pin (the cache folder).
// `features`, when set, replaces the crate's default features (decision 0107: the PDF
// import upstream builds in by default stays out until upstream releases it).
const { tag, branch, commit, patches, features } = manifest.rhwp
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
  throw new Error('rhwp tag must be a single cache folder name')
}
const work = join(ROOT, 'node_modules', '.cache', 'rhwp-core', tag)
function assertSourceCachePath() {
  const cacheRoot = join(ROOT, 'node_modules', '.cache', 'rhwp-core')
  if (dirname(resolve(work)) !== resolve(cacheRoot))
    throw new Error('Invalid rhwp source cache path')
  let existing = work
  while (!existsSync(existing)) existing = dirname(existing)
  const inside = relative(realpathSync(ROOT), realpathSync(existing))
  if (
    inside === '..' ||
    inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(inside)
  ) {
    throw new Error('rhwp source cache must remain inside the checkout')
  }
}
// Compiler output changes thousands of files per build. Keep the default outside
// a synced checkout, while preserving the caller's explicit Cargo target setting.
const localCache =
  process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
const checkoutKey = createHash('sha256')
  .update(process.platform === 'win32' ? ROOT.replaceAll('\\', '/').toLowerCase() : ROOT)
  .digest('hex')
  .slice(0, 12)
const target = process.env.CARGO_TARGET_DIR
  ? resolve(work, process.env.CARGO_TARGET_DIR)
  : join(localCache, 'rhwp-dev-cache', checkoutKey, 'target')
if (process.argv.includes('--show-build-paths')) {
  console.log(JSON.stringify({ source: work, target, jobs: process.env.CARGO_BUILD_JOBS ?? '2' }))
  process.exit(0)
}

// Preparing a fresh engine and compiling it can consume several GiB. Fail
// before downloading or deleting the old source when the drive is already full.
const minimum = 4n * 1024n ** 3n
for (const directory of new Set([ROOT, target])) {
  let existing = directory
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) throw new Error(`Cannot check build drive: ${directory}`)
    existing = parent
  }
  const disk = statfsSync(existing, { bigint: true })
  const available = disk.bavail * disk.bsize
  if (available < minimum) {
    throw new Error(
      `rhwp build needs at least 4 GiB free on ${existing}; ${(Number(available) / 1024 ** 3).toFixed(2)} GiB available`,
    )
  }
}

function run(command, args, cwd, env = process.env) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, env, stdio: 'inherit' })
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim()
}

// A fresh checkout every time: patches apply to the pristine tag only.
assertSourceCachePath()
rmSync(work, { recursive: true, force: true })
mkdirSync(dirname(work), { recursive: true })
// LF checkout so the patches (and rustfmt-formatted sources) apply verbatim on Windows.
run(
  'git',
  [
    '-c',
    'core.autocrlf=false',
    'clone',
    '--filter=blob:none',
    ...(branch ? [] : ['--depth=1', '--single-branch']),
    '--no-checkout',
    '--branch',
    branch ?? tag,
    REPO,
    work,
  ],
  dirname(work),
)
git(['config', 'core.autocrlf', 'false'], work)
// Reference documents are not build inputs. Fetch selected fixtures explicitly;
// upstream's PDF reference corpus alone occupies over a GiB in the checkout.
git(['sparse-checkout', 'set', '--no-cone', '/*', '!/samples/', '!/mydocs/', '!/pdf/'], work)
git(['checkout', '--quiet', branch ? commit : tag], work)
const head = git(['rev-parse', 'HEAD'], work)
if (head !== commit) {
  throw new Error(`rhwp ${tag} resolved to ${head}, expected ${commit}`)
}
for (const patch of patches) {
  run('git', ['apply', '--whitespace=nowarn', join(VENDOR, 'patches', patch)], work)
}

// Keep a patched source tree for focused Rust tests without replacing shipped artifacts.
if (process.argv.includes('--prepare-only')) {
  console.log(`rhwp source prepared at ${work}; vendor artifacts were not replaced`)
  process.exit(0)
}

// Local paths would otherwise end up in the WASM (panic locations of the
// registry crates); map them to neutral prefixes as a CI build would have.
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const rustFlags =
  process.env.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
    : (process.env.RUSTFLAGS ?? '').split(/\s+/).filter(Boolean)
const env = {
  ...process.env,
  // Bound concurrent compiler processes on development PCs; an explicit caller
  // setting still takes precedence. This does not change the release profile.
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
  BINARYEN_CORES: process.env.BINARYEN_CORES ?? '2',
  CARGO_TARGET_DIR: target,
  // Cargo splits RUSTFLAGS by whitespace, including spaces inside a Windows path.
  CARGO_ENCODED_RUSTFLAGS: [
    ...rustFlags,
    `--remap-path-prefix=${cargoHome}=/cargo`,
    `--remap-path-prefix=${work}=/rhwp`,
  ].join('\x1f'),
}
const cargoFeatures = features
  ? ['--', '--locked', '--no-default-features', '--features', features.join(',')]
  : ['--', '--locked']
run('wasm-pack', ['build', '--target', 'web', '--release', ...cargoFeatures], work, env)

for (const file of PACKAGE_FILES) copyFileSync(join(work, 'pkg', file), join(VENDOR, file))
for (const file of LICENSE_FILES) copyFileSync(join(work, file), join(VENDOR, file))
const wasm = readFileSync(join(VENDOR, 'rhwp_bg.wasm'))
for (const leak of [homedir(), work]) {
  if (wasm.includes(Buffer.from(leak))) {
    throw new Error(`rhwp_bg.wasm still contains the local path ${leak}`)
  }
}
manifest.rhwp.wasmSha256 = createHash('sha256').update(wasm).digest('hex')
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`vendor/rhwp-core: built ${tag} + ${patches.length} patches (${wasm.length} bytes)`)

if (!process.argv.includes('--keep') && existsSync(work)) {
  assertSourceCachePath()
  rmSync(work, { recursive: true, force: true })
}
