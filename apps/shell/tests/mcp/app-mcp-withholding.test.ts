import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMcpSettings, configureMcpRuntime, stopMcp } from '../../src/main/mcp/app-mcp'
import type { OpenDocumentsControl } from '../../src/main/mcp/tools/open-documents-tools'
import type { SlidesControl } from '../../src/main/mcp/tools/slides-tools'
import { withholdingOpenDocuments } from '../../src/main/mcp/withholding'

/**
 * The MCP server turned on under Integrations applies hidden content
 * (민감정보 가리기) the way an agent session's server does: an open Markdown or
 * HTML tab reads with its hidden span as `{{label}}`, a deck reads through the
 * withholding readout, and a deck that withholds anything is not edited.
 */

const SECRET = '010-1234-5678'
const MARKDOWN = `Call <span class="redact-span" data-redaction="" data-label="phone">${SECRET}</span> soon\n`
const TABS = [
  { id: 'md', kind: 'markdown', title: 'note.md', dirty: false, active: true },
  { id: 'deck', kind: 'slides', title: 'deck.pptx', dirty: false, active: false },
]

let dir: string
let port: number
let slides: SlidesControl

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ieum-mcp-withhold-'))
  port = await freePort()
  slides = {
    openBlankTab: async () => 7,
    runTxn: vi.fn(async () => ({ applied: true })),
    readDeck: vi.fn(async (_wc: number, options?: { withhold?: boolean }) => ({
      withhold: options?.withhold === true,
    })),
    saveDeck: async (_wc, path) => ({ path }),
    deckWithholds: async () => true,
  }
  const open: OpenDocumentsControl = {
    list: async () => TABS as never,
    read: async (tab) => (tab.kind === 'markdown' ? MARKDOWN : 'other'),
    close: vi.fn(async () => ({})),
    save: vi.fn(async () => ({ savedPath: join(dir, 'x') })),
  }
  configureMcpRuntime({
    version: 'test',
    defaultSaveDir: () => dir,
    openPath: () => false,
    slidesControl: slides,
    openDocumentsControl: open,
  })
  await applyMcpSettings({ enabled: true, port, background: false, logging: false })
})

afterEach(async () => {
  await stopMcp()
  await rm(dir, { recursive: true, force: true })
})

describe('the in-app MCP server withholds hidden content', () => {
  it('reads an open Markdown tab with the hidden span as its label', async () => {
    const text = await callTool('open_documents', { action: 'read', target: 'md' })
    expect(text).not.toContain(SECRET)
    expect(text).toContain('{{phone}}')
  })

  it('reads a deck through the withholding readout and refuses to edit one that withholds', async () => {
    await callTool('create_session', { family: 'pptx' })
    const read = await callTool('read_deck', {})
    expect(read).toMatch(/withhold.{0,6}: true/)
    const edit = await callTool('apply_slide_ops', { ops: [{ op: 'addBlankSlide' }] })
    expect(edit).toContain('hidden_content')
    expect(slides.runTxn).not.toHaveBeenCalled()
  })
})

describe('withholding open documents outside a session', () => {
  it('still closes and saves tabs', async () => {
    const inner: OpenDocumentsControl = {
      list: async () => [],
      read: async () => '',
      close: vi.fn(async () => ({})),
      save: vi.fn(async () => ({ savedPath: 'x' })),
    }
    const control = withholdingOpenDocuments(inner)
    await control.close(TABS[0] as never, { unsaved: 'discard' })
    await control.save(TABS[0] as never)
    expect(inner.close).toHaveBeenCalled()
    expect(inner.save).toHaveBeenCalled()
  })
})

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const p = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(p))
    })
  })
}

let session: string | null = null

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!session) {
    const handshake = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'withhold-test', version: '1' },
      },
    })
    session = (handshake.headers['mcp-session-id'] as string | undefined) ?? null
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  const reply = await post({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  return reply.text
}

afterEach(() => {
  session = null
})

function post(payload: unknown): Promise<{ headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(data),
    }
    if (session) headers['Mcp-Session-Id'] = session
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers, agent: false },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ headers: res.headers, text }))
      },
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}
