// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { LANGS } from '@genoffice/i18n'
import { MARK_PREFIXES, findRangeMarks } from '../studio-plugin/doc-marks.mjs'
import { getStudioModalParts, hancomCommands } from '../studio-plugin/hancom-keys.mjs'
import { addIndexMark, buildIndexBlock, listIndexMarks } from '../studio-plugin/index-marks.mjs'
import { findTocRange, insertTocBlock, readTocMeta } from '../studio-plugin/toc.mjs'
import {
  INDEX_CREATE_COMMAND,
  INDEX_MARK_COMMAND,
  INDEX_REFRESH_COMMAND,
  INDEX_REFRESH_CONTEXT_COMMAND,
  TOC_CREATE_COMMAND,
  TOC_DIALOG_STYLE_ID,
  TOC_INDEX_MENU_ITEMS,
  TOC_REFRESH_COMMAND,
  TOC_REFRESH_CONTEXT_COMMAND,
  installTocDialogStyles,
  installTocIndexMenu,
  isCaretInIndexRange,
  isCaretInTocRange,
  openCreateIndexDialog,
  openCreateTocDialog,
  openMarkIndexDialog,
  runRefreshIndexDialog,
  runRefreshTocDialog,
} from '../studio-plugin/toc-dialogs.mjs'
import { tocDialogLabelsFor, tocStrings } from '../src/renderer/i18n/toc'
import { zh as tocZh } from '../src/renderer/i18n/toc/zh'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** Minimal faithful stand-in for rhwp-studio's `ModalDialog` base class. */
abstract class FakeModalDialog {
  protected overlay!: HTMLDivElement
  protected dialog!: HTMLDivElement
  private title: string
  private width: number

  constructor(title: string, width: number) {
    this.title = title
    this.width = width
  }

  protected abstract createBody(): HTMLElement
  protected abstract onConfirm(): void | boolean

