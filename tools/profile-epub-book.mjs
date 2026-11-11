/** Profile real EPUB engine reads in an isolated Node process; never save the book. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { freemem } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => args[args.indexOf(key) + 1]
if (!args.includes('--file') || !args.includes('--out'))
  throw new Error('Pass --file <epub> --out <json> [--baseline]')
const baseline = args.includes('--baseline')
const file = resolve(option('--file'))
const out = resolve(option('--out'))
const directory = join(root, 'working_dir', 'performance')
await mkdir(directory, { recursive: true })
const modulePath = join(
  directory,
  baseline ? 'epub-session-baseline.cjs' : 'epub-session-current.cjs',
)
const sessionPath = 'apps/epub/src/main/book-session.ts'
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { EpubBookSession } from './${sessionPath}'; export { markBlocks } from './apps/epub/src/renderer/reader/chapter-html.ts'`,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
  plugins: baseline
    ? [
        {
          name: 'baseline-session',
          setup(builder) {
            builder.onLoad({ filter: /(?:book-session|chapter-html)\.ts$/ }, (input) => ({
              contents: execFileSync(
                'git',
                ['show', `HEAD:${relative(root, input.path).replaceAll('\\', '/')}`],
                { cwd: root, encoding: 'utf8' },
              ),
              loader: 'ts',
              resolveDir: dirname(input.path),
            }))
          },
        },
      ]
    : [],
})
const { EpubBookSession, markBlocks } = createRequire(import.meta.url)(modulePath)
const started = performance.now()
const before = await stat(file)
const samples = []
let peakRssBytes = 0
const sample = (phase, details = {}) => {
  const memory = process.memoryUsage()
  peakRssBytes = Math.max(peakRssBytes, memory.rss)
  const row = { phase, elapsedMs: Math.round(performance.now() - started), ...memory, ...details }
  samples.push(row)
  console.log(
    JSON.stringify({
      phase,
      elapsedMs: row.elapsedMs,
      rssMiB: Math.round(row.rss / 1048576),
      heapMiB: Math.round(row.heapUsed / 1048576),
      ...details,
    }),
  )
  if (memory.rss > 2.75 * 1073741824 || freemem() < 768 * 1048576)
    throw new Error('Memory budget reached')
}
const monitor = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 20)
const result = { baseline, fileBytes: before.size, samples }
try {
  sample('start')
  const bytes = await readFile(file)
  sample('file-read')
  const opened = await EpubBookSession.open(bytes)
  if (!opened.ok) throw new Error(`Book refused: ${opened.reason}`)
  const session = opened.session
  result.docHash = session.docHash
  result.chapters = session.book.spine.items.length
  result.images = session.book.manifest.filter((item) => item.mediaType.startsWith('image/')).length
  sample('opened', { chapters: result.chapters, images: result.images })
  let totalCharacters = 0
  let totalBlocks = 0
  let brokenChapters = 0
  let markupMs = 0
  let maxChapterCharacters = 0
  let maxChapterBlocks = 0
  const markupDigest = (await import('node:crypto')).createHash('sha256')
  for (let chapter = 0; chapter < result.chapters; chapter++) {
    const read = await session.readChapter(chapter)
    if (!read.ok) throw new Error('Chapter read failed')
    totalCharacters += read.source.length
    if (read.broken) brokenChapters++
    else {
      totalBlocks += read.blocks.length
      maxChapterBlocks = Math.max(maxChapterBlocks, read.blocks.length)
      const start = performance.now()
      const marked = markBlocks(read.source, read.blocks)
      markupMs += performance.now() - start
      markupDigest.update(marked)
    }
    maxChapterCharacters = Math.max(maxChapterCharacters, read.source.length)
    if (chapter === 0 || (chapter + 1) % 50 === 0) sample('chapter-read', { chapter: chapter + 1 })
  }
  sample('all-chapters', {
    totalCharacters,
    totalBlocks,
    brokenChapters,
    markupMs,
    maxChapterCharacters,
    maxChapterBlocks,
  })
  result.markupSha256 = markupDigest.digest('hex')
  const text = await session.readText()
  sample('all-text', { textCharacters: text.length })
  result.dirty = session.isDirty()
  const after = await stat(file)
  result.inputUnchanged = before.size === after.size && before.mtimeMs === after.mtimeMs
  result.completed = true
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  clearInterval(monitor)
  result.peakRssBytes = peakRssBytes
  await writeFile(out, JSON.stringify(result, null, 2))
}
