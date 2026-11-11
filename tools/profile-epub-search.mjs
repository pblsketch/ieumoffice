/** Compare search-text extraction against HEAD using the same synthetic chapter. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { JSDOM } from 'jsdom'

if (!globalThis.gc)
  throw new Error('Run node --expose-gc tools/profile-epub-search.mjs --out <json>')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const path = 'apps/epub/src/renderer/reader/book-search.ts'
const at = process.argv.indexOf('--out')
if (at < 0 || !process.argv[at + 1]) throw new Error('Pass --out <json>')

async function load(source, name) {
  // This benchmark calls only text extraction; the unrelated UI search helper
  // is omitted so the measurement does not include loading the React UI bundle.
  const isolated = source.replace(/^import \{ findInText \} from '@genoffice\/ui'\r?$/m, '')
  if (isolated === source) throw new Error('Search helper import changed; review the benchmark')
  const { code } = await transform(isolated, { loader: 'ts', format: 'esm', sourcefile: name })
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const baseline = await load(
  execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }),
  'baseline.ts',
)
const current = await load(await readFile(resolve(root, path), 'utf8'), 'current.ts')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const doc = dom.window.document
const source = '한글 문장과 English words. '.repeat(100000)
doc.body.appendChild(doc.createTextNode(source))

function measure(name, read) {
  globalThis.gc()
  const before = process.memoryUsage().heapUsed
  const start = performance.now()
  const value = read(doc.body)
  const elapsedMs = performance.now() - start
  globalThis.gc()
  const retainedHeapBytes = process.memoryUsage().heapUsed - before
  const text = typeof value === 'string' ? value : value.text
  return {
    name,
    elapsedMs,
    retainedHeapBytes,
    characters: text.length,
    positionEntries: typeof value === 'string' ? 0 : value.nodeOf.length + value.offsetOf.length,
    textSha256: createHash('sha256').update(text).digest('hex'),
  }
}

const results = [
  measure('baseline-whole-book-search', baseline.buildTextIndex),
  measure('current-visible-chapter-index', current.buildTextIndex),
  measure('current-whole-book-search', current.readingText),
]
if (new Set(results.map((r) => r.textSha256)).size !== 1) throw new Error('Reading text changed')
await writeFile(
  resolve(process.argv[at + 1]),
  JSON.stringify({ sourceCharacters: source.length, results }, null, 2),
)
console.log(JSON.stringify(results, null, 2))
dom.window.close()