  show(): void {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.dialog = document.createElement('div')
    this.dialog.className = 'dialog-wrap'
    this.dialog.style.width = `${this.width}px`

    const titleBar = document.createElement('div')
    titleBar.className = 'dialog-title'
    titleBar.textContent = this.title
    this.dialog.appendChild(titleBar)

    const body = this.createBody()
    body.classList.add('dialog-body')
    this.dialog.appendChild(body)

    const footer = document.createElement('div')
    footer.className = 'dialog-footer'

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'dialog-btn dialog-btn-primary'
    confirmBtn.textContent = 'OK'
    confirmBtn.addEventListener('click', () => {
      const keep = this.onConfirm()
      if (keep !== false) this.hide()
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'dialog-btn'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => this.hide())

    footer.append(confirmBtn, cancelBtn)
    this.dialog.appendChild(footer)
    this.overlay.appendChild(this.dialog)
    document.body.appendChild(this.overlay)
  }

  hide(): void {
    this.overlay?.remove()
  }
}

function topDialog(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('.dialog-wrap')
  const last = dialogs[dialogs.length - 1]
  if (!last) throw new Error('Expected an open dialog')
  return last
}

function clickConfirm(dialogEl = topDialog()): void {
  const btn = dialogEl.querySelector<HTMLButtonElement>('.dialog-btn-primary')
  if (!btn) throw new Error('Confirm button not found')
  btn.click()
}

function clickCancel(dialogEl = topDialog()): void {
  const btn = dialogEl.querySelector<HTMLButtonElement>('.dialog-btn:not(.dialog-btn-primary)')
  if (!btn) throw new Error('Cancel button not found')
  btn.click()
}

function makeDoc(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

function ensureStyle(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
  const existing = styles.find((s) => s.name === name)
  if (existing) return existing.id
  return doc.createStyle(
    JSON.stringify({
      name,
      englishName: name,
      type: 0,
      nextStyleId: 0,
    }),
  )
}

function makeHeadingDoc(): HwpDocument {
  const doc = makeDoc([
    '서론',
    '첫 번째 본문 문단입니다.',
    '연구 방법',
    '방법에 대한 설명입니다.',
    '결론',
    '마무리 문단입니다.',
  ])
  const h1 = ensureStyle(doc, '제목 1')
  const h2 = ensureStyle(doc, '제목 2')
  doc.applyStyle(0, 0, h1)
  doc.applyStyle(0, 2, h2)
  doc.applyStyle(0, 4, h1)
  return doc
}

function paraText(doc: HwpDocument, sec: number, para: number): string {
  const len = doc.getParagraphLength(sec, para)
  return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
}

function createHost(
  doc: HwpDocument,
  caret: Record<string, unknown> | null = { sectionIndex: 0, parentParaIndex: 0, charOffset: 0 },
) {
  const edits: string[] = []
  const commands = new Map<
    string,
    {
      id: string
      label: string
      opensDialog?: boolean
      canExecute?: (ctx: { hasDocument?: boolean; isFormMode?: boolean }) => boolean
      execute: () => void
    }
  >()
  const menuItems: Array<{ menuId: string; commandId: string; position?: string }> = []

  const host = {
    read: <T>(fn: (d: HwpDocument) => T): T => fn(doc),
    transaction: <T>(label: string, fn: (tx: { doc(): HwpDocument }) => T): T => {
      edits.push(label)
      return fn({ doc: () => doc })
    },
    getCaret: () => caret,
    getSelectionText: () => null as { text: string } | null,
    automation: {
      registerCommand: (def: {
        id: string
        label: string
        opensDialog?: boolean
        canExecute?: (ctx: { hasDocument?: boolean; isFormMode?: boolean }) => boolean
        execute: () => void
      }) => {
        commands.set(def.id, def)
      },
      unregisterCommand: (id: string) => {
        commands.delete(id)
      },
      addMenuItem: (item: { menuId: string; commandId: string; position?: string }) => {
        const idx = menuItems.findIndex(
          (m) => m.menuId === item.menuId && m.commandId === item.commandId,
        )
        if (idx >= 0) menuItems.splice(idx, 1)
        menuItems.push(item)
      },
    },
  }

  return { host, edits, commands, menuItems }
}

describe('Create TOC dialog', () => {
  const koLabels = tocDialogLabelsFor('ko')

  it('creates dotted-tab and table TOCs and auto-updates default title when switching kind', () => {
    const doc = makeHeadingDoc()
    const { host } = createHost(doc)
    const toasts: string[] = []
    const edited: string[] = []

    openCreateTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
      onEdited: (action) => edited.push(action),
    })

    const dlg = topDialog()
    const kindSelect = dlg.querySelector<HTMLSelectElement>('[data-field="kind"]')!
    const titleInput = dlg.querySelector<HTMLInputElement>('[data-field="title"]')!
    const levelRow = dlg.querySelector<HTMLElement>('[data-row="maxLevel"]')!

    expect(titleInput.value).toBe('차례')
    expect(levelRow.hidden).toBe(false)

    // Switching kind updates default title when user has not customized it
    kindSelect.value = 'table'
    kindSelect.dispatchEvent(new Event('change'))
    expect(titleInput.value).toBe('표 차례')
    expect(levelRow.hidden).toBe(true)

    // Switch back to body -> title returns to '차례'
    kindSelect.value = 'body'
    kindSelect.dispatchEvent(new Event('change'))
    expect(titleInput.value).toBe('차례')
    expect(levelRow.hidden).toBe(false)

    clickConfirm(dlg)
    expect(document.querySelector('.dialog-wrap')).toBeNull()
    expect(edited).toEqual(['toc-create'])
    expect(toasts.some((m) => m.includes('3'))).toBe(true)

    const range = findTocRange(doc, 'body')
    expect(range).not.toBeNull()
    expect(readTocMeta(doc, 'body')?.layout).toBe('dotted-tab')

    // Now test borderless table layout on a fresh heading doc
    const doc2 = makeHeadingDoc()
    const { host: host2 } = createHost(doc2)
    openCreateTocDialog(host2, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: () => {},
    })
    const dlg2 = topDialog()
    const layoutSelect = dlg2.querySelector<HTMLSelectElement>('[data-field="layout"]')!
    layoutSelect.value = 'table'
    layoutSelect.dispatchEvent(new Event('change'))
    clickConfirm(dlg2)

    expect(findTocRange(doc2, 'body')).not.toBeNull()
    expect(readTocMeta(doc2, 'body')?.layout).toBe('table')
  })

  it('refuses in_table and no_entries with localized status and toast while keeping dialog open', () => {
    const emptyDoc = makeDoc(['평범한 문단입니다.'])
    const { host } = createHost(emptyDoc)
    const toasts: string[] = []

    openCreateTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })

    clickConfirm()
    // Dialog stays open on refusal
    const dlg = topDialog()
    expect(dlg.querySelector('[data-role="status"]')?.textContent).toBe(koLabels.tocErrorNoHeadings)
    expect(toasts).toContain(koLabels.tocErrorNoHeadings)
    clickCancel(dlg)

