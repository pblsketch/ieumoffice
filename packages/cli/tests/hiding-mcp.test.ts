import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REDACT_EL, REDACT_NS, REDACT_PREFIX } from '@genoffice/agent-core/redact-range'
import { createContext, disposeContext, type McpContext } from '../src/mcp/run'
import { createMcpServer } from '../src/mcp/server'
import { run, tempDir } from './helpers'

/**
 * The MCP server and hidden content (민감정보 가리기): reads show `{{label}}`,
 * an edit that would touch hidden content fails with the same `hidden_content`
 * envelope as the terminal, and `convert` refuses a source with any mark (or
 * one whose marks cannot be read) while the terminal's `convert` converts it.
 */

const SECRET = 'SECRETNAME'
const LABEL = '학생 이름'
const span = (label: string) =>
  `<span class="redact-span" data-redaction="" data-label="${label}">${SECRET}</span>`

let dir: string
let ctx: McpContext
let client: Client

beforeAll(async () => {
  dir = tempDir()
  ctx = createContext({
    cwd: dir,
    env: {
      ...process.env,
      GENOFFICE_USER_DATA: join(dir, 'user-data'),
      GENOFFICE_AUDIT_LOG: 'off',
    },
    log: () => {},
    scratchDir: join(dir, 'scratch'),
  })
  const server = await createMcpServer(ctx)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'hiding', version: '0' })
  await client.connect(clientTransport)
})

afterAll(async () => {
  await client?.close()
  if (ctx) disposeContext(ctx)
})

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }
  const text = result.content.find((c) => c.type === 'text' && c.text?.startsWith('{'))?.text ?? ''
  return { isError: result.isError === true, text, json: JSON.parse(text) }
}

async function markedDocx(): Promise<string> {
  const md = join(dir, 'w.md')
  writeFileSync(md, `Call ${SECRET} today.\n`)
  const plain = join(dir, 'w-plain.docx')
  expect(
    (await run(['create', '--type', 'docx', '--from', md, '--out', plain, '--force'])).code,
  ).toBe(0)
  const zip = await JSZip.loadAsync(readFileSync(plain))
  const xml = await zip.file('word/document.xml')!.async('string')
  zip.file(
    'word/document.xml',
    xml
      .replace(
        `<w:r><w:t xml:space="preserve">Call ${SECRET} today.</w:t></w:r>`,
        '<w:r><w:t xml:space="preserve">Call </w:t></w:r>' +
          `<w:r><w:rPr><${REDACT_EL} w:label="${LABEL}"/></w:rPr><w:t xml:space="preserve">${SECRET}</w:t></w:r>` +
          '<w:r><w:t xml:space="preserve"> today.</w:t></w:r>',
      )
      .replace('<w:document ', `<w:document xmlns:${REDACT_PREFIX}="${REDACT_NS}" `),
  )
  const path = join(dir, 'w.docx')
  writeFileSync(path, await zip.generateAsync({ type: 'uint8array' }))
  return path
}

describe('MCP reads and edits', () => {
  it('docs_read shows the label; docs_apply refuses an edit of hidden content', async () => {
    const path = await markedDocx()
    const read = await call('docs_read', { file: path, full: true })
    expect(read.isError).toBe(false)
    expect(read.text).not.toContain(SECRET)
    expect(read.text).toContain(`{{${LABEL}}}`)
    const before = readFileSync(path)
    const edit = await call('docs_apply', {
      file: path,
      ops: [{ op: 'deleteBlocks', target: { blockIndexes: [0] } }],
    })
    expect(edit.isError).toBe(true)
    expect(edit.json).toMatchObject({
      status: 'error',
      code: 1,
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
    expect(readFileSync(path).equals(before)).toBe(true)
  })
})

describe('MCP convert refuses a source that hides anything', () => {
  it('Markdown with a mark: hidden_content, reason convert, the decoded label', async () => {
    const md = join(dir, 'm.md')
    writeFileSync(md, `# T\n\ncall ${span('say &quot;hi&quot; &amp; bye')} now\n`)
    const out = join(dir, 'm.docx')
    const r = await call('convert', { file: md, to: 'docx', out })
    expect(r.isError).toBe(true)
    expect(r.json).toMatchObject({
      status: 'error',
      code: 1,
      command: 'convert',
      error: 'hidden_content',
      detail: { reason: 'convert', labels: ['say hi & bye'] },
    })
    expect(r.json.message).toBeTruthy()
    expect(r.json.suggestion).toBeTruthy()
    expect(existsSync(out)).toBe(false)
  })

  it('HTML and Word sources with a mark are refused too', async () => {
    const html = join(dir, 'p.html')
    writeFileSync(html, `<p data-gx-redact="${LABEL}">${SECRET}</p>`)
    const h = await call('convert', { file: html, to: 'md', out: join(dir, 'p.md') })
    expect(h.json).toMatchObject({
      error: 'hidden_content',
      detail: { reason: 'convert', labels: [LABEL] },
    })
    const docx = await markedDocx()
    const w = await call('convert', { file: docx, to: 'md', out: join(dir, 'w.md.out.md') })
    expect(w.json).toMatchObject({
      error: 'hidden_content',
      detail: { reason: 'convert', labels: [LABEL] },
    })
  })

  it('a mark that cannot be read (unknown) is refused with no labels', async () => {
    const md = join(dir, 'broken.md')
    // a withheld span that never closes: its end cannot be told
    writeFileSync(md, `call <span data-redaction="" data-label="${LABEL}">${SECRET} and on\n`)
    const r = await call('convert', { file: md, to: 'html', out: join(dir, 'broken.html') })
    expect(r.json).toMatchObject({
      error: 'hidden_content',
      detail: { reason: 'convert', labels: [] },
    })
  })

  it('a source with no mark converts as before', async () => {
    const md = join(dir, 'plain.md')
    writeFileSync(md, '# Plain\n\nNothing hidden.\n')
    const out = join(dir, 'plain.html')
    const r = await call('convert', { file: md, to: 'html', out })
    expect(r.isError).toBe(false)
    expect(existsSync(out)).toBe(true)
  })

  it('the terminal convert is not refused', async () => {
    const md = join(dir, 'term.md')
    writeFileSync(md, `call ${span(LABEL)} now\n`)
    const out = join(dir, 'term.html')
    const r = await run(['convert', md, '--to', 'html', '--out', out, '--json'])
    expect(r.code).toBe(0)
    expect(existsSync(out)).toBe(true)
  })
})
