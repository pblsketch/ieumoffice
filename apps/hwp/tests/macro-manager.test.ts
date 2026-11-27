/** @vitest-environment jsdom */
// Macro Manager modal, Macro Editor modal, untrusted .ieummacro import preview,
// Write with AI security invariants, and 22-language macro i18n shard tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import type { AiSettings, AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
import type { AiSubscriptionStatuses } from '@genoffice/ai-provider/browser'
import type { MacroHostResult } from '../studio-plugin/macro-host.mjs'
import { runMacroScript, validateMacroSyntax } from '../studio-plugin/macro-interpreter.mjs'
import {
  localizeSkippedCommandLabel,
  macroMenuLabelsFor,
  macroStrings,
} from '../src/renderer/i18n/macro'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import {
  MacroEditorModal,
  MacroManagerModal,
  buildMacroAiMessages,
  extractMacroScriptFromAiReply,
  formatMacroRunOutcome,
  requestAiMacroDraft,
  type MacroAiStreamClient,
  type MacroEditorModalProps,
  type MacroManagerModalProps,
  type MacroStoreApi,
} from '../src/renderer/macro'
import { formatPreviewScriptWithVisibleControls } from '../src/renderer/macro/MacroManagerModal'
import type { HwpApi, MacroRecord } from '../src/shared/ipc'

function makeMacro(overrides: Partial<MacroRecord> = {}): MacroRecord {
  return {
    id: overrides.id ?? 'macro-1',
    name: overrides.name ?? 'Insert Date Header',
    description: overrides.description ?? 'Inserts a standard heading',
    script: overrides.script ?? 'insertText("Hello");\nmessage("Done");',
    slot: overrides.slot ?? 1,
    origin: overrides.origin ?? 'manual',
    createdAt: overrides.createdAt ?? '2026-11-27T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-11-27T00:00:00.000Z',
  }
}

function makeReadyAiSettings(): AiSettings {
  return {
    provider: 'claude-code',
    providers: {} as AiSettings['providers'],
    subscriptionNoticeSeen: true,
    subscriptionNoticeVersion: 99,
  }
}

function makeReadyStatuses(): AiSubscriptionStatuses {
  return {
    'claude-code': {
      provider: 'claude-code',
      state: 'ready',
      loginMethod: 'subscription',
      meteredAccepted: false,
    },
  }
}

function makeDisconnectedStatuses(): AiSubscriptionStatuses {
  return {
    'claude-code': {
      provider: 'claude-code',
      state: 'signed-out',
      meteredAccepted: false,
    },
    codex: {
      provider: 'codex',
      state: 'not-installed',
      meteredAccepted: false,
    },
    chatgpt: {
      provider: 'chatgpt',
      state: 'signed-out',
      meteredAccepted: false,
    },
    antigravity: {
      provider: 'antigravity',
      state: 'not-installed',
      meteredAccepted: false,
    },
  }
}

function makeMockStreamClient(replyChunks: string[]): {
  client: MacroAiStreamClient
  requests: AiStreamRequest[]
} {
  const requests: AiStreamRequest[] = []
  const listeners = new Set<(chunk: AiStreamChunk) => void>()
  const client: MacroAiStreamClient = {
    aiStream: vi.fn(async (request: AiStreamRequest) => {
      requests.push(request)
      queueMicrotask(() => {
        for (const text of replyChunks) {
          for (const listener of listeners) {
            listener({ requestId: request.requestId, type: 'delta', text })
          }
        }
        for (const listener of listeners) {
          listener({ requestId: request.requestId, type: 'done' })
        }
      })
    }),
    aiStreamCancel: vi.fn(async () => {}),
    onAiStream: vi.fn((handler: (chunk: AiStreamChunk) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    }),
  }
  return { client, requests }
}

