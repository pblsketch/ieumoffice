/** Compare a glyph-paint correction against a previous engine without changing inputs. */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const before = option('--before')
const output = option('--out')
if (!before || !output)
  throw new Error(
    'Use --before <previous engine directory> --out <report.json> [--extra-dir <fixtures>] [--file <reference>]',
  )
const digest = (value) => createHash('sha256').update(value).digest('hex')

async function engine(directory) {
  const mod = await import(pathToFileURL(join(directory, 'rhwp.js')).href)
  const wasm = await readFile(join(directory, 'rhwp_bg.wasm'))
  await mod.default({ module_or_path: wasm })
  return { Document: mod.HwpDocument, wasmSha256: digest(wasm) }
}

const baseline = await engine(resolve(before))
const candidate = await engine(join(root, 'vendor/rhwp-core'))
const files = []
for (const directory of [join(root, 'apps/hwp/tests/fixtures'), option('--extra-dir')].filter(
  Boolean,
)) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isFile() && /\.(hwp|hwpx)$/i.test(item.name)) files.push(resolve(directory, item.name))
  }
}
if (option('--file')) files.push(resolve(option('--file')))
const result = {
  before: baseline.wasmSha256,
  after: candidate.wasmSha256,
  completed: false,
  files: [],
}

for (const file of [...new Set(files)].sort()) {
  const initial = await stat(file)
  const bytes = new Uint8Array(await readFile(file))
  const entry = { file, sha256: digest(bytes), generations: [] }
  try {
    for (const compat of [false, true]) {
      const a = new baseline.Document(bytes)
      const b = new candidate.Document(bytes)
      try {
        a.setHangul2024Compat(compat)
        b.setHangul2024Compat(compat)
        const count = a.pageCount()
        if (count !== b.pageCount()) throw new Error('Page count changed')
        if (a.getPageCaretStarts() !== b.getPageCaretStarts())
          throw new Error('Page caret starts changed')
        const savedA = { hwp: digest(a.exportHwp()), hwpx: digest(a.exportHwpx()) }
        const savedB = { hwp: digest(b.exportHwp()), hwpx: digest(b.exportHwpx()) }
        if (JSON.stringify(savedA) !== JSON.stringify(savedB))
          throw new Error('Export bytes changed')
        const changes = []
        for (let page = 0; page < count; page++) {
          if (a.getPageRenderTree(page) !== b.getPageRenderTree(page))
            throw new Error(`Page ${page + 1} render geometry changed`)
          for (const profile of ['screen', 'print']) {
            if (
              a.getPageLayerTreeWithProfile(page, profile) !==
              b.getPageLayerTreeWithProfile(page, profile)
            )
              throw new Error(`Page ${page + 1} ${profile} source paint tree changed`)
            const oldSvg = a.renderPageSvgWithProfile(page, profile)
            const newSvg = b.renderPageSvgWithProfile(page, profile)
            if (oldSvg === newSvg) continue
            // This batch may change intrinsic glyph widths only. Preserve origins,
            // transforms, decoration, objects, colors, ownership and all source text.
            const stripFit = (svg) => svg.replace(/textLength="[^"]*"/g, 'textLength="<glyph-fit>"')
            if (stripFit(oldSvg) !== stripFit(newSvg))
              throw new Error(`Page ${page + 1} ${profile} paint changed beyond glyph widths`)
            changes.push({ page: page + 1, profile })
          }
        }
        if (digest(b.exportHwp()) !== savedB.hwp || digest(b.exportHwpx()) !== savedB.hwpx)
          throw new Error('Painting mutated exported source bytes')
        entry.generations.push({
          compat2024: compat,
          pages: count,
          changedGlyphPages: changes,
          exports: savedB,
        })
      } finally {
        a.free()
        b.free()
      }
    }
    const final = await stat(file)
    entry.inputUnchanged =
      initial.size === final.size &&
      initial.mtimeMs === final.mtimeMs &&
      digest(await readFile(file)) === entry.sha256
    if (!entry.inputUnchanged) throw new Error('Input changed during validation')
    entry.ok = true
  } catch (error) {
    entry.ok = false
    entry.failure = String(error)
  }
  result.files.push(entry)
}
result.completed = result.files.length > 0 && result.files.every((entry) => entry.ok)
await writeFile(resolve(output), JSON.stringify(result, null, 2))
console.log(
  JSON.stringify({
    completed: result.completed,
    files: result.files.length,
    failures: result.files
      .filter((entry) => !entry.ok)
      .map(({ file, failure }) => ({ file, failure })),
  }),
)
if (!result.completed) process.exitCode = 1