    // In-table caret refusal
    const headingDoc = makeHeadingDoc()
    const { host: tableHost } = createHost(headingDoc, {
      sectionIndex: 0,
      parentParaIndex: 0,
      charOffset: 0,
      cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
    })
    const tableToasts: string[] = []
    openCreateTocDialog(tableHost, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => tableToasts.push(message),
    })
    clickConfirm()
    expect(tableToasts).toContain(koLabels.tocErrorInTable)
    clickCancel()
  })

  it('detects legacy TOC, highlights its range, preserves on cancel and replaces on confirm', () => {
    const doc = makeDoc([
      '차례',
      '서론\t1',
      '결론\t2',
      '서론',
      '본문 내용입니다.',
      '결론',
      '끝 내용입니다.',
    ])
    const h1 = ensureStyle(doc, '제목 1')
    doc.applyStyle(0, 3, h1)
    doc.applyStyle(0, 5, h1)

    const { host } = createHost(doc)
    const highlighted: Array<{ sec: number; startPara: number; endPara: number }> = []
    const toasts: string[] = []

    // Attempt 1: cancel -> legacy TOC remains untouched (no `차례:` mark)
    openCreateTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
      highlightRange: (range) => {
        highlighted.push(range)
        return true
      },
    })
    clickConfirm()

    expect(highlighted).toEqual([{ sec: 0, startPara: 0, endPara: 2 }])
    const confirmDlg = topDialog()
    expect(confirmDlg.textContent).toContain(koLabels.tocLegacyConfirmMessage)
    clickCancel(confirmDlg)
    expect(findTocRange(doc, 'body')).toBeNull()
    expect(paraText(doc, 0, 1)).toBe('서론\t1')

    // Attempt 2: confirm -> legacy TOC is replaced with marked TOC
    openCreateTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
      highlightRange: (range) => {
        highlighted.push(range)
        return true
      },
    })
    clickConfirm()
    clickConfirm(topDialog())

    expect(findTocRange(doc, 'body')).not.toBeNull()
    expect(toasts.some((m) => m.includes('2'))).toBe(true)
  })
})

describe('Refresh TOC & manual edit confirmation', () => {
  const koLabels = tocDialogLabelsFor('ko')

  it('shows modified lines on manual edit, preserves on cancel, and overwrites on confirm', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(
      doc,
      { sec: 0, para: 0 },
      { kind: 'body', layout: 'dotted-tab' },
    )
    expect(inserted.ok).toBe(true)
    const range = findTocRange(doc, 'body')!
    // Manually edit the first entry line inside the TOC block
    const entryPara = range.start.para + 1
    const origLine = paraText(doc, 0, entryPara)
    doc.insertText(0, entryPara, 0, '[수동수정] ')
    const editedLine = paraText(doc, 0, entryPara)
    expect(editedLine).not.toBe(origLine)

    const { host } = createHost(doc, {
      sectionIndex: 0,
      parentParaIndex: entryPara,
      charOffset: 0,
    })
    const toasts: string[] = []

    // Cancel preserves the manual edit
    runRefreshTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })
    const dlg1 = topDialog()
    expect(dlg1.querySelector('[data-role="modified-lines"]')?.textContent).toContain('[수동수정]')
    clickCancel(dlg1)
    expect(paraText(doc, 0, entryPara)).toBe(editedLine)

    // Confirm overwrites the manual edit with fresh TOC content
    runRefreshTocDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })
    clickConfirm(topDialog())
    const refreshedRange = findTocRange(doc, 'body')!
    expect(paraText(doc, 0, refreshedRange.start.para + 1)).not.toContain('[수동수정]')
    expect(toasts.some((m) => m.includes('새로 고쳤습니다'))).toBe(true)
  })
})