function makeMockStoreApi(overrides: Partial<MacroStoreApi> = {}): MacroStoreApi {
  return {
    macrosReadState: vi.fn(async () => ({
      ok: true as const,
      exists: true,
      macros: [],
      sizeBytes: 256,
      maxBytes: 2 * 1024 * 1024,
      nearLimit: false,
    })),
    macrosAdd: vi.fn(async (input) => {
      const macro = makeMacro({
        id: 'macro-new',
        name: input.name,
        description: input.description,
        script: input.script,
        slot: input.slot ?? null,
        origin: input.origin ?? 'manual',
      })
      return {
        ok: true as const,
        macro,
        macros: [macro],
        sizeBytes: 300,
        maxBytes: 2 * 1024 * 1024,
        nearLimit: false,
      }
    }),
    macrosUpdate: vi.fn(async (id, patch) => {
      const macro = makeMacro({
        id,
        name: patch.name ?? 'Updated',
        script: patch.script ?? 'insertText("ok");',
        slot: patch.slot ?? null,
      })
      return {
        ok: true as const,
        macro,
        macros: [macro],
        sizeBytes: 300,
        maxBytes: 2 * 1024 * 1024,
        nearLimit: false,
      }
    }),
    macrosDelete: vi.fn(async (id) => ({
      ok: true as const,
      deletedId: id,
      macros: [],
      sizeBytes: 64,
      maxBytes: 2 * 1024 * 1024,
      nearLimit: false,
    })),
    macrosAssignSlot: vi.fn(async (id, slot) => {
      const macro = makeMacro({ id, slot })
      return {
        ok: true as const,
        macro,
        macros: [macro],
        sizeBytes: 300,
        maxBytes: 2 * 1024 * 1024,
        nearLimit: false,
      }
    }),
    macrosPickImportFile: vi.fn(async () => ({ ok: true as const, canceled: true as const })),
    macrosCommitImport: vi.fn(async (input) => {
      const macro = makeMacro({
        id: 'macro-imported',
        name: input.name,
        description: input.description,
        script: input.script,
        slot: input.slot ?? null,
        origin: 'imported',
      })
      return {
        ok: true as const,
        macro,
        macros: [macro],
        sizeBytes: 400,
        maxBytes: 2 * 1024 * 1024,
        nearLimit: false,
      }
    }),
    macrosExportFile: vi.fn(async (id) => ({
      ok: true as const,
      canceled: false as const,
      path: '/tmp/exported.ieummacro',
      macroId: id,
      name: 'Insert Date Header',
    })),
    ...overrides,
  }
}

function setNativeInputValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('macro i18n shard', () => {
  it('covers all languages in LANGS with identical non-empty keys', () => {
    expect(Object.keys(macroStrings)).toHaveLength(LANGS.length)
    const canonicalKeys = Object.keys(macroStrings.zh).sort()
    for (const lang of LANGS) {
      const bundle = macroStrings[lang]
      expect(bundle).toBeDefined()
      expect(Object.keys(bundle).sort()).toEqual(canonicalKeys)
      for (const value of Object.values(bundle)) {
        expect(typeof value).toBe('string')
        expect(value.trim().length).toBeGreaterThan(0)
      }
      const menu = macroMenuLabelsFor(lang)
      expect(menu.recordToggle.trim().length).toBeGreaterThan(0)
      expect(menu.manage.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('macro-ai helpers', () => {
  it('buildMacroAiMessages sends only userPrompt and restricted API reference with no document text', () => {
    const built = buildMacroAiMessages('Replace double spaces with single spaces', 'en')
    expect(built.messages).toEqual([
      { role: 'user', text: 'Replace double spaces with single spaces' },
    ])
    expect(built.system).toContain('insertText')
    expect(built.system).toContain('replaceAll')
    expect(built.system).toContain('HAction')
    expect(built.system).toContain('eval')
    expect(built.system).toContain('Undo')
    expect(built.system).toContain('deleteBackward')
    expect(built.system).toContain('selectLeft')
    expect(built.system).toContain('FindRegExp')
    expect(built.system).toContain('200 units/pt')
    expect(built.system).toContain('BGR')
    expect(built.system).toContain('linear-time')
    expect(built.system).toContain('backreferences')
    expect(built.system).toContain('lookahead/lookbehind')
    expect(built.system).toContain('1000')
    expect(built.system).toContain('even URC integers')
    expect(built.system).toContain('LineSpacingType')
  })

  it('every keyword, global, method, and API listed as allowed in the AI system prompt parses and executes in runMacroScript', () => {
    const built = buildMacroAiMessages('Test capabilities', 'en')
    const allowedSection = built.system.split('## Strictly Forbidden')[0]

    // Must not advertise unsupported features in the Allowed section
    expect(allowedSection).not.toMatch(/\btry\b/)
    expect(allowedSection).not.toMatch(/\bcatch\b/)
    expect(allowedSection).not.toMatch(/\bfinally\b/)
    expect(allowedSection).not.toMatch(/\bthrow\b/)
    expect(allowedSection).not.toMatch(/\bsort\b/)
    expect(allowedSection).not.toMatch(/\btoFixed\b/)

    // Extract every listed String / Array / Math / Number / Object / JSON method from the Allowed section
    const extractCsvLine = (prefix: string): string[] => {
      const line = allowedSection.split('\n').find((entry) => entry.trim().startsWith(prefix))
      expect(line, `expected line starting with "${prefix}"`).toBeDefined()
      return line!
        .slice(line!.indexOf(':') + 1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }

    const stringMethods = extractCsvLine('- String methods:')
    const arrayMethods = extractCsvLine('- Array methods:')
    const mathItems = extractCsvLine('- Math:').map((s) => s.replace(/^Math\./, ''))
    const numberItems = extractCsvLine('- Number:')
      .filter((s) => s.startsWith('Number.'))
      .map((s) => s.replace(/^Number\./, ''))
    const objectItems = extractCsvLine('- Object:').map((s) => s.replace(/^Object\./, ''))
    const jsonItems = extractCsvLine('- JSON:').map((s) => s.replace(/^JSON\./, ''))

    expect(stringMethods.length).toBeGreaterThan(10)
    expect(arrayMethods.length).toBeGreaterThan(10)

    const snippets: string[] = [
      // Keywords & control flow
      'var a = 1; let b = 2; const c = true ? a + b : 0;',
      'let b = 0; const c = 1; if (c > 0) { b = b + 1; } else { b = 0; }',
      'const a = 1; let b = 0; switch (a) { case 1: b = 10; break; default: b = 20; }',
      'for (let i = 0; i < 3; i++) { if (i === 1) continue; }',
      'let w = 0; while (w < 2) { w++; break; }',
      'let d = 0; do { d++; } while (d < 1);',
      'function add(x, y) { return x + y; } const fn = (x) => x * 2; typeof add(1, fn(2));',
      'const undef = undefined; const nul = null; const fls = false;',
      'const sVal = String(123); const bVal = Boolean(1); const nVal = Number("42"); Array.isArray([]);',
    ]

    for (const m of mathItems) {
      snippets.push(m === 'PI' || m === 'E' ? `const _m = Math.${m};` : `Math.${m}(1, 2);`)
    }
    for (const m of numberItems) {
      snippets.push(
        m === 'parseInt' || m === 'parseFloat' ? `Number.${m}("12");` : `Number.${m}(12);`,
      )
    }
    for (const m of objectItems) {
      snippets.push(`Object.${m}({ a: 1 });`)
    }
    for (const m of jsonItems) {
      snippets.push(m === 'parse' ? 'JSON.parse("{\\"a\\":1}");' : 'JSON.stringify({ a: 1 });')
    }
    for (const m of stringMethods) {
      if (m === 'replace' || m === 'replaceAll') {
        snippets.push(`"ab ab".${m}("a", "x");`)
      } else if (m === 'repeat') {
        snippets.push(`"a".${m}(2);`)
      } else if (m === 'padStart' || m === 'padEnd') {
        snippets.push(`"a".${m}(3, "0");`)
      } else if (m === 'slice' || m === 'substring' || m === 'substr') {
        snippets.push(`"abcd".${m}(0, 2);`)
      } else if (m === 'charAt' || m === 'charCodeAt') {
        snippets.push(`"abcd".${m}(0);`)
      } else if (m === 'split') {
        snippets.push(`"a,b".${m}(",");`)
      } else if (
        m === 'indexOf' ||
        m === 'lastIndexOf' ||
        m === 'includes' ||
        m === 'startsWith' ||
        m === 'endsWith' ||
        m === 'concat'
      ) {
        snippets.push(`"abcd".${m}("b");`)
      } else {
        snippets.push(`" ab ".${m}();`)
      }
    }
    for (const m of arrayMethods) {
      if (
        m === 'map' ||
        m === 'filter' ||
        m === 'forEach' ||
        m === 'find' ||
        m === 'findIndex' ||
        m === 'some' ||
        m === 'every'
      ) {
        snippets.push(`[1, 2].${m}((x) => x > 0);`)
      } else if (m === 'reduce') {
        snippets.push(`[1, 2].${m}((acc, x) => acc + x, 0);`)
      } else if (m === 'splice') {
        snippets.push(`const _arr = [1, 2, 3]; _arr.${m}(1, 1);`)
      } else if (
        m === 'push' ||
        m === 'unshift' ||
        m === 'concat' ||
        m === 'indexOf' ||
        m === 'lastIndexOf' ||
        m === 'includes'
      ) {
        snippets.push(`const _arr = [1, 2]; _arr.${m}(1);`)
      } else if (m === 'join') {
        snippets.push(`[1, 2].${m}(",");`)
      } else {
        snippets.push(`const _arr = [1, 2]; _arr.${m}();`)
      }
    }

    // Verify all Direct Document API globals referenced in the prompt compile and execute cleanly
    const directApis = [
      'insertText',
      'breakPara',
      'breakPage',
      'deleteSelection',
      'deleteBackward',
      'deleteForward',
      'moveDocBegin',
      'moveDocEnd',
      'moveParaBegin',
      'moveParaEnd',
      'moveLineBegin',
      'moveLineEnd',
      'moveLeft',
      'moveRight',
      'moveUp',
      'moveDown',
      'moveWordLeft',
      'moveWordRight',
      'selectLeft',
      'selectRight',
      'selectUp',
      'selectDown',
      'selectWordLeft',
      'selectWordRight',
      'selectLineBegin',
      'selectLineEnd',
      'selectParaBegin',
      'selectParaEnd',
      'selectDocBegin',
      'selectDocEnd',
      'select',
      'selectAll',
      'cancelSelection',
      'getCaret',
      'getSelection',
      'setCharFormat',
      'setParaFormat',
      'applyStyle',
      'listStyles',
      'find',
      'replaceAll',
      'replaceNext',
      'insertTable',
      'changeOutlineLevel',
      'refreshToc',
      'refreshIndex',
      'refreshBibliography',
      'refreshAll',
      'getText',
      'getSectionCount',
      'getParagraphCount',
      'getParagraphText',
      'message',
    ]
    const stubGlobals: Record<string, (...args: unknown[]) => unknown> = {}
    for (const apiName of directApis) {
      expect(built.system, `system prompt mentions ${apiName}`).toContain(apiName)
      stubGlobals[apiName] = () => null
      snippets.push(`${apiName}();`)
    }

    for (const code of snippets) {
      const syntax = validateMacroSyntax(code)
      expect(syntax, `syntax check failed for: ${code}`).toEqual({ ok: true })
      const run = runMacroScript(code, stubGlobals)
      expect(run.ok, `runtime failed for: ${code} -> ${!run.ok ? run.error : ''}`).toBe(true)
    }
  })

  it('extractMacroScriptFromAiReply unwraps fenced code blocks and trims plain text', () => {
    expect(extractMacroScriptFromAiReply('```js\ninsertText("hi");\n```')).toBe('insertText("hi");')
    expect(
      extractMacroScriptFromAiReply('Here is the script:\n```javascript\nbreakPara();\n```\n'),
    ).toBe('breakPara();')
    expect(extractMacroScriptFromAiReply('  replaceAll("  ", " ");  ')).toBe(
      'replaceAll("  ", " ");',
    )
  })

  it('requestAiMacroDraft blocks without calling aiStream when no provider is connected', async () => {
    const { client, requests } = makeMockStreamClient(['insertText("nope");'])
    const settings: AiSettings = {
      provider: 'auto',
      providers: {
        // Even if a key provider is configured, auto must NEVER switch to a paid key route.
        openai: { apiKey: 'sk-test', model: 'gpt-4o' },
      } as AiSettings['providers'],
    }
    const result = await requestAiMacroDraft({
      userPrompt: 'Insert a greeting',
      lang: 'en',
      settings,
      statuses: makeDisconnectedStatuses(),
      streamClient: client,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.notConnected).toBeDefined()
    }
    expect(requests).toHaveLength(0)
  })
})

describe('MacroManagerModal and MacroEditorModal', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { hwpApi: Partial<HwpApi> }).hwpApi = {
      onLanguageChanged: () => () => {},
      getAiSettings: vi.fn(async () => makeReadyAiSettings()),
      setAiSettings: vi.fn(async () => {}),
      onAiSettingsChanged: () => () => {},
      openAiModelSettings: vi.fn(async () => {}),
    }
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function renderManager(props: Partial<MacroManagerModalProps> = {}): Promise<{
    api: MacroStoreApi
    onRunMacro: ReturnType<typeof vi.fn>
    onOpenEditor: ReturnType<typeof vi.fn>
    onReloadStore: ReturnType<typeof vi.fn>
  }> {
    const api = props.api ?? makeMockStoreApi()
    const onRunMacro = vi.fn(async (): Promise<MacroHostResult> => ({
      ok: true,
      value: undefined,
      messages: ['Replaced 3 items'],
      caret: { sec: 0, para: 0, offset: 0 },
      steps: 4,
      elapsedMs: 2,
      changed: true,
    }))
    const onOpenEditor = vi.fn()
    const onReloadStore = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(MacroManagerModal, {
            macros: [makeMacro()],
            recording: false,
            api,
            onRunMacro: props.onRunMacro ?? onRunMacro,
            onToggleRecording: props.onToggleRecording ?? vi.fn(),
            onOpenEditor: props.onOpenEditor ?? onOpenEditor,
            onReloadStore: props.onReloadStore ?? onReloadStore,
            onClose: props.onClose ?? vi.fn(),
            ...props,
          }),
        ),
      )
    })
    return { api, onRunMacro, onOpenEditor, onReloadStore }
  }

  async function renderEditor(props: Partial<MacroEditorModalProps> = {}): Promise<{
    onSave: ReturnType<typeof vi.fn>
    onRun: ReturnType<typeof vi.fn>
    onClose: ReturnType<typeof vi.fn>
  }> {
    const onSave = vi.fn(async () => ({ ok: true }))
    const onRun = vi.fn(async () => {})
    const onClose = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(MacroEditorModal, {
            mode: 'new',
            existingMacros: [],
            aiEnabled: true,
            onSave: props.onSave ?? onSave,
            onRun: props.onRun ?? onRun,
            onClose: props.onClose ?? onClose,
            ...props,
          }),
        ),
      )
    })
    return { onSave, onRun, onClose }
  }

  it('renders macros, runs a macro, assigns shortcut slot, and deletes macro', async () => {
    const macro = makeMacro({ id: 'm-1', name: 'Clean Spaces', slot: 1 })
    const { api, onRunMacro } = await renderManager({ macros: [macro] })

    const row = document.querySelector('[data-testid="macro-row"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.getAttribute('data-macro-name')).toBe('Clean Spaces')

    // Run macro
    const runBtn = row.querySelector('[data-testid="macro-run-btn"]') as HTMLButtonElement
    await act(async () => {
      runBtn.click()
    })
    expect(onRunMacro).toHaveBeenCalledTimes(1)
    expect(onRunMacro).toHaveBeenCalledWith({ name: 'Clean Spaces', script: macro.script })
    const notice = document.querySelector('[data-testid="macro-notice"]')
    expect(notice?.textContent).toContain('Replaced 3 items')

    // Assign shortcut slot Alt+3 (slot 3)
    const slotSelect = row.querySelector('[data-testid="macro-slot-select"]') as HTMLSelectElement
    await act(async () => {
      setNativeInputValue(slotSelect, '3')
    })
    expect(api.macrosAssignSlot).toHaveBeenCalledWith('m-1', 3)

    // Delete macro
    const deleteBtn = row.querySelector('[data-testid="macro-delete-btn"]') as HTMLButtonElement
    await act(async () => {
      deleteBtn.click()
    })
    expect(api.macrosDelete).toHaveBeenCalledWith('m-1')
  })

  it('displays corrupt store error banner with backup path and disables mutating actions', async () => {
    const { onReloadStore } = await renderManager({
      macros: [makeMacro()],
      storeError: {
        reason: 'library_corrupt',
        error: 'Invalid JSON',
        corruptBackupPath: 'C:/Users/test/hwp-macros.json.corrupt-20261127T120000Z',
      },
    })

    const errorBanner = document.querySelector('[data-testid="macro-store-error"]')
    expect(errorBanner).not.toBeNull()
    expect(document.querySelector('[data-testid="macro-store-backup-path"]')?.textContent).toBe(
      'C:/Users/test/hwp-macros.json.corrupt-20261127T120000Z',
    )

    expect(
      (document.querySelector('[data-testid="macro-new-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (document.querySelector('[data-testid="macro-import-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (document.querySelector('[data-testid="macro-edit-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (document.querySelector('[data-testid="macro-delete-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (document.querySelector('[data-testid="macro-slot-select"]') as HTMLSelectElement).disabled,
    ).toBe(true)

    const retryBtn = document.querySelector(
      '[data-testid="macro-store-retry-btn"]',
    ) as HTMLButtonElement
    await act(async () => {
      retryBtn.click()
    })
    expect(onReloadStore).toHaveBeenCalledTimes(1)
  })

  it('shows full script and syntax error in untrusted import preview with NO Run button before saving', async () => {
    const badScript = 'insertText("line 1");\nconst x = ;'
    const api = makeMockStoreApi({
      macrosPickImportFile: vi.fn(async () => ({
        ok: true as const,
        canceled: false as const,
        fileName: 'shared-macro.ieummacro',
        preview: {
          name: 'Shared Macro',
          description: 'From colleague',
          script: badScript,
          slot: null,
          syntax: { ok: false as const, error: 'Unexpected token', line: 2, column: 11 },
        },
      })),
    })

    const { onRunMacro } = await renderManager({ api })

    const importBtn = document.querySelector(
      '[data-testid="macro-import-btn"]',
    ) as HTMLButtonElement
    await act(async () => {
      importBtn.click()
    })

    const preview = document.querySelector('[data-testid="macro-import-preview"]') as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.querySelector('[data-testid="macro-import-script"]')?.textContent).toBe(
      badScript,
    )

    const syntaxErr = preview.querySelector('[data-testid="macro-import-syntax-error"]')
    expect(syntaxErr).not.toBeNull()
    expect(syntaxErr?.textContent).toContain('2')
    expect(syntaxErr?.textContent).toContain('11')

    // Security invariant: ZERO Run buttons inside the import preview!
    expect(preview.querySelector('[data-testid="macro-run-btn"]')).toBeNull()
    expect(preview.querySelector('[data-testid="macro-editor-run-btn"]')).toBeNull()
    const previewButtonLabels = Array.from(preview.querySelectorAll('button')).map((b) =>
      b.textContent?.trim().toLowerCase(),
    )
    expect(previewButtonLabels).not.toContain('run')
    expect(api.macrosCommitImport).toHaveBeenCalledTimes(0)

    // Confirm commits the import without running
    const confirmBtn = preview.querySelector(
      '[data-testid="macro-import-confirm-btn"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirmBtn.click()
    })
    expect(api.macrosCommitImport).toHaveBeenCalledTimes(1)
    expect(api.macrosCommitImport).toHaveBeenCalledWith({
      name: 'Shared Macro',
      description: 'From colleague',
      script: badScript,
      slot: null,
    })
    expect(onRunMacro).toHaveBeenCalledTimes(0)
  })

  it('shows live syntax error with exact line and column in MacroEditorModal', async () => {
    await renderEditor({ aiEnabled: false })

    const scriptInput = document.querySelector(
      '[data-testid="macro-script-input"]',
    ) as HTMLTextAreaElement
    await act(async () => {
      setNativeInputValue(scriptInput, 'insertText("ok");\nlet broken = ;')
    })

    const syntaxError = document.querySelector('[data-testid="macro-syntax-error"]')
    expect(syntaxError).not.toBeNull()
    expect(syntaxError?.textContent).toMatch(/line 2/i)
    expect(syntaxError?.textContent).toMatch(/col 14/i)

    // Fixing the script clears the syntax error
    await act(async () => {
      setNativeInputValue(scriptInput, 'insertText("ok");\nlet fixed = 1;')
    })
    expect(document.querySelector('[data-testid="macro-syntax-error"]')).toBeNull()
  })

  it('completely hides Write with AI when aiEnabled is false', async () => {
    await renderEditor({ aiEnabled: false })

    expect(document.querySelector('[data-testid="macro-ai-section"]')).toBeNull()
    expect(document.querySelector('[data-testid="macro-ai-prompt-input"]')).toBeNull()
    expect(document.querySelector('[data-testid="macro-ai-write-btn"]')).toBeNull()
  })

  it('Write with AI writes script ONLY to textarea, never auto-saves or auto-runs, and sends zero document content', async () => {
    const generatedScript = 'replaceAll("  ", " ");\nmessage("Normalized spaces");'
    const { client, requests } = makeMockStreamClient([
      '```js\n',
      'replaceAll("  ", " ");\n',
      'message("Normalized spaces");\n',
      '```',
    ])

    const { onSave, onRun } = await renderEditor({
      aiEnabled: true,
      aiStreamClient: client,
      aiSettingsOverride: makeReadyAiSettings(),
      aiStatusesOverride: makeReadyStatuses(),
    })

    const promptInput = document.querySelector(
      '[data-testid="macro-ai-prompt-input"]',
    ) as HTMLInputElement
    const writeBtn = document.querySelector(
      '[data-testid="macro-ai-write-btn"]',
    ) as HTMLButtonElement
    expect(promptInput).not.toBeNull()
    expect(writeBtn).not.toBeNull()

    await act(async () => {
      setNativeInputValue(promptInput, 'Replace double spaces with single spaces')
    })

    await act(async () => {
      writeBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Stream request carries ONLY user description + static grammar/API reference and ZERO tools
    expect(requests).toHaveLength(1)
    expect(requests[0].tools).toBeUndefined()
    expect(requests[0].messages).toEqual([
      { role: 'user', text: 'Replace double spaces with single spaces' },
    ])

    // Script is placed into textarea ONLY
    const scriptInput = document.querySelector(
      '[data-testid="macro-script-input"]',
    ) as HTMLTextAreaElement
    expect(scriptInput.value).toBe(generatedScript)

    // Security invariant: NEVER auto-saves and NEVER auto-runs!
    expect(onSave).toHaveBeenCalledTimes(0)
    expect(onRun).toHaveBeenCalledTimes(0)
  })

  it('import preview shows slot hint, forces slot: null even if preview has slot, and reveals hidden bidi/zero-width chars as [U+XXXX]', async () => {
    const spoofedScript = 'insertText("safe"); // \u202Ereverse\u200Bhidden'
    const formatted = formatPreviewScriptWithVisibleControls(spoofedScript)
    expect(formatted.hasHiddenControls).toBe(true)
    expect(formatted.text).toBe('insertText("safe"); // [U+202E]reverse[U+200B]hidden')

    const api = makeMockStoreApi({
      macrosPickImportFile: vi.fn(async () => ({
        ok: true as const,
        canceled: false as const,
        fileName: 'bidi-slot.ieummacro',
        preview: {
          name: 'Spoofed Macro',
          script: spoofedScript,
          // Even if an untrusted payload somehow carried a slot, UI must pass slot: null
          slot: 1 as unknown as null,
          syntax: { ok: false as const, error: 'Hidden control char', line: 1, column: 24 },
        },
      })),
    })

    await renderManager({
      macros: [makeMacro({ id: 'existing-1', name: 'Trusted Slot 1', slot: 1 })],
      api,
    })

    const importBtn = document.querySelector(
      '[data-testid="macro-import-btn"]',
    ) as HTMLButtonElement
    await act(async () => {
      importBtn.click()
    })

    const preview = document.querySelector('[data-testid="macro-import-preview"]') as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.querySelector('[data-testid="macro-import-slot-hint"]')?.textContent).toContain(
      'Shortcuts are not imported automatically',
    )
    expect(preview.querySelector('[data-testid="macro-import-bidi-warning"]')).not.toBeNull()
    expect(preview.querySelector('[data-testid="macro-import-script"]')?.textContent).toBe(
      'insertText("safe"); // [U+202E]reverse[U+200B]hidden',
    )

    const confirmBtn = preview.querySelector(
      '[data-testid="macro-import-confirm-btn"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirmBtn.click()
    })
    expect(api.macrosCommitImport).toHaveBeenCalledWith({
      name: 'Spoofed Macro',
      script: spoofedScript,
      slot: null,
    })
  })

  it('localizes skipped command labels in MacroEditorModal so non-Korean UI never displays Korean studio labels', async () => {
    expect(localizeSkippedCommandLabel('en', 'edit:undo', '되돌리기')).toBe('Undo')
    expect(localizeSkippedCommandLabel('en', 'edit:delete-object', 'Backspace')).toBe(
      'Delete document object',
    )
    expect(localizeSkippedCommandLabel('en', 'macro:outside-body', 'outside-body')).toBe(
      'Edit outside body paragraph',
    )
    expect(localizeSkippedCommandLabel('ko', 'edit:delete-object', 'Backspace')).toBe(
      '문서 개체 지우기',
    )
    expect(localizeSkippedCommandLabel('ko', 'macro:outside-body', 'outside-body')).toBe(
      '본문 밖 편집',
    )
    expect(localizeSkippedCommandLabel('en', 'table:split', '표 나누기')).toBe(
      'Unsupported editor action (table:split)',
    )
    expect(localizeSkippedCommandLabel('ko', 'edit:undo', '되돌리기')).toBe('되돌리기')
    expect(localizeSkippedCommandLabel('ko', 'table:split', '표 나누기')).toBe('표 나누기')

    await renderEditor({
      mode: 'recorded',
      aiEnabled: false,
      initialDraft: {
        origin: 'recorded',
        script: 'insertText("ok");',
        skipped: [
          { commandId: 'edit:undo', label: '되돌리기' },
          { commandId: 'table:split', label: '표 나누기' },
        ],
      },
    })

    const banner = document.querySelector('[data-testid="macro-skipped-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('Undo')
    expect(banner?.textContent).toContain('Unsupported editor action (table:split)')
    expect(banner?.textContent).not.toContain('되돌리기')
    expect(banner?.textContent).not.toContain('표 나누기')
  })

  it('formats macro run outcomes for unsupported_place and post_run failures without fake line 1', () => {
    const outside = formatMacroRunOutcome('en', 'M', {
      ok: false,
      code: 'unsupported_place',
      error: 'Caret is not in body',
      line: null,
      column: null,
      messages: [],
      steps: 0,
      elapsedMs: 0,
    } as unknown as MacroHostResult)
    expect(outside.tone).toBe('error')
    expect(outside.text).toContain('body paragraph')

    const postRunLoss = formatMacroRunOutcome('en', 'M', {
      ok: false,
      code: 'object_loss',
      phase: 'post_run',
      error: 'Lost table',
      line: null,
      column: null,
      messages: [],
      steps: 5,
      elapsedMs: 1,
    } as unknown as MacroHostResult)
    expect(postRunLoss.tone).toBe('error')
    expect(postRunLoss.text).toContain('post-run check')
    expect(postRunLoss.text).not.toMatch(/line 1/i)

    const inlineLoss = formatMacroRunOutcome('en', 'M', {
      ok: false,
      code: 'memo_loss',
      error: 'Lost memo',
      line: 4,
      column: 3,
      messages: [],
      steps: 5,
      elapsedMs: 1,
    } as unknown as MacroHostResult)
    expect(inlineLoss.tone).toBe('error')
    expect(inlineLoss.text).toContain('line 4, col 3')

    const postRunGeneric = formatMacroRunOutcome('en', 'M', {
      ok: false,
      code: 'runtime_error',
      phase: 'post_run',
      error: 'Unexpected state',
      line: null,
      column: null,
      messages: [],
      steps: 5,
      elapsedMs: 1,
    } as unknown as MacroHostResult)
    expect(postRunGeneric.tone).toBe('error')
    expect(postRunGeneric.text).toContain('post-run check')
    expect(postRunGeneric.text).not.toMatch(/line 1/i)

    // R4: whileRecording appends noticeMacroRunNotRecorded to both success and error outcomes
    const recordedSuccess = formatMacroRunOutcome(
      'en',
      'Clean Spaces',
      {
        ok: true,
        value: undefined,
        messages: [],
        caret: { sec: 0, para: 0, offset: 0 },
        steps: 2,
        elapsedMs: 1,
        changed: true,
      },
      { whileRecording: true },
    )
    expect(recordedSuccess.tone).toBe('info')
    expect(recordedSuccess.text).toContain('Clean Spaces')
    expect(recordedSuccess.text).toContain(macroStrings.en.noticeMacroRunNotRecorded)

    const recordedError = formatMacroRunOutcome(
      'en',
      'Broken',
      {
        ok: false,
        code: 'runtime_error',
        error: 'Boom',
        line: 2,
        column: 1,
        messages: [],
        steps: 1,
        elapsedMs: 1,
      } as unknown as MacroHostResult,
      { whileRecording: true },
    )
    expect(recordedError.tone).toBe('error')
    expect(recordedError.text).toContain('Boom')
    expect(recordedError.text).toContain(macroStrings.en.noticeMacroRunNotRecorded)
  })

  it('renders BOTH macro run outcome and noticeMacroRunNotRecorded when running a macro while recording (R4)', async () => {
    const macro = makeMacro({ id: 'm-rec', name: 'Clean Spaces', slot: 1 })
    await renderManager({ macros: [macro], recording: true })

    const row = document.querySelector('[data-testid="macro-row"]') as HTMLElement
    const runBtn = row.querySelector('[data-testid="macro-run-btn"]') as HTMLButtonElement
    await act(async () => {
      runBtn.click()
    })

    const notice = document.querySelector('[data-testid="macro-notice"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('Replaced 3 items')
    expect(notice?.textContent).toContain(macroStrings.en.noticeMacroRunNotRecorded)
  })
})
