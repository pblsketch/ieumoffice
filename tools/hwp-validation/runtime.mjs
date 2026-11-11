import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const require = createRequire(join(root, 'package.json'))

export function engineIdentity(expectedVersion) {
  const meta = JSON.parse(readFileSync(join(root, 'vendor/rhwp-core/package.json'), 'utf8'))
  const wasm = readFileSync(join(root, 'vendor/rhwp-core/rhwp_bg.wasm'))
  if (!expectedVersion || meta.version !== expectedVersion) throw Error('ENGINE_VERSION_MISMATCH')
  const wasmSha256 = hash(wasm)
  if (wasmSha256 !== meta.rhwp.wasmSha256) throw Error('ENGINE_HASH_MISMATCH')
  return { version: meta.version, wasmSha256, wasm }
}

export async function loadEngine(identity) {
  const { default: init, HwpDocument } = await import(
    pathToFileURL(join(root, 'vendor/rhwp-core/rhwp.js')).href
  )
  await init({ module_or_path: identity.wasm })
  return HwpDocument
}

// Bundle the existing host helpers, including their imports, without rebuilding Rust/studio.
// The artifact lives beside private reports; it contains no document input.
export function loadSaveHelpers(output) {
  const { buildSync } = require('esbuild')
  const outfile = join(output, 'host-save-helpers.cjs')
  buildSync({
    stdin: {
      contents: [
        "export { applySaveFixes } from './apps/hwp/src/main/save-fixes.ts';",
        "export { sectionTailsOf } from './apps/hwp/src/main/section-tails.ts';",
        "export { fieldKindsOf } from './apps/hwp/src/main/field-kinds.ts';",
        "export { newTabsOf } from './apps/hwp/src/main/tab-widths.ts';",
        "export { bytesMatchFormat } from './apps/hwp/src/main/save-plan.ts';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return { helpers: require(outfile), sha256: hash(readFileSync(outfile)) }
}