describe('Mark Index, Create Index, and Refresh Index dialogs', () => {
  const koLabels = tocDialogLabelsFor('ko')

  it('pre-fills word at caret, adds single mark with subTerm, lists existing marks, and deletes live', () => {
    const doc = makeDoc(['인공지능은 현대 연구의 핵심 주제이다.', '기계학습도 중요하다.'])
    const { host } = createHost(doc, { sectionIndex: 0, parentParaIndex: 0, charOffset: 2 })
    const toasts: string[] = []

    openMarkIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })

    const dlg = topDialog()
    const termInput = dlg.querySelector<HTMLInputElement>('[data-field="term"]')!
    const subInput = dlg.querySelector<HTMLInputElement>('[data-field="subTerm"]')!
    expect(termInput.value).toBe('인공지능은')

    termInput.value = '인공지능'
    termInput.dispatchEvent(new Event('input'))
    subInput.value = '개요'
    subInput.dispatchEvent(new Event('input'))

    clickConfirm(dlg)
    expect(listIndexMarks(doc)).toHaveLength(1)
    expect(listIndexMarks(doc)[0]).toMatchObject({ term: '인공지능', subTerm: '개요' })

    // Re-open Mark Index dialog: existing mark appears in list and Delete removes it live
    openMarkIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })
    const dlg2 = topDialog()
    const rows = dlg2.querySelectorAll('.ieum-toc-mark-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('인공지능 › 개요')

    const delBtn = rows[0].querySelector<HTMLButtonElement>('[data-action="delete-mark"]')!
    delBtn.click()

    expect(listIndexMarks(doc)).toHaveLength(0)
    expect(dlg2.querySelectorAll('.ieum-toc-mark-row')).toHaveLength(0)
    expect(dlg2.querySelector('.ieum-toc-empty')?.textContent).toBe(koLabels.indexMarksListEmpty)
    clickCancel(dlg2)
  })

  it('supports mark-all and reports skipped non-body occurrences in tables', () => {
    const doc = makeDoc(['알고리즘 개요', '알고리즘 분석', ''])
    const tbl = JSON.parse(
      doc.createTableEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 2,
          charOffset: 0,
          rowCount: 1,
          colCount: 1,
          treatAsChar: true,
        }),
      ),
    ) as { ok: boolean; controlIdx: number }
    expect(tbl.ok).toBe(true)
    doc.insertTextInCell(0, 2, tbl.controlIdx ?? 0, 0, 0, 0, '알고리즘 표')

    const { host } = createHost(doc, { sectionIndex: 0, parentParaIndex: 0, charOffset: 0 })
    const toasts: string[] = []

    openMarkIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
      selectedText: '알고리즘',
    })

    const dlg = topDialog()
    expect(dlg.querySelector<HTMLInputElement>('[data-field="term"]')?.value).toBe('알고리즘')
    const allBox = dlg.querySelector<HTMLInputElement>('[data-field="markAll"]')!
    allBox.checked = true
    allBox.dispatchEvent(new Event('change'))

    clickConfirm(dlg)
    expect(listIndexMarks(doc)).toHaveLength(2)
    expect(toasts.some((m) => m.includes('2') && m.includes('1'))).toBe(true)
  })

  it('creates index block via dialog and confirms manual edits on refresh', () => {
    const doc = makeDoc(['네트워크 이론', '프로토콜 설계', ''])
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '네트워크' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: '프로토콜' })

    const { host } = createHost(doc, { sectionIndex: 0, parentParaIndex: 2, charOffset: 0 })
    const toasts: string[] = []

    openCreateIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })

    const createDlg = topDialog()
    const colSelect = createDlg.querySelector<HTMLSelectElement>('[data-field="columns"]')!
    expect(colSelect.value).toBe('2')
    colSelect.value = '1'
    colSelect.dispatchEvent(new Event('change'))
    clickConfirm(createDlg)

    const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
    expect(ranges).toHaveLength(1)
    expect(toasts.some((m) => m.includes('2'))).toBe(true)

    // Manually edit a line inside the index block
    const idxRange = ranges[0]
    const editPara = idxRange.start.para + 1
    doc.insertText(idxRange.start.sec, editPara, 0, '[수동] ')
    const manuallyEdited = paraText(doc, idxRange.start.sec, editPara)

    // Refresh Index -> cancel keeps manual edit
    runRefreshIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })
    const confirmDlg = topDialog()
    expect(confirmDlg.querySelector('[data-role="modified-lines"]')?.textContent).toContain(
      '[수동]',
    )
    clickCancel(confirmDlg)
    expect(paraText(doc, idxRange.start.sec, editPara)).toBe(manuallyEdited)

    // Refresh Index -> confirm overwrites manual edit
    runRefreshIndexDialog(host, koLabels, {
      ModalDialog: FakeModalDialog,
      showToast: ({ message }) => toasts.push(message),
    })
    clickConfirm(topDialog())
    const afterRanges = findRangeMarks(doc, [MARK_PREFIXES.indexBlock]).ranges
    expect(afterRanges).toHaveLength(1)
    expect(paraText(doc, afterRanges[0].start.sec, afterRanges[0].start.para + 1)).not.toContain(
      '[수동]',
    )
  })
})

