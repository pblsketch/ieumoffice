// What the phone's spreadsheet AI offers the model: the desktop workbook
// tools as they are, minus what a phone cannot do (spec 2.6).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WORKBOOK_TOOLS } from '../../sheets/src/renderer/ai/tools'
import type { UniverRuntime } from '../../sheets/src/renderer/univer-state'
import {
  PHONE_UNAVAILABLE_OPS,
  PHONE_UNAVAILABLE_TOOLS,
  SHEETS_EDIT_TOOLS,
  phoneUnavailableOpsError,
} from '../src/renderer/editors/sheets/ai/phoneLimits'
import { createMobileAiApi } from '../src/renderer/editors/sheets/desktop-api/ai'
import type { SheetsEngineClient } from '../src/renderer/editors/sheets/desktop-api/engine'
import { MobileWorkbookSessions } from '../src/renderer/editors/sheets/desktop-api/sessions'

const sheetsSrc = resolve(__dirname, '../../sheets/src/renderer')
const IMPORTS_PRIVACY_POLICY = /from ['"][^'"]*privacy-policy/
const mobileAi = resolve(__dirname, '../src/renderer/editors/sheets/ai')

/** A grid stand-in: enough for the agent to be built (nothing is read). */
function fakeGrid() {
  const runtime = {
    univerAPI: {
      Event: { CommandExecuted: 'CommandExecuted' },
      addEvent: () => ({ dispose: () => undefined }),
      getActiveWorkbook: () => null,
    },
  } as unknown as UniverRuntime
  return { runtime, lazyWorkbookRef: { current: null } }
}

async function agent() {
  const { createMobileSheetsAgent } = await import('../src/renderer/editors/sheets/ai/sheetsAgent')
  return createMobileSheetsAgent(fakeGrid(), { lang: () => 'en', onEdited: vi.fn() })
}

describe('the spreadsheet AI tools on the phone', () => {
  it('offers the desktop workbook tools unchanged, without create_document', async () => {
    const { skill } = await agent()
    const desktop = WORKBOOK_TOOLS.filter((tool) => tool.name !== 'create_document')
    // the model sees exactly the desktop's definitions
    expect(skill.tools).toEqual(desktop)
    // a tool the desktop adds later must be sorted into "phone can" or "phone cannot" here
    expect(skill.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'aggregate_range',
        'find_cells',
        'get_workbook_context',
        'load_guide',
        'propose_operations',
        'read_cells',
        'read_formats',
        'read_range',
        'read_sheet_features',
        'select_range',
        'trace_dependents',
        'trace_precedents',
      ].sort(),
    )
  }, 180_000)

  it('has no web, image, attachment or new-file tool at all', async () => {
    const { skill } = await agent()
    const names = skill.tools.map((tool) => tool.name)
    for (const name of [
      'create_document',
      'web_search',
      'read_url',
      'image_search',
      'generate_image',
      'analyze_image',
      'list_attachments',
      'read_attachment',
      'merge_attached_workbooks',
    ]) {
      expect(names, name).not.toContain(name)
    }
    expect(names.some((name) => /web|url|image|attach|search_web/.test(name))).toBe(false)
    expect(PHONE_UNAVAILABLE_TOOLS.has('create_document')).toBe(true)
  }, 180_000)

  it('refuses create_document if the model calls it anyway', async () => {
    const { skill } = await agent()
    const result = await skill.executeTool({
      id: 'c',
      name: 'create_document',
      input: { type: 'csv' },
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('not available in the phone app')
  }, 180_000)

  it('tells the model what the phone leaves out, after the desktop prompt', async () => {
    const { skill } = await agent()
    const base = readFileSync(resolve(sheetsSrc, 'ai/prompts/base.md'), 'utf8')
    expect(skill.systemPrompt.startsWith(base)).toBe(true)
    expect(skill.systemPrompt).toContain('Not available here: create_document')
    expect(skill.systemPrompt).toContain('add_image')
  }, 180_000)

  it('gates only propose_operations as an edit', async () => {
    const { editTools } = await agent()
    expect([...editTools]).toEqual(['propose_operations'])
    expect(SHEETS_EDIT_TOOLS).toBe(editTools)
  })

  it('names only operations the desktop executor knows, and refuses them', () => {
    // the executor runs them, or the planner turns them into an executor step (edit_chart)
    const executor =
      readFileSync(resolve(sheetsSrc, 'op-executor.ts'), 'utf8') +
      readFileSync(resolve(sheetsSrc, 'plan-operations.ts'), 'utf8')
    for (const op of PHONE_UNAVAILABLE_OPS) {
      expect(executor, op).toContain(`.op === '${op}'`)
    }
    expect(phoneUnavailableOpsError([{ op: 'set_cell' }])).toBeNull()
    expect(phoneUnavailableOpsError([{ op: 'set_cell' }, { op: 'add_image' }])).toContain(
      'Not available in the phone app: add_image',
    )
  })

  it('sends what the desktop tools send: the unused privacy policy stays unused', () => {
    for (const file of ['sheetsAgent.ts', 'documentSlot.ts', 'pcAiModules.ts']) {
      expect(readFileSync(resolve(mobileAi, file), 'utf8'), file).not.toMatch(
        IMPORTS_PRIVACY_POLICY,
      )
    }
    // still true on the desktop: the policy module is defined but nothing imports it
    const app = readFileSync(resolve(sheetsSrc, 'App.tsx'), 'utf8')
    const tools = readFileSync(resolve(sheetsSrc, 'ai/tools.ts'), 'utf8')
    expect(app).not.toMatch(IMPORTS_PRIVACY_POLICY)
    expect(tools).not.toMatch(IMPORTS_PRIVACY_POLICY)
  })

  it("refuses the desktop's picture reads in plain words", async () => {
    const api = createMobileAiApi({} as SheetsEngineClient, new MobileWorkbookSessions())
    await expect(api.fetchImage('https://example.com/a.png')).rejects.toThrow(/phone app/)
    await expect(api.readLocalImage({ path: '/a.png' } as never)).rejects.toThrow(/phone app/)
    await expect(api.readAttachmentImage('/a.png')).rejects.toThrow(/phone app/)
  })

  it('loads the tools only when the AI runs', () => {
    const slot = readFileSync(resolve(mobileAi, 'documentSlot.ts'), 'utf8')
    expect(slot).toContain("await import('./sheetsAgent')")
    expect(slot).not.toMatch(/^import .*sheetsAgent/m)
    expect(slot).not.toMatch(/^import .*sheets\/src\/renderer/m)
  })
})

describe('the spreadsheet document and the AI entry', () => {
  it('offers an AI run on every workbook, also one opened with a password', async () => {
    const { startSheetsDocument } =
      await import('../src/renderer/editors/sheets/workspace/document')
    const { sheetsEditorKind } = await import('../src/renderer/editors/sheets/kind')
    for (const unlocked of [false, true]) {
      const opened = { unlocked, close: async () => undefined } as unknown as Parameters<
        typeof startSheetsDocument
      >[1]
      const doc = startSheetsDocument({} as Parameters<typeof startSheetsDocument>[0], opened)
      expect(typeof doc.createAiRun).toBe('function')
      expect(doc.aiAvailable).not.toBe(false)
      // App shows the entry only for `aiEnabled && kind.hasAi && doc.aiAvailable !== false`
      for (const aiEnabled of [false, true]) {
        const shown = aiEnabled && sheetsEditorKind.hasAi && doc.aiAvailable !== false
        expect(shown).toBe(aiEnabled)
      }
      doc.dispose?.()
    }
  }, 180_000)

  it('fails to prepare (a connection error on screen) while the grid is not built', async () => {
    const { createSheetsAiRun } = await import('../src/renderer/editors/sheets/ai/documentSlot')
    await expect(
      createSheetsAiRun!(
        {
          host: {} as never,
          opened: {} as never,
          grid: { grid: null, handle: null },
        },
        {} as never,
      ),
    ).rejects.toThrow(/not ready/)
  })
})
