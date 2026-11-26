// Spec 5.6: the AI tools of a mobile HTML document are the desktop HTML skill over the phone's
// document, with the desktop-only tools left out, the desktop projection and edit guard for
// hidden parts, the view/edit gate, and one undo for a whole run. Scripted model only.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AgentLoop,
  type AgentStreamRequest,
  type AgentToolCall,
  type AgentTransport,
} from '@genoffice/agent-core'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type {
  EditorAiContext,
  EditorDocument,
  EditorHost,
} from '../src/renderer/editors/editorKind'
import { HTML_DESKTOP_ONLY_TOOLS, HTML_MOBILE_TOOLS } from '../src/renderer/editors/html/htmlAi'
import { htmlEditorKind } from '../src/renderer/editors/html/kind'
import { mapDocument } from '../src/renderer/editors/html/htmlPreview'
import { translateMobile } from '../src/renderer/i18n'

const PLAIN = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>보고서</title></head>',
  '<body>',
  '  <h1>제목</h1>',
  '  <p id="lead">첫 문단</p>',
  '  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">',
  '</body>',
  '</html>',
  '',
].join('\n')

/** Every one of the desktop's three marks, each over words the model must never read. */
const SECRET_NAME = '홍길동 010-1234-5678'
const SECRET_URL = 'https://example.com/?token=abc-secret-456'
const SECRET_KEY = 'sk-secret-789'
const HIDDEN = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>명단</title></head>',
  '<body>',
  '  <h1>연락처</h1>',
  `  <p id="who" data-gx-redact="이름">${SECRET_NAME}</p>`,
  `  <a id="link" href="${SECRET_URL}" data-gx-redact-href="링크">자료</a>`,
  `  <script>const key = /*gx:redact:토큰*/"${SECRET_KEY}";</script>`,
  '  <p id="tail">끝 문단</p>',
  '</body>',
  '</html>',
  '',
].join('\n')
const SECRETS = [SECRET_NAME, '홍길동', '010-1234', SECRET_URL, 'abc-secret', SECRET_KEY]

function session(): MobileDocSession {
  return {
    sessionId: 'html-ai',
    docKey: 'doc-html-ai',
    name: 'page.html',
    ext: 'html',
    format: 'html',
    writable: true,
    ephemeral: false,
    uriHint: 'content://docs/page.html',
  }
}

function activeDoc(): ActiveDocState {
  return {
    session: session(),
    dirty: true,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: false,
  }
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

function clientFor(bytes: Uint8Array) {
  const calls: Call[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      if (command === 'mobile_read_file_bytes') {
        return { bytesBase64: Buffer.from(bytes).toString('base64') } as T
      }
      return { ok: true } as T
    },
    async listen() {
      return () => {}
    },
  }
  return { client: createMobileClient(transport), calls }
}

interface Harness {
  readonly doc: EditorDocument
  readonly undo: Array<{ summary: string; undo: () => void } | null>
  readonly switches: number
  mode: DocumentMode
  caps: ReturnType<EditorAiContext['getCapabilities']>
  ctx: EditorAiContext
  /** The current source, as share writes it. */
  source(): Promise<string>
}

