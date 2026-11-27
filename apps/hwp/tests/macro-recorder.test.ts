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
  hasAssignedMacroSlot,
  isMacroRecordingActive,
  quoteScriptString,
  recordStudioCommand,
  recordStudioKey,
  recordStudioMouseClick,
  recordStudioSlotRun,
  recordStudioText,
  setActiveMacroRecorder,
  setAssignedMacroSlots,
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
  setAssignedMacroSlots([])
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
      fn: (tx: { doc(): HwpDocument; deferPagination(): void; markNoOp(): void }) => T,
      options?: { foreign?: boolean },
    ): T {
      const before = current.exportHwp()
      let noOp = false
      try {
        const result = fn({
          doc: () => current,
          deferPagination: () => {},
          markNoOp: () => {
            noOp = true
          },
        })
        txRecords.push({ label, options })
        if (!noOp) undoStack.push(before)
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
  it('safely quotes special characters, escapes, Unicode separators, and bidi/zero-width chars', () => {
    const tricky =
      'He said "hi" and \'ok\' \\ path\tend\0\u2028\u2029\x07\u200b\u200f\u202e\u2066\u2069'
    const literal = quoteScriptString(tricky)
    expect(literal.startsWith('"') && literal.endsWith('"')).toBe(true)
    expect(literal).toContain('\\u200b')
    expect(literal).toContain('\\u200f')
    expect(literal).toContain('\\u202e')
    expect(literal).toContain('\\u2066')
    expect(literal).toContain('\\u2069')
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
    expect(stopped.script).toContain('moveLineEnd();')
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
    expect(mock.txRecords()[0]).toEqual({ label: 'macro', options: undefined })

    const texts = bodyTexts(mock.doc())
    expect(texts[0]).toBe('제목 문단')
    expect(texts.some((line) => line.includes('본문 내용'))).toBe(true)
    const controls = JSON.parse(mock.doc().getControls()) as Array<{ ctrlId: string }>
    expect(controls.some((c) => c.ctrlId === 'tbl')).toBe(true)

    expect(mock.undoOnce()).toBe(true)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })

  it('translates navigation, selection, backspace/delete, toggle state, char/para props, replace-all, and refresh commands', () => {
    const notices: MacroRecorderNotice[] = []
    const recorder = createMacroRecorder({ onNotice: (notice) => notices.push(notice) })
    recorder.start()
    recorder.recordKey({ key: 'ArrowLeft' })
    recorder.recordKey({ key: 'ArrowRight' })
    recorder.recordKey({ key: 'ArrowUp' })
    recorder.recordKey({ key: 'ArrowDown' })
    recorder.recordKey({ key: 'ArrowLeft', ctrlKey: true })
    recorder.recordKey({ key: 'ArrowRight', ctrlKey: true })
    recorder.recordKey({ key: 'ArrowLeft', shiftKey: true })
    recorder.recordKey({ key: 'ArrowRight', shiftKey: true })
    recorder.recordKey({ key: 'ArrowUp', shiftKey: true })
    recorder.recordKey({ key: 'ArrowDown', shiftKey: true })
    recorder.recordKey({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true })
    recorder.recordKey({ key: 'ArrowRight', ctrlKey: true, shiftKey: true })
    recorder.recordKey({ key: 'Home' })
    recorder.recordKey({ key: 'End' })
    recorder.recordKey({ key: 'Home', shiftKey: true })
    recorder.recordKey({ key: 'End', shiftKey: true })
    recorder.recordKey({ key: 'Home', ctrlKey: true })
    recorder.recordKey({ key: 'End', ctrlKey: true })
    recorder.recordKey({ key: 'Home', ctrlKey: true, shiftKey: true })
    recorder.recordKey({ key: 'End', ctrlKey: true, shiftKey: true })
    recorder.recordKey({ key: 'Backspace' })
    recorder.recordKey({ key: 'Backspace' }, { hadSelection: true })
    recorder.recordKey({ key: 'Delete' })
    recorder.recordKey({ key: 'Delete' }, { hadSelection: true })
    recorder.recordKey({ key: 'Backspace', ctrlKey: true })
    recorder.recordKey({ key: 'Delete', ctrlKey: true })
    recorder.recordKey({ key: 'Enter', shiftKey: true })
    recorder.recordKey({ key: 'Tab' })
    recorder.recordCommand('format:bold', undefined, 'Bold', { bold: true })
    recorder.recordCommand('format:bold', undefined, 'Bold', { bold: false })
    recorder.recordCommand('format:italic', undefined, 'Italic', { italic: false })
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

    expect(stopped.skipped).toEqual([
      { commandId: 'edit:line-break', label: 'Shift+Enter' },
      { commandId: 'edit:tab', label: 'Tab' },
    ])
    expect(notices).toEqual([
      { kind: 'unsupported_command', commandId: 'edit:line-break', label: 'Shift+Enter' },
      { kind: 'unsupported_command', commandId: 'edit:tab', label: 'Tab' },
    ])
    expect(validateMacroSyntax(stopped.script)).toEqual({ ok: true })
    expect(stopped.script.split('\n')).toEqual([
      'moveLeft();',
      'moveRight();',
      'moveUp();',
      'moveDown();',
      'moveWordLeft();',
      'moveWordRight();',
      'selectLeft();',
      'selectRight();',
      'selectUp();',
      'selectDown();',
      'selectWordLeft();',
      'selectWordRight();',
      'moveLineBegin();',
      'moveLineEnd();',
      'selectLineBegin();',
      'selectLineEnd();',
      'moveDocBegin();',
      'moveDocEnd();',
      'selectDocBegin();',
      'selectDocEnd();',
      'deleteBackward();',
      'deleteSelection();',
      'deleteForward();',
      'deleteSelection();',
      'selectWordLeft(); deleteSelection();',
      'selectWordRight(); deleteSelection();',
      'setCharFormat({ bold: true });',
      'setCharFormat({ bold: false });',
      'setCharFormat({ italic: false });',
      'setCharFormat({ bold: true, fontSize: 12, color: "#112233" });',
      'setParaFormat({ align: "justify", lineSpacing: 160 });',
      'replaceAll("foo", "bar", { caseSensitive: true });',
      'refreshToc();',
      'refreshIndex();',
      'refreshBibliography();',
    ])
  })

  it('replays recorded Backspace, Delete, Shift+End+Bold, and toggle-off Bold against real HwpDocument', () => {
    // 1) "abcd", Backspace, "e" -> "abce"
    {
      const rec = createMacroRecorder()
      rec.start()
      rec.recordText('abcd')
      rec.recordKey({ key: 'Backspace' })
      rec.recordText('e')
      const { script } = rec.stop()
      const doc = makeDoc([''])
      const res = runMacroOnDocument(doc, script)
      expect(res.ok).toBe(true)
      expect(bodyTexts(doc)).toEqual(['abce'])
    }

    // 2) "abc", moveLeft, Delete -> "ab"
    {
      const rec = createMacroRecorder()
      rec.start()
      rec.recordText('abc')
      rec.recordKey({ key: 'ArrowLeft' })
      rec.recordKey({ key: 'Delete' })
      const { script } = rec.stop()
      const doc = makeDoc([''])
      const res = runMacroOnDocument(doc, script)
      expect(res.ok).toBe(true)
      expect(bodyTexts(doc)).toEqual(['ab'])
    }

    // 3) "hello world", Shift+End (from offset 6), Ctrl+B -> bolds ONLY "world"
    {
      const rec = createMacroRecorder()
      rec.start()
      rec.recordKey({ key: 'End', shiftKey: true })
      rec.recordCommand('format:bold', undefined, 'Bold', { bold: true })
      const { script } = rec.stop()
      const doc = makeDoc(['hello world'])
      const res = runMacroOnDocument(doc, script, { caret: { sec: 0, para: 0, offset: 6 } })
      expect(res.ok).toBe(true)
      const hProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0)) as { bold?: boolean }
      const wProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 6)) as { bold?: boolean }
      expect(Boolean(hProps.bold)).toBe(false)
      expect(Boolean(wProps.bold)).toBe(true)
    }

    // 4) "plain ", Ctrl+B (on), "bold", Ctrl+B (off), " end" -> bolds ONLY "bold"
    {
      const rec = createMacroRecorder()
      rec.start()
      rec.recordText('plain ')
      rec.recordCommand('format:bold', undefined, 'Bold', { bold: true })
      rec.recordText('bold')
      rec.recordCommand('format:bold', undefined, 'Bold', { bold: false })
      rec.recordText(' end')
      const { script } = rec.stop()
      const doc = makeDoc([''])
      const res = runMacroOnDocument(doc, script)
      expect(res.ok).toBe(true)
      expect(bodyTexts(doc)).toEqual(['plain bold end'])
      const pProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0)) as { bold?: boolean }
      const bProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 6)) as { bold?: boolean }
      const eProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 11)) as { bold?: boolean }
      expect(Boolean(pProps.bold)).toBe(false)
      expect(Boolean(bProps.bold)).toBe(true)
      expect(Boolean(eProps.bold)).toBe(false)
    }
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

      // Alt+0 runs slot 10 and Alt+- runs slot 11 ONLY when assigned.
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit0',
            key: '0',
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(prevent).toHaveBeenCalledTimes(2)

      setAssignedMacroSlots([10, 11])
      expect(hasAssignedMacroSlot(10)).toBe(true)
      expect(hasAssignedMacroSlot(3)).toBe(false)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit0',
            key: '0',
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(true)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Minus',
            key: '-',
            preventDefault: prevent,
          },
          { isMac: false },
        ),
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

  it('guards Mac Option key, IME composing, dialog/input targets, unassigned slots, and emits slot_run_ignored during recording', () => {
    const captured = captureDispatchedEvents(MACRO_COMMAND_EVENT)
    try {
      setAssignedMacroSlots([1, 2])
      const prevent = vi.fn()

      // Mac Option key passes through without preventDefault.
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: '1',
            preventDefault: prevent,
          },
          { isMac: true },
        ),
      ).toBe(false)
      expect(prevent).not.toHaveBeenCalled()

      // IME composing passes through without preventDefault.
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: 'Process',
            isComposing: true,
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: 'Process',
            keyCode: 229,
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(prevent).not.toHaveBeenCalled()

      // Non-editor input and dialog targets pass through.
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: '1',
            target: { tagName: 'INPUT' },
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: '1',
            target: {
              tagName: 'DIV',
              closest: (sel: string) => (sel.includes('[role="dialog"]') ? {} : null),
            },
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit1',
            key: '1',
            target: { tagName: 'TEXTAREA', style: { opacity: '1' } },
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(prevent).not.toHaveBeenCalled()

      // Unassigned slot passes through without preventDefault.
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit5',
            key: '5',
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(false)
      expect(prevent).not.toHaveBeenCalled()

      // Editor hidden textarea + assigned slot works and emits slot_run_ignored while recording.
      const notices: MacroRecorderNotice[] = []
      const rec = createMacroRecorder({ onNotice: (notice) => notices.push(notice) })
      rec.start()
      setActiveMacroRecorder(rec)
      expect(
        macroShortcutKey(
          {
            altKey: true,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            code: 'Digit2',
            key: '2',
            target: { tagName: 'TEXTAREA', style: { opacity: '0' } },
            preventDefault: prevent,
          },
          { isMac: false },
        ),
      ).toBe(true)
      expect(prevent).toHaveBeenCalledTimes(1)
      expect(notices).toEqual([{ kind: 'slot_run_ignored', slot: 2 }])
      expect(rec.getScript()).toBe('')
      expect(captured.details).toEqual([{ action: 'run-slot', slot: 2 }])

      // Direct recordStudioSlotRun helper also emits notice when recording.
      expect(recordStudioSlotRun(4)).toBe(true)
      expect(notices).toEqual([
        { kind: 'slot_run_ignored', slot: 2 },
        { kind: 'slot_run_ignored', slot: 4 },
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

  it('exposes all macro methods on agentPlugin.activate(host) and replays recorded scripts in 1 undo step', async () => {
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
    expect(surface.syncMacroSlots([1, 5, 99, -1])).toEqual({ ok: true, slots: [1, 5] })
    expect(hasAssignedMacroSlot(1)).toBe(true)
    expect(hasAssignedMacroSlot(5)).toBe(true)
    expect(hasAssignedMacroSlot(2)).toBe(false)

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
        ['moveLineEnd();', 'insertText(" 추가");', 'setCharFormat({ bold: true });'].join('\n'),
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
      const foreignBefore = surface.foreignChanges()
      const runRes = await surface.runMacro(stopped.script)
      expect(runRes.ok).toBe(true)
      expect(surface.foreignChanges()).toBe(foreignBefore + 1)
      expect(bodyTexts(mock.doc())).toEqual(['원본 추가'])
      expect(mock.undoCount()).toBe(1)
      expect(mock.executedCommands.some((entry) => entry.id === 'ext:ieum-reveal')).toBe(true)

      expect(mock.undoOnce()).toBe(true)
      expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)

      // No-op macro does NOT increment foreignChanges.
      const noopRes = await surface.runMacro('const n = getParagraphCount(); message(n);')
      expect(noopRes.ok).toBe(true)
      expect(surface.foreignChanges()).toBe(foreignBefore + 1)

      // Failed / rolled-back macro does NOT increment foreignChanges.
      const failRes = await surface.runMacro('insertText("temp"); applyStyle("__missing_style__");')
      expect(failRes.ok).toBe(false)
      expect(surface.foreignChanges()).toBe(foreignBefore + 1)
    } finally {
      captured.restore()
    }
  })

  it('tracks foreignChanges explicitly on mutating macros only (even when host emits document-changed)', async () => {
    const doc = makeDoc(['초기'])
    const listeners: Array<() => void> = []
    const mock = createMockTransactionHost(doc)
    mock.host.events = {
      on(name: string, handler: () => void) {
        if (name === 'document-changed') listeners.push(handler)
      },
    }
    const origTx = mock.host.transaction.bind(mock.host)
    mock.host.transaction = ((label: string, fn: never, options?: { foreign?: boolean }) => {
      const res = origTx(label, fn, options)
      for (const listener of listeners) listener()
      return res
    }) as typeof mock.host.transaction

    const surface = agentPlugin.activate(mock.host as never)
    expect(surface.foreignChanges()).toBe(0)

    // Mutating macro increments foreign by exactly 1 (not 2!).
    const r1 = await surface.runMacro('insertText("A");')
    expect(r1.ok).toBe(true)
    expect(surface.foreignChanges()).toBe(1)

    // No-op macro leaves foreign unchanged AND records 0 undo steps (via tx.markNoOp).
    const undoBeforeNoop = mock.undoCount()
    const r2 = await surface.runMacro('const c = getParagraphCount(); message(c);')
    expect(r2.ok).toBe(true)
    expect(surface.foreignChanges()).toBe(1)
    expect(mock.undoCount()).toBe(undoBeforeNoop)

    // Failed/rolled-back macro leaves foreign unchanged.
    const r3 = await surface.runMacro('insertText("X"); applyStyle("__missing_style__");')
    expect(r3.ok).toBe(false)
    expect(surface.foreignChanges()).toBe(1)
  })

  it('awaits StudioCommandError recovery report before runMacro resolves', async () => {
    const doc = makeDoc(['초기'])
    const mock = createMockTransactionHost(doc)
    let reportSettled = false
    let resolveReport!: (value: { recovery: string }) => void
    const reportPromise = new Promise<{ recovery: string }>((resolve) => {
      resolveReport = resolve
    }).then((payload) => {
      reportSettled = true
      return payload
    })

    const origTx = mock.host.transaction.bind(mock.host)
    mock.host.transaction = ((label: string, fn: never, options?: { foreign?: boolean }) => {
      try {
        return origTx(label, fn, options)
      } catch (cause) {
        const wrapped = Object.assign(new Error('Studio command failed'), {
          cause,
          report: reportPromise,
        })
        throw wrapped
      }
    }) as typeof mock.host.transaction

    const surface = agentPlugin.activate(mock.host as never)
    let finished = false
    const pending = surface
      .runMacro('insertText("temp"); applyStyle("__missing_style__");')
      .then((res) => {
        finished = true
        return res
      })

    // Microtasks flush, but runMacro must stay pending until reportPromise resolves.
    await Promise.resolve()
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(reportSettled).toBe(false)

    resolveReport({ recovery: 'succeeded' })
    const res = await pending
    expect(reportSettled).toBe(true)
    expect(res.ok).toBe(false)
    expect(bodyTexts(mock.doc())).toEqual(['초기'])
  })

  it('rejects runMacro and startMacroRecording when caret is outside body paragraphs (table, textbox, header/footer, note)', async () => {
    const doc = makeDoc(['본문'])
    const mock = createMockTransactionHost(doc)

    // Override automation.execute to inject a fake InputHandler cursor for CARET_POSITION_COMMAND
    let fakeCursor: Record<string, unknown> = {}
    const origExecute = mock.host.automation.execute
    mock.host.automation.execute = (command: string, params?: unknown) => {
      if (command === 'ext:ieum-caret-position') {
        const def = mock.commands.get(command)
        if (def) {
          def.execute({ getInputHandler: () => ({ cursor: fakeCursor }) }, params)
          return { ok: true }
        }
      }
      return origExecute(command, params)
    }

    const surface = agentPlugin.activate(mock.host as never)

    const nonBodyCursors: Array<{ name: string; cursor: Record<string, unknown> }> = [
      { name: 'header/footer', cursor: { isInHeaderFooter: () => true } },
      { name: 'footnote', cursor: { isInFootnote: () => true, fnSectionIdx: 0, fnParaIdx: 0 } },
      {
        name: 'table cell',
        cursor: {
          getPosition: () => ({
            sectionIndex: 0,
            paragraphIndex: 0,
            charOffset: 0,
            parentParaIndex: 0,
            controlIndex: 0,
            cellIndex: 0,
            cellParaIndex: 0,
            cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
          }),
        },
      },
      {
        name: 'text box',
        cursor: {
          getPosition: () => ({
            sectionIndex: 0,
            paragraphIndex: 0,
            charOffset: 0,
            parentParaIndex: 0,
            controlIndex: 0,
            cellIndex: 0,
            cellParaIndex: 0,
            isTextBox: true,
            cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
          }),
        },
      },
    ]

    for (const item of nonBodyCursors) {
      fakeCursor = item.cursor
      const recRes = surface.startMacroRecording()
      expect(recRes, item.name).toMatchObject({
        ok: false,
        recording: false,
        reason: 'unsupported_place',
      })
      expect(isMacroRecordingActive()).toBe(false)

      const runRes = await surface.runMacro('insertText("x");')
      expect(runRes, item.name).toMatchObject({
        ok: false,
        code: 'unsupported_place',
      })
      expect(mock.undoCount()).toBe(0)
    }

    // Body caret is accepted.
    fakeCursor = {
      getPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 }),
    }
    expect(surface.startMacroRecording()).toEqual({ ok: true, recording: true })
    surface.stopMacroRecording()
    const okRun = await surface.runMacro('insertText("!");')
    expect(okRun.ok).toBe(true)
    expect(bodyTexts(mock.doc())).toEqual(['본문!'])
  })

  it('forwards all 7 macro methods through createAgentBridge', async () => {
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
    await bridge.syncMacroSlots([1, 2])

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
      [AGENT_PLUGIN_ID, 'syncMacroSlots', [[1, 2]]],
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
      expected: 'recordStudioCommand(commandId, params, def.label, macroCharState);',
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
    {
      patch: 'studio-macro-error-toast',
      rel: join('src', 'main.ts'),
      expected: "payload.recovery === 'succeeded') return;",
    },
    {
      patch: 'studio-plugin-tx-noop',
      rel: join('src', 'plugin', 'host.ts'),
      expected: 'return noOp ? null : ih.getCursorPosition();',
    },
  ] as const

  it('registers all 6 macro studio patches in STUDIO_PATCHES', () => {
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

  it.skipIf(!existsSync(studioRoot))(
    'hooks Backspace, Delete (with & without selection), Shift+Arrow, Shift+Home/End, Ctrl+Backspace, and Tab in patched input-handler-keyboard.ts',
    () => {
      const kbPath = join(studioRoot, 'src', 'engine', 'input-handler-keyboard.ts')
      let source = readFileSync(kbPath, 'utf8')
      for (const patchName of STUDIO_PATCHES) {
        if (patchTargets(patchName, kbPath)) {
          source = applyPatch(patchName, source)
        }
      }
      // Backspace/Delete captures hadSelection before deleteSelection() and hooks all branches
      const bsIdx = source.indexOf("case 'Backspace':")
      const enterIdx = source.indexOf("case 'Enter':", bsIdx)
      const bsBlock = source.slice(bsIdx, enterIdx)
      expect(bsBlock).toContain('const macroHadSelection = this.cursor.hasSelection();')
      expect(bsBlock).toContain('this.handleBackspace(pos, inCell);')
      expect(bsBlock).toContain('this.handleDelete(pos, inCell);')
      expect(bsBlock).toContain('recordStudioKey(e, { hadSelection: macroHadSelection });')

      // Shift+Home/End & navigation shortcuts hook executeNavigationAction
      expect(source).toContain('recordStudioKey(e, { navigationAction: action });')

      // Shift+Arrow hooks ArrowLeft/Right/Up/Down
      const arrowIdx = source.indexOf("case 'ArrowLeft':")
      const homeIdx = source.indexOf("case 'Home':", arrowIdx)
      const arrowBlock = source.slice(arrowIdx, homeIdx)
      expect(arrowBlock).toContain('recordStudioKey(e);')

      // Tab & Shift+Tab hook recordStudioKey
      const tabIdx = source.indexOf("case 'Tab':")
      const insertIdx = source.indexOf("case 'Insert':", tabIdx)
      const tabBlock = source.slice(tabIdx, insertIdx)
      expect(tabBlock.match(/recordStudioKey\(e\);/g)?.length).toBeGreaterThanOrEqual(2)

      // handleCtrlKey hooks Ctrl+Backspace, Ctrl+Delete, and Ctrl+Arrows
      const ctrlIdx = source.indexOf('export function handleCtrlKey')
      const ctrlBlock = source.slice(ctrlIdx)
      expect(ctrlBlock).toContain("case 'backspace':")
      expect(ctrlBlock).toContain("case 'delete':")
      expect(
        ctrlBlock.match(/recordStudioKey\(e, \{ hadSelection: macroHadSelection \}\);/g)?.length,
      ).toBe(2)
      expect(ctrlBlock).toContain("recordStudioKey(e, { navigationAction: 'lineStart' });")
      expect(ctrlBlock).toContain("recordStudioKey(e, { navigationAction: 'lineEnd' });")
    },
  )
})
