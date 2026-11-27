/**
 * Unit and real-engine integration tests for the macro recorder, slot shortcuts,
 * studio recording patches, Tool-menu wiring, plugin surface, and agent bridge.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  MACRO_SLOT_KEYS,
  createMacroRecorder,
  getActiveMacroRecorder,
  isMacroRecordingActive,
  quoteScriptString,
  recordStudioCommand,
  recordStudioKey,
  recordStudioMouseClick,
  recordStudioText,
  setActiveMacroRecorder,
  slotFromAltKey,
  type MacroRecorderNotice,
} from '../studio-plugin/macro-recorder.mjs'
import { validateMacroSyntax } from '../studio-plugin/macro-interpreter.mjs'
import {
  executeMacroTransaction,
  runMacroOnDocument,
  type MacroTransactionHost,
} from '../studio-plugin/macro-host.mjs'
import { macroShortcutKey } from '../studio-plugin/hancom-keys.mjs'
import {
  MACRO_COMMAND_EVENT,
  MACRO_RECORDING_EVENT,
  installMacroMenu,
} from '../studio-plugin/workpane-menu.mjs'
import { AGENT_PLUGIN_ID, agentPlugin } from '../studio-plugin/agent-plugin.mjs'
import { createAgentBridge, type AgentBridgeEditor } from '../src/renderer/ai/agent-bridge'
import { STUDIO_PATCHES, applyPatch, patchTargets } from '../scripts/rhwp-patches.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  setActiveMacroRecorder(null)
})

function makeDoc(paragraphs: string[] = ['']): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  paragraphs.forEach((text, index) => {
    if (index > 0) {
      doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    }
    if (text) doc.insertText(0, index, 0, text)
  })
  return doc
}

function bodyTexts(doc: HwpDocument, sec = 0): string[] {
  return Array.from({ length: doc.getParagraphCount(sec) }, (_, para) => {
    const len = doc.getParagraphLength(sec, para)
    return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
  })
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function createMockTransactionHost(initial: HwpDocument) {
  let current = initial
  const undoStack: Uint8Array[] = []
  const txRecords: Array<{ label: string; options?: { foreign?: boolean } }> = []
  const commands = new Map<
    string,
    {
      label: string
      shortcutLabel?: string
      execute: (services?: unknown, params?: unknown) => void
    }
  >()
  const menuItems: Array<{ menuId: string; commandId: string; position?: string }> = []
  const executedCommands: Array<{ id: string; params: unknown }> = []

  const host: MacroTransactionHost & {
    read<T>(fn: (doc: HwpDocument) => T): T
    events: { on(name: string, handler: () => void): void }
    automation: {
      execute(command: string, params?: unknown): { ok: boolean }
      registerCommand(def: {
        id: string
        label: string
        shortcutLabel?: string
        canExecute?: (ctx: { hasDocument?: boolean }) => boolean
        execute: (services?: unknown, params?: unknown) => void
      }): void
      unregisterCommand(id: string): void
      addMenuItem(item: { menuId: string; commandId: string; position?: string }): void
    }
  } = {
    read<T>(fn: (doc: HwpDocument) => T): T {
      return fn(current)
    },
    transaction<T>(
      label: string,
      fn: (tx: { doc(): HwpDocument; deferPagination(): void }) => T,
      options?: { foreign?: boolean },
    ): T {
      const before = current.exportHwp()
      try {
        const result = fn({
          doc: () => current,
          deferPagination: () => {},
        })
        txRecords.push({ label, options })
        undoStack.push(before)
        return result
      } catch (err) {
        current = new HwpDocument(before)
        throw err
      }
    },
    events: {
      on: () => {},
    },
    automation: {
      execute(command: string, params?: unknown) {
        executedCommands.push({ id: command, params })
        const def = commands.get(command)
        if (!def) return { ok: false }
        def.execute({}, params)
        return { ok: true }
      },
      registerCommand(def) {
        commands.set(def.id, def)
      },
      unregisterCommand(id: string) {
        commands.delete(id)
      },
      addMenuItem(item) {
        menuItems.push(item)
      },
    },
  }

  return {
    host,
    doc: () => current,
    undoCount: () => undoStack.length,
    undoOnce: () => {
      const prev = undoStack.pop()
      if (!prev) return false
      current = new HwpDocument(prev)
      return true
    },
    txRecords: () => [...txRecords],
    commands,
    menuItems,
    executedCommands,
  }
}

describe('quoteScriptString and text recording round-trip', () => {
  it('safely quotes special characters, escapes, and Unicode separators', () => {
    const tricky = 'He said "hi" and \'ok\' \\ path\tend\0\u2028\u2029\x07'
    const literal = quoteScriptString(tricky)
    expect(literal.startsWith('"') && literal.endsWith('"')).toBe(true)
    expect(validateMacroSyntax(`const s = ${literal};`)).toEqual({ ok: true })

    const parsed = JSON.parse(literal)
    expect(parsed).toBe(tricky)
  })

  it('coalesces consecutive typed text, splits newlines, and replays exact Korean and escaped text', () => {
    const recorder = createMacroRecorder()
    recorder.start()
    recorder.recordText('인용: "테스트" ')
    recorder.recordText("'단일' \\ 경로")
    recorder.recordText('\n둘째 줄\r\n셋째 줄')
    recorder.recordText('')
    const stopped = recorder.stop()

    expect(stopped.stepCount).toBe(5)
    expect(stopped.skipped).toEqual([])
    expect(stopped.script.split('\n')).toEqual([
      'insertText("인용: \\"테스트\\" \'단일\' \\\\ 경로");',
      'breakPara();',
      'insertText("둘째 줄");',
      'breakPara();',
      'insertText("셋째 줄");',
    ])
    expect(validateMacroSyntax(stopped.script)).toEqual({ ok: true })

    const doc = makeDoc([''])
    const res = runMacroOnDocument(doc, stopped.script)
    expect(res.ok).toBe(true)
    expect(bodyTexts(doc)).toEqual(['인용: "테스트" \'단일\' \\ 경로', '둘째 줄', '셋째 줄'])
  })
})

describe('command and keyboard recording with real-engine replay and single undo', () => {
  it('translates supported formatting, navigation, style, page break, and table commands and replays in 1 undo step', () => {
    const recorder = createMacroRecorder()
    recorder.start()
    recorder.recordText('제목 문단')
    recorder.recordCommand('edit:select-all')
    recorder.recordCommand('format:bold')
    recorder.recordCommand('format:align-center')
    recorder.recordKey({ key: 'Escape' })
    recorder.recordKey({ key: 'End' })
    recorder.recordKey({ key: 'Enter' })
    recorder.recordText('본문 내용')
    recorder.recordCommand('format:style', { id: 0 })
    recorder.recordCommand('table:create', { rows: 2, cols: 3 })
    recorder.recordCommand('insert:page-break')
    const stopped = recorder.stop()

    expect(stopped.skipped).toEqual([])
    expect(validateMacroSyntax(stopped.script)).toEqual({ ok: true })
    expect(stopped.script).toContain('selectAll();')
    expect(stopped.script).toContain('setCharFormat({ bold: true });')
    expect(stopped.script).toContain('setParaFormat({ align: "center" });')
    expect(stopped.script).toContain('cancelSelection();')
    expect(stopped.script).toContain('moveParaEnd();')
    expect(stopped.script).toContain('breakPara();')
    expect(stopped.script).toContain('applyStyle(0);')
    expect(stopped.script).toContain('insertTable(2, 3);')
    expect(stopped.script).toContain('breakPage();')

    const doc = makeDoc([''])
    const beforeBytes = doc.exportHwp()
    const mock = createMockTransactionHost(doc)

    const result = executeMacroTransaction(mock.host, stopped.script)
    expect(result.ok).toBe(true)
    expect(mock.undoCount()).toBe(1)
    expect(mock.txRecords()[0]).toEqual({ label: 'macro', options: { foreign: true } })

    const texts = bodyTexts(mock.doc())
    expect(texts[0]).toBe('제목 문단')
    expect(texts.some((line) => line.includes('본문 내용'))).toBe(true)
    const controls = JSON.parse(mock.doc().getControls()) as Array<{ ctrlId: string }>
    expect(controls.some((c) => c.ctrlId === 'tbl')).toBe(true)

    expect(mock.undoOnce()).toBe(true)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })

  it('translates navigation, word movement, document edges, char/para props, replace-all, and refresh commands', () => {
    const recorder = createMacroRecorder()
    recorder.start()
    recorder.recordKey({ key: 'ArrowLeft' })
    recorder.recordKey({ key: 'ArrowRight' })
    recorder.recordKey({ key: 'ArrowUp' })
    recorder.recordKey({ key: 'ArrowDown' })
    recorder.recordKey({ key: 'ArrowLeft', ctrlKey: true })
    recorder.recordKey({ key: 'ArrowRight', ctrlKey: true })
    recorder.recordKey({ key: 'Home' })
    recorder.recordKey({ key: 'Home', ctrlKey: true })
    recorder.recordKey({ key: 'End', ctrlKey: true })
    recorder.recordKey({ key: 'Backspace' })
    recorder.recordCommand('format:char-props', { bold: true, fontSize: 1200, color: '#112233' })
    recorder.recordCommand('format:para-props', { align: 'justify', lineSpacing: 160 })
    recorder.recordCommand('edit:replace-all', {
      find: 'foo',
      replace: 'bar',
      caseSensitive: true,
    })
    recorder.recordCommand('ext:ieum-toc-refresh')
    recorder.recordCommand('ext:ieum-index-refresh')
    recorder.recordCommand('ext:ieum-bib-refresh-list')
    const stopped = recorder.stop()

    expect(stopped.skipped).toEqual([])
    expect(validateMacroSyntax(stopped.script)).toEqual({ ok: true })
    expect(stopped.script.split('\n')).toEqual([
      'moveLeft();',
      'moveRight();',
      'moveUp();',
      'moveDown();',
      'moveWordLeft();',
      'moveWordRight();',
      'moveParaBegin();',
      'moveDocBegin();',
      'moveDocEnd();',
      'deleteSelection();',
      'setCharFormat({ bold: true, fontSize: 12, color: "#112233" });',
      'setParaFormat({ align: "justify", lineSpacing: 160 });',
      'replaceAll("foo", "bar", { caseSensitive: true });',
      'refreshToc();',
      'refreshIndex();',
      'refreshBibliography();',
    ])
  })

  it('notifies immediately on unsupported commands and accumulates skipped entries without corrupting script', () => {
    const notices: MacroRecorderNotice[] = []
    const recorder = createMacroRecorder({ onNotice: (notice) => notices.push(notice) })
    recorder.start()
    recorder.recordText('앞')
    recorder.recordCommand('edit:undo', undefined, '실행 취소')
    recorder.recordCommand('insert:image', undefined, '그림 넣기')
    recorder.recordText('뒤')
    const stopped = recorder.stop()

    expect(notices).toEqual([
      { kind: 'unsupported_command', commandId: 'edit:undo', label: '실행 취소' },
      { kind: 'unsupported_command', commandId: 'insert:image', label: '그림 넣기' },
    ])
    expect(stopped.skipped).toEqual([
      { commandId: 'edit:undo', label: '실행 취소' },
      { commandId: 'insert:image', label: '그림 넣기' },
    ])
    expect(stopped.script).toBe('insertText("앞뒤");')
    expect(validateMacroSyntax(stopped.script)).toEqual({ ok: true })
  })

  it('notifies mouse_ignored on mouse clicks without adding any steps', () => {
    const notices: MacroRecorderNotice[] = []
    const recorder = createMacroRecorder({ onNotice: (notice) => notices.push(notice) })
    recorder.start()
    expect(recorder.recordMouseMove()).toBe(true)
    const stopped = recorder.stop()

    expect(notices).toEqual([{ kind: 'mouse_ignored' }])
    expect(stopped.stepCount).toBe(0)
    expect(stopped.script).toBe('')
    expect(stopped.skipped).toEqual([])
  })

  it('silently ignores macro self-commands, workpane commands, and easy-words UI actions', () => {
    const notices: MacroRecorderNotice[] = []
    const recorder = createMacroRecorder({ onNotice: (notice) => notices.push(notice) })
    recorder.start()
    recorder.recordCommand('ext:ieum-macro-record-toggle')
    recorder.recordCommand('ext:ieum-macro-manage')
    recorder.recordCommand('ext:ieum-workpane-outline')
    recorder.recordCommand('ext:ieum-workpane-find')
    recorder.recordCommand('ieum:workpane-find')
    recorder.recordCommand('ext:ieum-easy-words')
    const stopped = recorder.stop()

    expect(notices).toEqual([])
    expect(stopped.stepCount).toBe(0)
    expect(stopped.skipped).toEqual([])
    expect(stopped.script).toBe('')
  })
})

function captureDispatchedEvents(eventName: string) {
  const details: unknown[] = []
  const hostGlobal = globalThis as { dispatchEvent?: (event: Event) => boolean }
  const orig = hostGlobal.dispatchEvent
  hostGlobal.dispatchEvent = (event: Event) => {
    if (event.type === eventName) {
      details.push((event as CustomEvent).detail)
    }
    return true
  }
  return {
    details,
    restore: () => {
      if (orig === undefined) {
        delete hostGlobal.dispatchEvent
      } else {
        hostGlobal.dispatchEvent = orig
      }
    },
  }
}

describe('macro slot shortcuts and keyboard dispatcher', () => {
  it('maps Alt+1..9, Alt+0, Alt+- to slots 1..11 and ignores modified or Numpad combos', () => {
    expect(MACRO_SLOT_KEYS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'])
    expect(slotFromAltKey({ altKey: true, code: 'Digit1', key: 'Process' })).toBe(1)
    expect(slotFromAltKey({ altKey: true, code: 'Digit9', key: '9' })).toBe(9)
    expect(slotFromAltKey({ altKey: true, code: 'Digit0', key: 'Process' })).toBe(10)
    expect(slotFromAltKey({ altKey: true, code: 'Minus', key: 'Process' })).toBe(11)
    expect(slotFromAltKey({ altKey: true, key: '5' })).toBe(5)
    expect(slotFromAltKey({ altKey: true, key: '-' })).toBe(11)

    expect(slotFromAltKey({ altKey: true, ctrlKey: true, code: 'Digit1', key: '1' })).toBeNull()
    expect(slotFromAltKey({ altKey: true, shiftKey: true, code: 'Digit1', key: '!' })).toBeNull()
    expect(slotFromAltKey({ altKey: true, metaKey: true, code: 'Digit1', key: '1' })).toBeNull()
    expect(slotFromAltKey({ altKey: false, code: 'Digit1', key: '1' })).toBeNull()
    expect(slotFromAltKey({ altKey: true, code: 'Numpad1', key: '1' })).toBeNull()
  })

  it('dispatches toggle-record, recording-only stop-record, and run-slot via macroShortcutKey', () => {
    const captured = captureDispatchedEvents(MACRO_COMMAND_EVENT)
    try {
      const prevent = vi.fn()
      expect(
        macroShortcutKey({
          altKey: true,
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
          code: 'KeyH',
          key: 'H',
          preventDefault: prevent,
        }),
      ).toBe(true)
      expect(prevent).toHaveBeenCalledTimes(1)

      // Alt+Shift+X does nothing when recording is idle.
      expect(
        macroShortcutKey({
          altKey: true,
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
          code: 'KeyX',
          key: 'X',
          preventDefault: prevent,
        }),
      ).toBe(false)

      // Alt+Shift+X stops recording once a recorder is active.
      const rec = createMacroRecorder()
      rec.start()
      setActiveMacroRecorder(rec)
      expect(isMacroRecordingActive()).toBe(true)
      expect(
        macroShortcutKey({
          altKey: true,
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
          code: 'KeyX',
          key: 'X',
          preventDefault: prevent,
        }),
      ).toBe(true)

      // Alt+0 runs slot 10 and Alt+- runs slot 11.
      expect(
        macroShortcutKey({
          altKey: true,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          code: 'Digit0',
          key: '0',
          preventDefault: prevent,
        }),
      ).toBe(true)
      expect(
        macroShortcutKey({
          altKey: true,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          code: 'Minus',
          key: '-',
          preventDefault: prevent,
        }),
      ).toBe(true)

      expect(captured.details).toEqual([
        { action: 'toggle-record' },
        { action: 'stop-record' },
        { action: 'run-slot', slot: 10 },
        { action: 'run-slot', slot: 11 },
      ])
    } finally {
      captured.restore()
    }
  })
})

describe('Tool-menu wiring, agentPlugin macro surface, and AgentBridge', () => {
  it('installs Tool-menu macro items idempotently and dispatches MACRO_COMMAND_EVENT', () => {
    const doc = makeDoc([''])
    const mock = createMockTransactionHost(doc)
    const captured = captureDispatchedEvents(MACRO_COMMAND_EVENT)
    try {
      expect(
        installMacroMenu(mock.host, { recordToggle: '키 매크로 기록', manage: '매크로 관리...' }),
      ).toEqual({ ok: true })
      expect(mock.menuItems).toEqual([
        { menuId: 'tool', commandId: 'ext:ieum-macro-record-toggle', position: 'bottom' },
        { menuId: 'tool', commandId: 'ext:ieum-macro-manage', position: 'bottom' },
      ])
      expect(mock.commands.get('ext:ieum-macro-record-toggle')?.shortcutLabel).toBe('Alt+Shift+H')

      mock.host.automation.execute('ext:ieum-macro-record-toggle')
      mock.host.automation.execute('ext:ieum-macro-manage')
      expect(captured.details).toEqual([{ action: 'toggle-record' }, { action: 'open-manager' }])
      expect(installMacroMenu({}, { recordToggle: 'A', manage: 'B' })).toEqual({ ok: false })
    } finally {
      captured.restore()
    }
  })

  it('exposes all 6 macro methods on agentPlugin.activate(host) and replays recorded scripts in 1 undo step', () => {
    const doc = makeDoc(['원본'])
    const beforeBytes = doc.exportHwp()
    const mock = createMockTransactionHost(doc)
    const surface = agentPlugin.activate(mock.host as never)

    expect(surface.getMacroRecordingState()).toEqual({
      recording: false,
      stepCount: 0,
      skipped: [],
    })
    expect(surface.validateMacro('insertText("ok");')).toEqual({ ok: true })
    expect(surface.validateMacro('const x = ;').ok).toBe(false)
    expect(
      surface.installMacroMenu({ recordToggle: '매크로 기록', manage: '매크로 관리' }),
    ).toEqual({ ok: true })

    const captured = captureDispatchedEvents(MACRO_RECORDING_EVENT)
    try {
      expect(surface.startMacroRecording()).toEqual({ ok: true, recording: true })
      expect(getActiveMacroRecorder()).not.toBeNull()

      // Simulate studio recording hooks firing while recording is active.
      recordStudioKey({ key: 'End' })
      recordStudioText(' 추가')
      recordStudioCommand('format:bold')
      recordStudioMouseClick()
      recordStudioCommand('insert:image', undefined, 'Image')

      expect(surface.getMacroRecordingState()).toEqual({
        recording: true,
        stepCount: 3,
        skipped: [{ commandId: 'insert:image', label: 'Image' }],
      })

      const stopped = surface.stopMacroRecording()
      expect(stopped.ok).toBe(true)
      expect(stopped.recording).toBe(false)
      expect(stopped.stepCount).toBe(3)
      expect(stopped.skipped).toEqual([{ commandId: 'insert:image', label: 'Image' }])
      expect(stopped.script).toBe(
        ['moveParaEnd();', 'insertText(" 추가");', 'setCharFormat({ bold: true });'].join('\n'),
      )
      expect(getActiveMacroRecorder()).toBeNull()

      expect(captured.details).toEqual([
        { state: 'started' },
        { kind: 'mouse_ignored' },
        { kind: 'unsupported_command', commandId: 'insert:image', label: 'Image' },
        {
          state: 'stopped',
          script: stopped.script,
          stepCount: 3,
          skipped: [{ commandId: 'insert:image', label: 'Image' }],
        },
      ])

      // Replay the recorded script through surface.runMacro in 1 atomic undo step.
      const runRes = surface.runMacro(stopped.script)
      expect(runRes.ok).toBe(true)
      expect(bodyTexts(mock.doc())).toEqual(['원본 추가'])
      expect(mock.undoCount()).toBe(1)
      expect(mock.executedCommands.some((entry) => entry.id === 'ext:ieum-reveal')).toBe(true)

      expect(mock.undoOnce()).toBe(true)
      expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
    } finally {
      captured.restore()
    }
  })

  it('forwards all 6 macro methods through createAgentBridge', async () => {
    const plugins = {
      load: vi.fn(async () => ({})),
      invoke: vi.fn(async (_id: string, method: string, args: unknown[]) => ({ method, args })),
    }
    const editor = { plugins } as unknown as AgentBridgeEditor
    const bridge = createAgentBridge(() => editor)

    await bridge.validateMacro('insertText("x");')
    await bridge.runMacro('insertText("x");', { caret: { sec: 0, para: 0, offset: 0 } })
    await bridge.startMacroRecording()
    await bridge.getMacroRecordingState()
    await bridge.stopMacroRecording()
    await bridge.installMacroMenu({ recordToggle: 'Record', manage: 'Manage' })

    expect(plugins.load).toHaveBeenCalledTimes(1)
    expect(plugins.invoke.mock.calls).toEqual([
      [AGENT_PLUGIN_ID, 'validateMacro', ['insertText("x");']],
      [
        AGENT_PLUGIN_ID,
        'runMacro',
        ['insertText("x");', { caret: { sec: 0, para: 0, offset: 0 } }],
      ],
      [AGENT_PLUGIN_ID, 'startMacroRecording', []],
      [AGENT_PLUGIN_ID, 'getMacroRecordingState', []],
      [AGENT_PLUGIN_ID, 'stopMacroRecording', []],
      [AGENT_PLUGIN_ID, 'installMacroMenu', [{ recordToggle: 'Record', manage: 'Manage' }]],
    ])
  })
})

describe('studio macro recording patches', () => {
  const corePkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'rhwp-core', 'package.json'), 'utf8'),
  ) as { rhwp: { tag: string } }
  const studioRoot = join(
    __dirname,
    '..',
    'node_modules',
    '.cache',
    'rhwp-studio',
    corePkg.rhwp.tag,
    'rhwp-studio',
  )

  const targetFiles = [
    {
      patch: 'studio-macro-record-command',
      rel: join('src', 'command', 'dispatcher.ts'),
      expected: 'recordStudioCommand(commandId, params, def.label);',
    },
    {
      patch: 'studio-macro-record-text',
      rel: join('src', 'engine', 'input-handler-text.ts'),
      expected: 'recordStudioText(text);',
    },
    {
      patch: 'studio-macro-record-key',
      rel: join('src', 'engine', 'input-handler-keyboard.ts'),
      expected: 'if (macroShortcutKey(e)) return;',
    },
    {
      patch: 'studio-macro-record-mouse',
      rel: join('src', 'engine', 'input-handler-mouse.ts'),
      expected: 'if (e.button === 0) recordStudioMouseClick();',
    },
  ] as const

  it('registers all 4 macro recording patches in STUDIO_PATCHES', () => {
    for (const item of targetFiles) {
      expect(STUDIO_PATCHES).toContain(item.patch)
    }
  })

  it.skipIf(!existsSync(studioRoot))(
    'applies cleanly alongside all existing studio patches and transpiles with zero diagnostics',
    () => {
      for (const item of targetFiles) {
        const fullPath = join(studioRoot, item.rel)
        expect(existsSync(fullPath)).toBe(true)
        let source = readFileSync(fullPath, 'utf8')
        for (const patchName of STUDIO_PATCHES) {
          if (patchTargets(patchName, fullPath)) {
            source = applyPatch(patchName, source)
          }
        }
        expect(source).toContain(item.expected)
        const out = ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
          reportDiagnostics: true,
        })
        expect(out.diagnostics ?? []).toEqual([])
      }
    },
  )
})