const cleanups: Array<() => void> = []
beforeAll(async () => {
  // the document chunk and the AI chunk the document loads with its first run
  await import('../src/renderer/editors/html/htmlDocument')
  await import('../src/renderer/editors/html/htmlAi')
}, 120_000)
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function open(text: string): Promise<Harness> {
  const { client, calls } = clientFor(new TextEncoder().encode(text))
  const opened = await htmlEditorKind.open({ session: session(), client, isUntitled: false })
  const host: EditorHost = {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: () => {},
    contentChanged: () => {},
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
  const doc = opened.start(host)
  cleanups.push(() => doc.dispose?.())
  const undo: Harness['undo'] = []
  let switches = 0
  const h: Harness = {
    doc,
    undo,
    get switches() {
      return switches
    },
    mode: 'edit',
    caps: { writable: true, encrypted: false, distribution: false, isUntitled: false },
    ctx: {
      getMode: () => h.mode,
      getCapabilities: () => h.caps,
      switchToEdit: () => {
        switches++
        h.mode = 'edit'
      },
      setUndo: (entry) => undo.push(entry),
      getLang: () => 'ko',
    },
    async source() {
      await doc.share(activeDoc())
      const shared = calls.filter((c) => c.command === 'mobile_share_file').at(-1)
      return Buffer.from(String(shared?.args?.bytesBase64), 'base64').toString('utf8')
    },
  }
  return h
}

/** A run as the loop starts it: the model reads the document state with the first message. */
async function startRun(h: Harness) {
  const run = await h.doc.createAiRun!(h.ctx)
  run.skill.buildContext?.()
  return run
}

let callId = 0
function call(name: string, input: Record<string, unknown> = {}): AgentToolCall {
  callId++
  return { id: `call-${callId}`, name, input }
}

/** The sid the document's element map gives the element whose start tag holds `marker`. */
function sidOf(text: string, marker: string): number {
  const map = mapDocument(text, 0, null)
  const entry = map.elements.find((e) => text.slice(e.startTag[0], e.startTag[1]).includes(marker))
  expect(entry, marker).toBeDefined()
  return entry!.sid
}

/** A model that answers from a script: each turn is tool calls, or the final text. */
function scriptedModel(turns: ReadonlyArray<ReadonlyArray<AgentToolCall> | string>) {
  const requests: AgentStreamRequest[] = []
  let turn = 0
  const transport: AgentTransport = {
    stream(request, callbacks) {
      requests.push(JSON.parse(JSON.stringify(request)) as AgentStreamRequest)
      const next = turns[turn++] ?? 'done'
      queueMicrotask(() => {
        if (typeof next === 'string') callbacks.onDelta(next)
        else for (const c of next) callbacks.onToolCall(c)
        callbacks.onDone()
      })
      return { cancel() {} }
    },
  }
  return { transport, requests }
}

async function runScripted(
  h: Harness,
  turns: ReadonlyArray<ReadonlyArray<AgentToolCall> | string>,
): Promise<AgentStreamRequest[]> {
  const run = await h.doc.createAiRun!(h.ctx)
  const model = scriptedModel(turns)
  await new Promise<void>((resolve, reject) => {
    const loop = new AgentLoop({
      transport: model.transport,
      skill: run.skill,
      compaction: false,
      events: { onDone: () => resolve(), onError: (error) => reject(new Error(error)) },
    })
    loop.run('이 문서를 정리해 줘')
  })
  run.finish?.()
  return model.requests
}

describe('web HTML AI: the document offers the desktop HTML tools', () => {
  it('has AI available now, with a run made by createAiRun', async () => {
    const h = await open(PLAIN)
    expect(h.doc.aiAvailable).not.toBe(false)
    expect(typeof h.doc.createAiRun).toBe('function')
    const run = await h.doc.createAiRun!(h.ctx)
    expect(run.skill.id).toBe('html')
    expect(run.skill.systemPrompt).toContain('apply_ops')
    // the reply language goes with the skill on the phone, as for the Hangul tools
    expect(run.skill.systemPrompt).toContain('한국어로 답변')
  })

  it('offers only the outline, the source and the edit batch; the desktop-only tools are refused', async () => {
    const h = await open(PLAIN)
    const run = await h.doc.createAiRun!(h.ctx)
    const names = run.skill.tools.map((tool) => tool.name)
    expect(names.sort()).toEqual([...HTML_MOBILE_TOOLS].sort())
    for (const name of [
      'generate_image',
      'plan_page',
      'write_document',
      'check_pages',
      'image_search',
      'web_search',
      'read_url',
    ]) {
      expect(HTML_DESKTOP_ONLY_TOOLS.has(name)).toBe(true)
      expect(names).not.toContain(name)
      const result = await run.skill.executeTool(call(name, { query: 'x', prompt: 'x', plan: 'x' }))
      expect(result.isError, name).toBe(true)
      expect(result.mutated).toBeFalsy()
    }
    expect(await h.source()).toBe(PLAIN)
    expect(h.undo).toEqual([])
  })

  it('no offered tool reaches window.htmlApi (a throwing stand-in records every touch)', async () => {
    const touched: string[] = []
    const thrower = new Proxy(
      {},
      {
        get(_target, key) {
          touched.push(String(key))
          throw new Error(`window.htmlApi.${String(key)} touched`)
        },
      },
    )
    Object.defineProperty(window, 'htmlApi', { value: thrower, configurable: true })
    cleanups.push(() => {
      delete (window as { htmlApi?: unknown }).htmlApi
    })

    const h = await open(PLAIN)
    const run = await h.doc.createAiRun!(h.ctx)
    expect(run.skill.systemPrompt.length).toBeGreaterThan(0)
    expect(run.skill.buildContext?.()).toContain('outline')
    const h1 = sidOf(PLAIN, '<h1')
    const runs: Array<[string, Record<string, unknown>]> = [
      ['get_outline', {}],
      ['read_source', { sid: h1 }],
      ['read_source', { start_line: 1, end_line: 4 }],
      ['apply_ops', { ops: [{ op: 'set_text', sid: h1, text: '새 제목' }] }],
    ]
    for (const [name, input] of runs) {
      const result = await run.skill.executeTool(call(name, input))
      expect(result.isError, `${name}: ${result.output}`).toBeFalsy()
    }
    // a desktop-store picture would be read through the main process: refused before that
    const img = sidOf(await h.source(), '<img')
    const picture = await run.skill.executeTool(
      call('apply_ops', {
        ops: [{ op: 'set_attr', sid: img, name: 'src', value: 'file:///cache/pic.png' }],
      }),
    )
    expect(picture.isError).toBe(true)
    expect(touched).toEqual([])
    expect(await h.source()).toContain('<h1>새 제목</h1>')
    expect(await h.source()).not.toContain('file://')
  })
})

describe('web HTML AI: hidden parts never reach the model', () => {
  it('the prompt, the context and every read show {{label}} only', async () => {
    const h = await open(HIDDEN)
    const run = await h.doc.createAiRun!(h.ctx)
    const outline = await run.skill.executeTool(call('get_outline', { depth: 5 }))
    const whole = await run.skill.executeTool(call('read_source', {}))
    const bySid = await run.skill.executeTool(
      call('read_source', { sid: sidOf(HIDDEN, 'id="who"') }),
    )
    const outputs = [
      run.skill.systemPrompt,
      run.skill.buildContext?.() ?? '',
      outline.output,
      whole.output,
      bySid.output,
    ]
    for (const out of outputs) {
      for (const secret of SECRETS) expect(out).not.toContain(secret)
    }
    expect(whole.output).toContain('{{이름}}')
    expect(whole.output).toContain('{{링크}}')
    expect(whole.output).toContain('{{토큰}}')
    expect(bySid.output).toContain('{{이름}}')
    // the desktop's placeholder rules come with the prompt when something is withheld
    expect(run.skill.systemPrompt).toContain('{{이름}}')
  })

  it('a scripted run sends the model nothing hidden, in any request', async () => {
    const h = await open(HIDDEN)
    const requests = await runScripted(h, [
      [call('get_outline', {}), call('read_source', {})],
      [call('read_source', { sid: sidOf(HIDDEN, 'id="link"') })],
      '정리했습니다.',
    ])
    expect(requests.length).toBe(3)
    const sent = JSON.stringify(requests)
    for (const secret of SECRETS) expect(sent).not.toContain(secret)
    expect(sent).toContain('{{이름}}')
    expect(sent).toContain('{{링크}}')
    expect(sent).toContain('{{토큰}}')
    // nothing was changed by reading
    expect(await h.source()).toBe(HIDDEN)
    expect(h.undo).toEqual([])
  })

  it('an edit that reaches a hidden part is refused by the desktop guard; the document stays', async () => {
    const h = await open(HIDDEN)
    const run = await startRun(h)
    const who = sidOf(HIDDEN, 'id="who"')
    const link = sidOf(HIDDEN, 'id="link"')
    const refused = [
      { op: 'set_text', sid: who, text: '{{이름}} 고침' },
      { op: 'remove', sid: who },
      { op: 'replace_element', sid: who, html: '<p>{{이름}}</p>' },
      { op: 'str_replace', old: '홍길동', new: '{{이름}}' },
      { op: 'str_replace', old: 'abc-secret', new: 'x' },
      { op: 'str_replace', old: SECRET_KEY, new: 'y' },
      { op: 'set_inner_html', sid: link, html: '<b>자료</b>' },
    ]
    for (const op of refused) {
      const result = await run.skill.executeTool(call('apply_ops', { ops: [op] }))
      expect(result.isError, JSON.stringify(op)).toBe(true)
      expect(result.mutated).toBeFalsy()
      // refused by the desktop guard, not for another reason
      expect(result.output, JSON.stringify(op)).toContain('withheld from the model')
    }
    // a batch with one refused op changes nothing at all
    const mixed = await run.skill.executeTool(
      call('apply_ops', {
        ops: [
          { op: 'set_text', sid: sidOf(HIDDEN, 'id="tail"'), text: '바뀐 끝' },
          { op: 'remove', sid: who },
        ],
      }),
    )
    expect(mixed.isError).toBe(true)
    expect(mixed.output).toContain('withheld from the model')
    expect(await h.source()).toBe(HIDDEN)
    expect(h.undo).toEqual([])
  })

  it('an edit around the hidden parts lands and the marks stay as they were', async () => {
    const h = await open(HIDDEN)
    const run = await startRun(h)
    const result = await run.skill.executeTool(
      call('apply_ops', {
        ops: [{ op: 'set_text', sid: sidOf(HIDDEN, 'id="tail"'), text: '새 끝' }],
      }),
    )
    expect(result.isError, result.output).toBeFalsy()
    const after = await h.source()
    expect(after).toBe(HIDDEN.replace('끝 문단', '새 끝'))
    expect(after).toContain(`data-gx-redact="이름">${SECRET_NAME}</p>`)
  })
})

describe('web HTML AI: undo and the view/edit gate', () => {
  it('a run that edits twice is undone in one go to the source it started from', async () => {
    const h = await open(PLAIN)
    const h1 = sidOf(PLAIN, '<h1')
    const lead = sidOf(PLAIN, 'id="lead"')
    await runScripted(h, [
      [call('apply_ops', { ops: [{ op: 'set_text', sid: h1, text: '바뀐 제목' }] })],
      [call('apply_ops', { ops: [{ op: 'set_text', sid: lead, text: '바뀐 문단' }] })],
      '고쳤습니다.',
    ])
    const changed = await h.source()
    expect(changed).toContain('<h1>바뀐 제목</h1>')
    expect(changed).toContain('<p id="lead">바뀐 문단</p>')
    const entry = h.undo.at(-1)
    expect(entry).toBeTruthy()
    expect(entry!.summary.length).toBeGreaterThan(0)
    // the summary is in the app's language, not the desktop provider's default
    expect(entry!.summary).toBe('1개 수정 적용')
    entry!.undo()
    expect(await h.source()).toBe(PLAIN)
    expect(h.undo.at(-1)).toBeNull()
  })

  it('the model may go on after its own edit, but reads again after the person edits', async () => {
    const h = await open(PLAIN)
    const run = await startRun(h)
    const ok = await run.skill.executeTool(
      call('apply_ops', { ops: [{ op: 'set_text', sid: sidOf(PLAIN, '<h1'), text: 'AI 제목' }] }),
    )
    expect(ok.isError, ok.output).toBeFalsy()
    // the model's own edit does not count as the person's
    const again = await run.skill.executeTool(
      call('apply_ops', {
        ops: [{ op: 'set_text', sid: sidOf(PLAIN, 'id="lead"'), text: 'AI 문단' }],
      }),
    )
    expect(again.isError, again.output).toBeFalsy()
    // taking the run back is the person's edit: the model's picture of the page is stale
    h.undo.at(-1)!.undo()
    expect(await h.source()).toBe(PLAIN)
    const stale = await run.skill.executeTool(
      call('apply_ops', { ops: [{ op: 'set_text', sid: sidOf(PLAIN, '<h1'), text: '늦은 고침' }] }),
    )
    expect(stale.isError).toBe(true)
    expect(stale.output).toContain('changed since you last looked')
    expect(await h.source()).toBe(PLAIN)
  })

  it('a mutating tool in view mode switches to edit first; reading does not', async () => {
    const h = await open(PLAIN)
    h.mode = 'view'
    const run = await h.doc.createAiRun!(h.ctx)
    await run.skill.executeTool(call('get_outline', {}))
    await run.skill.executeTool(call('read_source', {}))
    expect(h.switches).toBe(0)
    expect(h.mode).toBe('view')
    const result = await run.skill.executeTool(
      call('apply_ops', { ops: [{ op: 'set_text', sid: sidOf(PLAIN, '<h1'), text: '보기에서' }] }),
    )
    expect(result.isError, result.output).toBeFalsy()
    expect(h.switches).toBe(1)
    expect(h.mode).toBe('edit')
    expect(await h.source()).toContain('<h1>보기에서</h1>')
  })

  it('a document that cannot be changed offers no edit tool and refuses one', async () => {
    const h = await open(PLAIN)
    h.caps = { writable: false, encrypted: false, distribution: false, isUntitled: false }
    const run = await h.doc.createAiRun!(h.ctx)
    expect(run.skill.tools.map((tool) => tool.name)).not.toContain('apply_ops')
    const result = await run.skill.executeTool(
      call('apply_ops', { ops: [{ op: 'set_text', sid: sidOf(PLAIN, '<h1'), text: 'x' }] }),
    )
    expect(result.isError).toBe(true)
    expect(await h.source()).toBe(PLAIN)
  })
})
