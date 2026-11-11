/** Profile immutable-file EPUB opening stages, without editing or AI. */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const file = option('--file')
const out = option('--out')
if (!file || !out) throw new Error('Use --file <epub> --out <json> [--input-kib 64|1024]')
const inputKiB = Number(option('--input-kib') ?? '1024')
if (![64, 1024].includes(inputKiB)) throw new Error('Invalid input chunk size')
const work = join(root, 'working_dir', 'performance')
await mkdir(work, { recursive: true })
const modulePath = join(work, 'epub-source.cjs')
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { snapshotBookFile } from './apps/epub/src/main/book-file.ts';
    export { openEpubSource } from './packages/epub-engine/src/core.ts'`,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
  plugins:
    inputKiB === 64
      ? [
          {
            name: 'old-input-chunk',
            setup(builder) {
              builder.onLoad({ filter: /zip-gate[\\/]src[\\/]source\.ts$/ }, async ({ path }) => {
                const code = await readFile(path, 'utf8')
                const before = 'Math.min(1024 * 1024, part.csize - offset)'
                if (!code.includes(before)) throw new Error('Input chunk probe no longer matches')
                return {
                  contents: code.replace(before, 'Math.min(64 * 1024, part.csize - offset)'),
                  loader: 'ts',
                  resolveDir: dirname(path),
                }
              })
            },
          },
        ]
      : [],
})
const { snapshotBookFile, openEpubSource } = createRequire(import.meta.url)(modulePath)
const cache = await mkdtemp(join(tmpdir(), 'ieum-epub-source-'))
const before = await stat(file)
const started = performance.now()
const result = { fileBytes: before.size, inputKiB, samples: [] }
let source
let peakRssBytes = 0
const sample = (phase) => {
  const row = {
    phase,
    elapsedMs: Math.round(performance.now() - started),
    ...process.memoryUsage(),
  }
  result.samples.push(row)
  console.log(
    JSON.stringify({ phase, elapsedMs: row.elapsedMs, rssMiB: Math.round(row.rss / 1048576) }),
  )
}
const monitor = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 20)
try {
  sample('start')
  source = await snapshotBookFile(file, cache)
  sample('snapshot')
  const opened = await openEpubSource(source)
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail}`)
  sample('validated-and-opened')
  result.docHash = await source.docHash()
  sample('hashed')
  result.chapters = opened.book.spine.items.length
  const first = await opened.book.readText(opened.book.spine.items[0].path)
  result.firstChapterCharacters = first?.text.length
  sample('first-chapter')
  result.completed = true
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  clearInterval(monitor)
  await source?.close()
  await rm(cache, { recursive: true, force: true })
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  result.peakRssBytes = peakRssBytes
  await writeFile(resolve(out), JSON.stringify(result, null, 2))
}