describe('Menu registration, context probes, modal parts, and 22-language i18n', () => {
  it('registers 5 Tool menu items idempotently and evaluates context probes accurately', () => {
    const doc = makeHeadingDoc()
    insertTocBlock(doc, { sec: 0, para: 0 }, { kind: 'body' })
    const tocRange = findTocRange(doc, 'body')!
    addIndexMark(doc, { sec: 0, para: tocRange.end.para + 1, offset: 0 }, { term: '서론' })
    buildIndexBlock(doc, { sec: 0, para: doc.getParagraphCount(0) - 1 }, { columns: 1 })
    const idxRange = findRangeMarks(doc, [MARK_PREFIXES.indexBlock]).ranges[0]

    let currentCaret: Record<string, unknown> = {
      sectionIndex: 0,
      parentParaIndex: tocRange.start.para,
      charOffset: 0,
    }
    const { host, commands, menuItems } = createHost(doc)
    host.getCaret = () => currentCaret

    const koLabels = tocDialogLabelsFor('ko')
    expect(installTocIndexMenu(host, koLabels)).toEqual({ ok: true })
    // Second call with English labels updates cleanly without duplicating Tool menu items
    const enLabels = tocDialogLabelsFor('en')
    expect(installTocIndexMenu(host, enLabels)).toEqual({ ok: true })

    expect(menuItems).toHaveLength(TOC_INDEX_MENU_ITEMS.length)
    expect(menuItems.every((m) => m.menuId === 'tool')).toBe(true)
    expect(menuItems.map((m) => m.commandId)).toEqual([
      TOC_CREATE_COMMAND,
      TOC_REFRESH_COMMAND,
      INDEX_MARK_COMMAND,
      INDEX_CREATE_COMMAND,
      INDEX_REFRESH_COMMAND,
    ])
    expect(commands.get(TOC_CREATE_COMMAND)?.label).toBe(enLabels.tocMenuCreate)

    const ctx = { hasDocument: true, isFormMode: false }
    // Caret inside TOC block: TOC context probe enabled, Index probe disabled
    expect(isCaretInTocRange(doc, currentCaret)).toBe('body')
    expect(isCaretInIndexRange(doc, currentCaret)).toBe(false)
    expect(commands.get(TOC_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(true)
    expect(commands.get(INDEX_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(false)

    // Caret inside Index block: Index context probe enabled, TOC probe disabled
    currentCaret = {
      sectionIndex: idxRange.start.sec,
      parentParaIndex: idxRange.start.para,
      charOffset: 0,
    }
    expect(isCaretInTocRange(doc, currentCaret)).toBeNull()
    expect(isCaretInIndexRange(doc, currentCaret)).toBe(true)
    expect(commands.get(TOC_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(false)
    expect(commands.get(INDEX_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(true)

    // Caret on regular body text: both context refresh probes disabled, Tool menu items still enabled
    currentCaret = {
      sectionIndex: 0,
      parentParaIndex: tocRange.end.para + 1,
      charOffset: 0,
    }
    expect(commands.get(TOC_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(false)
    expect(commands.get(INDEX_REFRESH_CONTEXT_COMMAND)?.canExecute?.(ctx)).toBe(false)
    for (const item of TOC_INDEX_MENU_ITEMS) {
      expect(commands.get(item.id)?.canExecute?.(ctx)).toBe(true)
    }
  })

  it('captures studio ModalDialog and showToast through hancomCommands -> getStudioModalParts', () => {
    const fakeToast = vi.fn()
    hancomCommands('ko', { ModalDialog: FakeModalDialog, showToast: fakeToast })
    const parts = getStudioModalParts()
    expect(parts.ModalDialog).toBe(FakeModalDialog)
    expect(parts.showToast).toBe(fakeToast)
  })

  it('injects dialog layout CSS with zero raw hex/rgb/hsl color literals', () => {
    expect(installTocDialogStyles(document)).toBe(true)
    const style = document.getElementById(TOC_DIALOG_STYLE_ID)
    expect(style).not.toBeNull()
    const css = style?.textContent ?? ''
    expect(css).toContain('var(--ieum-dialog-')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/)
  })

  it('ships complete, vendor-free translations for all UI languages', () => {
    expect(Object.keys(tocStrings)).toHaveLength(LANGS.length)
    const canonicalKeys = Object.keys(tocZh)
    const forbiddenVendorRe = /한컴|hancom|한글\s*20|hangul|ハンコム|韓|韩|microsoft|ms\s*word/i

    for (const lang of LANGS) {
      const bundle = tocDialogLabelsFor(lang)
      expect(Object.keys(bundle).sort()).toEqual([...canonicalKeys].sort())
      for (const [key, value] of Object.entries(bundle)) {
        expect(typeof value, `${lang}.${key}`).toBe('string')
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        expect(value, `${lang}.${key} must not name external vendors`).not.toMatch(
          forbiddenVendorRe,
        )
      }
    }
  })
})
