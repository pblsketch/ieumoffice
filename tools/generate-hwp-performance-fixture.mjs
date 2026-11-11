/** Generate an independent large HWP fixture with the project's pinned engine. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import init, { HwpDocument } from '@rhwp/core'

const args = process.argv.slice(2)
const option = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const out = option('--out')
const paragraphs = Number(option('--paragraphs') ?? 3000)
if (!out || !Number.isInteger(paragraphs) || paragraphs < 1 || paragraphs > 50000) {
  throw new Error('Use --out <new .hwp path> [--paragraphs 3000]')
}
const require = createRequire(import.meta.url)
const wasm = await init({
  module_or_path: await readFile(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')),
})
const doc = HwpDocument.createEmpty()
const checked = (value) => {
  const result = JSON.parse(value)
  if (result.ok === false || result.error) throw new Error(JSON.stringify(result))
  return result
}
const started = performance.now()
try {
  checked(doc.createBlankDocument())
  checked(doc.beginBatch())
  for (let i = 0; i < paragraphs; i++) {
    const text = `문서 배치와 입력 지연 측정용 합성 문단 ${i + 1}. 표와 그림이 없는 본문에서 페이지를 넘기며 글자와 줄의 위치를 확인합니다.`
    checked(doc.insertText(0, i, 0, text))
    if (i + 1 < paragraphs) checked(doc.splitParagraph(0, i, text.length))
    if (i % 100 === 0 && process.memoryUsage().rss > 2.5 * 1073741824)
      throw new Error('Generation memory budget exceeded')
  }
  checked(doc.endBatch())
  const pages = doc.pageCount()
  const bytes = doc.exportHwp()
  if (doc.getParagraphCount(0) !== paragraphs)
    throw new Error('Unexpected generated paragraph count')
  const reopened = new HwpDocument(bytes)
  try {
    const after = { paragraphs: reopened.getParagraphCount(0), pages: reopened.pageCount() }
    if (after.paragraphs !== paragraphs || after.pages !== pages) {
      await mkdir(dirname(resolve(out)), { recursive: true })
      await writeFile(`${resolve(out)}.reopen-diff.hwp`, bytes, { flag: 'wx' })
      throw new Error(
        `HWP reopen differs: ${JSON.stringify({ before: { paragraphs, pages }, after })}`,
      )
    }
  } finally {
    reopened.free()
  }
  await mkdir(dirname(resolve(out)), { recursive: true })
  await writeFile(resolve(out), bytes, { flag: 'wx' })
  const result = {
    paragraphs,
    pages,
    fileBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    elapsedMs: Math.round(performance.now() - started),
    wasmBytes: wasm.memory.buffer.byteLength,
  }
  await writeFile(`${resolve(out)}.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  doc.free()
}
