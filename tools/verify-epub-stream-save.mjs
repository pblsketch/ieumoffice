/** One batch correctness/allocation diagnostic; not an app/Sumatra benchmark. */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const file = option('--file')
const out = option('--out')
if (!file || !out) throw new Error('Use --file <read-only EPUB> --out <private result JSON>')
const work = join(root, 'working_dir', 'performance')
await mkdir(work, { recursive: true })
const modulePath = join(work, 'epub-stream-save.cjs')
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export {openEpubSource, prepareEpubSave} from './packages/epub-engine/src/core.ts';
    export {createBookFile, publishBookFile} from './apps/epub/src/main/book-file.ts'`,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
})
const { openEpubSource, prepareEpubSave, createBookFile, publishBookFile } = createRequire(
  import.meta.url,
)(modulePath)
const scratch = await mkdtemp(join(tmpdir(), 'ieum-epub-save-batch-'))
const inside = relative(resolve(tmpdir()), resolve(scratch))
if (!inside || inside === '..' || inside.startsWith(`..${sep}`))
  throw new Error('Invalid scratch root')
const before = await stat(file)
const result = {
  kind: 'engine-save-only',
  fileBytes: before.size,
  samples: [],
  maxInputReadBytes: 0,
  completed: false,
}
let source
let saved
let disk
let peakRssBytes = 0
const started = performance.now()
const sample = (phase) => {
  const row = {
    phase,
    elapsedMs: Math.round(performance.now() - started),
    ...process.memoryUsage(),
  }
  peakRssBytes = Math.max(peakRssBytes, row.rss)
  result.samples.push(row)
  console.log(
    JSON.stringify({ phase, elapsedMs: row.elapsedMs, rssMiB: Math.round(row.rss / 1048576) }),
  )
}
const monitor = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 20)
async function readOnly(path) {
  const handle = await open(path, 'r')
  const size = (await handle.stat()).size
  return {
    size,
    async read(at, length) {
      result.maxInputReadBytes = Math.max(result.maxInputReadBytes, length)
      if (length > 1024 * 1024 || at < 0 || length < 0 || at + length > size)
        throw new Error('Unbounded source read')
      const bytes = new Uint8Array(length)
      for (let done = 0; done < length;) {
        const { bytesRead } = await handle.read(bytes, done, length - done, at + done)
        if (!bytesRead) throw new Error('Incomplete source read')
        done += bytesRead
      }
      return bytes
    },
    close: () => handle.close(),
  }
}
async function hashSource(input) {
  const hash = createHash('sha256')
  for (let at = 0; at < input.size; at += 1024 * 1024)
    hash.update(await input.read(at, Math.min(1024 * 1024, input.size - at)))
  return hash.digest('hex')
}
async function hashBody(body) {
  if (!body) throw new Error('Missing body')
  const hash = createHash('sha256')
  const reader = body.getReader()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) return hash.digest('hex')
      hash.update(next.value)
    }
  } finally {
    reader.releaseLock()
  }
}
try {
  // The test pins a read-only descriptor and verifies its hash before/after.
  // App snapshot-copy opening is intentionally outside this save-only diagnostic.
  source = await readOnly(file)
  result.inputHash = await hashSource(source)
  const opened = await openEpubSource(source)
  if (!opened.ok) throw new Error(opened.detail)
  const book = opened.book
  result.chapters = book.spine.items.length
  sample('opened')
  let changedPath
  let chapter
  let at = -1
  for (const item of book.spine.items.slice(0, 20)) {
    const decoded = await book.readText(item.path)
    if (decoded?.valid && (at = decoded.text.lastIndexOf('</body>')) >= 0) {
      changedPath = item.path
      chapter = decoded.text
      break
    }
  }
  if (!changedPath || !chapter) throw new Error('No test chapter')
  const marker = 'Ieum streamed-save verification'
  const plan = await prepareEpubSave(
    book,
    new Map([[changedPath, [{ start: at, end: at, text: `<p>${marker}</p>` }]]]),
    {
      now: () => new Date('2026-11-10T00:00:00Z'),
    },
  )
  if (!plan.ok || !plan.changed) throw new Error('Save was refused')
  sample('prepared')
  saved = await createBookFile(join(scratch, 'cache'), (write) => plan.write(write))
  result.savedBytes = saved.size
  result.savedHash = await saved.docHash()
  sample('private-output-written')
  const validated = await openEpubSource(saved)
  if (!validated.ok) throw new Error(validated.detail)
  if (
    JSON.stringify(book.metadata.identifiers) !==
    JSON.stringify(validated.book.metadata.identifiers)
  )
    throw new Error('Identifier changed')
  if (JSON.stringify(book.entryNames) !== JSON.stringify(validated.book.entryNames))
    throw new Error('Entry order changed')
  let checked = 0
  for (const path of book.entryNames) {
    if (path === changedPath || path === book.opfPath) continue
    const left = await hashBody(await book.streamForRendering(path))
    const right = await hashBody(await validated.book.streamForRendering(path))
    if (left !== right) throw new Error('Unchanged resource differs')
    checked++
  }
  result.unchangedResourcesVerified = checked
  sample('all-unchanged-resources-verified')
  const target = join(scratch, 'saved.epub')
  await publishBookFile(target, saved)
  await saved.close()
  saved = undefined
  sample('atomically-published')
  disk = await readOnly(target)
  if ((await hashSource(disk)) !== result.savedHash) throw new Error('Published bytes differ')
  const reopened = await openEpubSource(disk)
  if (!reopened.ok || !(await reopened.book.readText(changedPath))?.text.includes(marker))
    throw new Error('Saved edit did not reopen')
  result.inputUnchanged = (await hashSource(source)) === result.inputHash
  const after = await stat(file)
  result.inputUnchanged &&=
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  if (!result.inputUnchanged) throw new Error('Input changed during diagnostic')
  result.completed = true
  sample('reopened-and-original-verified')
} catch (error) {
  result.failure = String(error)
  process.exitCode = 1
} finally {
  clearInterval(monitor)
  await disk?.close()
  await saved?.close()
  await source?.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  result.peakRssBytes = peakRssBytes
  await writeFile(resolve(out), JSON.stringify(result, null, 2))
}
