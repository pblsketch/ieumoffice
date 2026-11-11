/** Isolate retained chapter-model cost; this is not a GUI or Sumatra benchmark. */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const file = option('--file')
const out = option('--out')
if (!file || !out) throw new Error('Use --file <epub> --out <json> [--retain-clean-models]')
const retainClean = args.includes('--retain-clean-models')
const work = join(root, 'working_dir', 'performance')
await mkdir(work, { recursive: true })
const modulePath = join(
  work,
  retainClean ? 'epub-session-retained.cjs' : 'epub-session-bounded.cjs',
)
const sourcePath = join(root, 'apps/epub/src/main/book-session.ts')
const source = await readFile(sourcePath, 'utf8')
await build({
  absWorkingDir: root,
  stdin: {
    contents: "export {EpubBookSession} from './apps/epub/src/main/book-session.ts'",
    resolveDir: root,
    loader: 'ts',
  },
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
  plugins: retainClean
    ? [
        {
          name: 'retain-clean-model-counterfactual',
          setup(builder) {
            builder.onLoad({ filter: /book-session\.ts$/ }, async ({ path }) => {
              const code = await readFile(path, 'utf8')
              const count = 'const CLEAN_CHAPTER_LIMIT = 8'
              const bytes = 'const CLEAN_CHAPTER_BUDGET = 16 * 1024 * 1024'
              if (!code.includes(count) || !code.includes(bytes))
                throw new Error('Cache probe source no longer matches')
              return {
                contents: code
                  .replace(count, 'const CLEAN_CHAPTER_LIMIT = Infinity')
                  .replace(bytes, 'const CLEAN_CHAPTER_BUDGET = Infinity'),
                loader: 'ts',
                resolveDir: dirname(path),
              }
            })
          },
        },
      ]
    : [],
})
const { EpubBookSession } = createRequire(import.meta.url)(modulePath)
const cache = await mkdtemp(join(tmpdir(), 'ieum-epub-session-probe-'))
const before = await stat(file)
const started = performance.now()
const result = {
  kind: 'engine-only chapter-cache counterfactual',
  retainClean,
  sourceHash: createHash('sha256').update(source).digest('hex'),
  fileBytes: before.size,
  samples: [],
  digests: [],
  completed: false,
}
let session
let peakRssBytes = 0
const monitor = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 20)
function sample(phase) {
  const row = {
    phase,
    elapsedMs: Math.round(performance.now() - started),
    ...process.memoryUsage(),
  }
  if (session) {
    // Diagnostic introspection of the bundled session, never an application IPC.
    row.chapterModels = session.chapters.size
    row.cleanModels = session.cleanChapters.size
    row.estimatedCleanBytes = session.cleanChapterBytes
  }
  result.samples.push(row)
  console.log(
    JSON.stringify({
      phase,
      elapsedMs: row.elapsedMs,
      rssMiB: Math.round(row.rss / 1048576),
      heapMiB: Math.round(row.heapUsed / 1048576),
      chapterModels: row.chapterModels,
    }),
  )
}
try {
  const opened = await EpubBookSession.openFile(resolve(file), cache)
  if (!opened.ok) throw new Error(opened.reason)
  session = opened.session
  result.chapterCount = session.book.spine.items.length
  sample('opened')
  for (let sweep = 1; sweep <= 2; sweep++) {
    const digest = createHash('sha256')
    for (let index = 0; index < result.chapterCount; index++) {
      const chapter = await session.readChapter(index)
      if (!chapter.ok) throw new Error(`Chapter ${index} failed`)
      digest.update(JSON.stringify({ index, chapter }))
      if (index % 50 === 0) sample(`sweep-${sweep}-chapter-${index}`)
    }
    result.digests.push(digest.digest('hex'))
    await new Promise((done) => setTimeout(done, 3000))
    sample(`sweep-${sweep}-settled`)
  }
  result.completed = true
  // Optional post-timing attribution only; never compare this to ordinary app memory.
  if (args.includes('--collect-after') && typeof globalThis.gc === 'function') {
    globalThis.gc()
    sample('post-timing-forced-gc-diagnostic')
  }
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  clearInterval(monitor)
  result.peakRssBytes = peakRssBytes
  await session?.dispose()
  await rm(cache, { recursive: true, force: true })
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  await writeFile(resolve(out), JSON.stringify(result, null, 2), { flag: 'wx' })
}
