import { rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createContext, disposeContext } from '../src/mcp/run'
import { createMcpServer } from '../src/mcp/server'
import { buildArgv, resolveTools, toolShape } from '../src/mcp/tools'
import { defaultRegistry } from '../src/cli'
import { run, tempDir } from './helpers'

const dirs: string[] = []
const servers: Server[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A stand-in shell on the actual socket transport; no Electron or user profile. */
async function shell(result: Record<string, unknown> = { documents }) {
  const dir = tempDir()
  dirs.push(dir)
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\ieumoffice-open-documents-${process.pid}-${servers.length}`
      : join(dir, 'control.sock')
  const requests: unknown[] = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      const envelope = JSON.parse(buffer.slice(0, nl))
      if (envelope.token !== 'test-token') return socket.destroy()
      requests.push(envelope.request)
      socket.end(JSON.stringify({ ok: true, result }) + '\n')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  writeFileSync(
    join(dir, 'control.json'),
    JSON.stringify({ protocol: 1, pid: process.pid, endpoint, token: 'test-token' }),
  )
  return { requests, env: { ...process.env, GENOFFICE_USER_DATA: dir, GENOFFICE_AUDIT_LOG: 'off' } }
}

const documents = [
  {
    id: 't1',
    title: 'GenOffice report.docx',
    kind: 'docs',
    path: '/GenOffice/report.docx',
    active: true,
  },
  { id: 't2', title: 'Untitled', kind: 'markdown', path: null, active: false },
]

describe('open_documents', () => {
  it('lists saved and unsaved tabs over the real control channel without focusing them', async () => {
    const { requests, env } = await shell()
    const result = await run(['open_documents', '--json'], { env })
    expect(result.code).toBe(0)
    expect(result.json()).toMatchObject({
      status: 'ok',
      command: 'open_documents',
      summary: '2 open documents',
      detail: { documents },
    })
    expect(requests).toEqual([{ cmd: 'open_documents' }])
  })

  it('returns an empty list when the running app has no documents', async () => {
    const { env } = await shell({ documents: [] })
    const result = await run(['open_documents', '--json'], { env })
    expect(result.code).toBe(0)
    expect(result.json()).toMatchObject({ summary: '0 open documents', detail: { documents: [] } })
  })

  it('rejects an incompatible app reply instead of inventing a document list', async () => {
    const { env } = await shell({})
    const result = await run(['open_documents', '--json'], { env })
    expect(result.code).toBe(4)
    expect(result.json()).toMatchObject({ error: 'app_unavailable' })
  })

  it('prints tab metadata for a human without requiring --json', async () => {
    const { env } = await shell()
    const result = await run(['open_documents'], { env })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('/GenOffice/report.docx')
    expect(result.stdout).toContain('t1')
    expect(result.stdout).toContain('active')
    expect(result.stdout).toContain('Untitled')
  })

  it('reports app_unavailable instead of inventing an empty list or starting the app', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const result = await run(['open_documents', '--json'], {
      env: { GENOFFICE_USER_DATA: dir, GENOFFICE_AUDIT_LOG: 'off' },
    })
    expect(result.code).toBe(4)
    expect(result.json()).toMatchObject({
      error: 'app_unavailable',
      suggestion: expect.any(String),
    })
  })

  it('exposes a parameter-free, local-only, read-only MCP tool using the same command', () => {
    const tool = resolveTools(defaultRegistry()).find((tool) => tool.name === 'open_documents')!
    expect(tool).toMatchObject({ command: 'open_documents', localOnly: true, readOnly: true })
    expect(toolShape(tool)).toEqual({})
    expect(buildArgv(tool, {})).toEqual({ argv: ['open_documents'], inline: [] })
  })

  it('lists and calls open_documents through an MCP client and a stand-in shell over a real socket', async () => {
    const { env } = await shell()
    const ctx = createContext({ cwd: process.cwd(), env, log: () => {} })
    const server = await createMcpServer(ctx)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    try {
      await server.connect(a)
      await client.connect(b)
      const { tools } = await client.listTools()
      const tool = tools.find((tool) => tool.name === 'open_documents')!
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.annotations?.openWorldHint).toBe(false)
      expect(tool.inputSchema.properties).toEqual({})
      const result = await client.callTool({ name: 'open_documents', arguments: {} })
      expect(result.isError).not.toBe(true)
      const content = result.content as { type: string; text?: string }[]
      expect(JSON.parse(content.find((item) => item.type === 'text')!.text!)).toMatchObject({
        detail: { documents },
      })
    } finally {
      await client.close()
      await server.close()
      disposeContext(ctx)
    }
  })
})
