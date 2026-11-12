/**
 * The ways into the document that reach a model go through the plugin's aiCall (민감정보
 * 가리기): the AI panel and the document check get the forAi bridge, while the memo panel,
 * the preview and the save path keep the plain one. The right-click item is installed and
 * heard, and a document with hidden spans is not saved as a template as it is.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAgentBridge } from '../src/renderer/ai/agent-bridge'

const app = readFileSync(join(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8')

/** the props of the first JSX element with this name */
const propsOf = (name: string) => {
  const at = app.indexOf(`<${name}`)
  expect(at, name).toBeGreaterThan(-1)
  return app.slice(at, app.indexOf('/>', at))
}

describe('the bridges', () => {
  it('route every call of the AI bridge through aiCall, and none of the plain one', async () => {
    const invoke = vi.fn(async () => 'answer')
    const editor = { plugins: { load: vi.fn(async () => undefined), invoke } }
    const ai = createAgentBridge(() => editor as never, { forAi: true })
    await ai.readText()
    await ai.findText('홍길동')
    expect(invoke.mock.calls).toEqual([
      ['ieum-agent', 'aiCall', ['readText', []]],
      ['ieum-agent', 'aiCall', ['findText', ['홍길동']]],
    ])
    invoke.mockClear()
    const plain = createAgentBridge(() => editor as never)
    await plain.listMemos()
    expect(invoke.mock.calls).toEqual([['ieum-agent', 'listMemos', []]])
  })

  it('give the AI panel and the document check the AI bridge, the rest the plain one', () => {
    expect(app).toContain('createAgentBridge(() => editorRef.current, { forAi: true })')
    expect(propsOf('HwpAiDock')).toContain('bridge={aiBridge}')
    expect(propsOf('DocCheckPanel')).toContain('bridge={aiBridge}')
    expect(propsOf('MemoSide')).toContain('bridge={agentBridge}')
    expect(propsOf('PrintPreview')).toContain('bridge={agentBridge}')
  })

  it('install the right-click item, hear it, and keep a hidden document from a template', () => {
    expect(app).toContain('pluginBridge.installHiding(sensitiveFeatureName(lang))')
    expect(app).toContain('frame.addEventListener(HIDING_EVENT, onHide)')
    expect(app).toMatch(
      /redacted: async \(\) => \{\s+const state = await pluginBridge\.hidingState\(\)/,
    )
    expect(propsOf('HwpAiDock')).toContain('sensitive={sensitive.guard}')
  })
})
