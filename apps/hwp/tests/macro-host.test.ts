/**
 * Integration tests for the synchronous macro host (`macro-host.mjs`) and
 * compatibility script object (`macro-compat.mjs`) against real `@rhwp/core`
 * WASM documents.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { MAX_INT32 } from '../studio-plugin/macro-interpreter.mjs'
import { REFUSED_COMPAT_ACTIONS, SUPPORTED_COMPAT_ACTIONS } from '../studio-plugin/macro-compat.mjs'
import {
  executeMacroTransaction,
  runMacroOnDocument,
  type MacroTransactionHost,
} from '../studio-plugin/macro-host.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** Create a fresh blank document populated with the given body paragraphs. */
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

/** Read all plain body paragraphs of section 0. */
function bodyTexts(doc: HwpDocument, sec = 0): string[] {
  return Array.from({ length: doc.getParagraphCount(sec) }, (_, para) => {
    const len = doc.getParagraphLength(sec, para)
    return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
  })
}

/** Compare two exported document byte arrays for exact equality. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Transaction host mock matching the studio plugin host contract (single undo step + rollback). */
function createMockHost(initial: HwpDocument) {
  let current = initial
  const undoStack: Uint8Array[] = []
  const labels: string[] = []
  const txOptions: Array<{ foreign?: boolean } | undefined> = []

  const host: MacroTransactionHost = {
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
        labels.push(label)
        txOptions.push(options)
        undoStack.push(before)
        return result
      } catch (err) {
        current = new HwpDocument(before)
        throw err
      }
    },
  }

  return {
    host,
    doc: () => current,
    undoCount: () => undoStack.length,
    labels: () => [...labels],
    txOptions: () => [...txOptions],
    undo(): boolean {
      const prev = undoStack.pop()
      if (!prev) return false
      current = new HwpDocument(prev)
      return true
    },
  }
}

describe('macro-host: application document API', () => {
  it('supports insertText (including newlines), breakPara, breakPage, caret moves, and read helpers', () => {
    const doc = makeDoc(['Alpha beta gamma'])
    const res = runMacroOnDocument(
      doc,
      `
      moveParaEnd();
      insertText(" delta\\nSecond line");
      breakPara();
      insertText("Third line");
      breakPage();
      insertText("Page two");
      moveDocBegin();
      moveRight(6);
      const caretAfterMove = getCaret();
      moveWordRight(1);
      const afterWordRight = getCaret();
      moveWordLeft(1);
      const afterWordLeft = getCaret();
      moveDown(1);
      moveUp(1);
      moveParaBegin();
      moveLineEnd();
      message("paragraphs=" + getParagraphCount());
      message("sections=" + getSectionCount());
      ({
        caretAfterMove,
        afterWordRight,
        afterWordLeft,
        p0: getParagraphText(0, 0),
        p1: doc.getParagraphText(0, 1),
        fullText: getText(),
        styleCount: listStyles().length,
      });
    `,
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changed).toBe(true)
    expect(res.messages).toEqual(['paragraphs=4', 'sections=1'])

    const val = res.value as Record<string, unknown>
    expect(val.caretAfterMove).toEqual({ sec: 0, para: 0, offset: 6 })
    expect(val.afterWordRight).toEqual({ sec: 0, para: 0, offset: 11 })
    expect(val.afterWordLeft).toEqual({ sec: 0, para: 0, offset: 6 })
    expect(val.p0).toBe('Alpha beta gamma delta')
    expect(val.p1).toBe('Second line')
    expect(val.styleCount).toBeGreaterThan(0)

    expect(bodyTexts(doc)).toEqual([
      'Alpha beta gamma delta',
      'Second line',
      'Third line',
      'Page two',
    ])

    const pageTwoProps = JSON.parse(doc.getParaPropertiesAt(0, 3))
    expect(pageTwoProps.pageBreakBefore).toBe(true)
  })

  it('supports select, selectAll, cancelSelection, setCharFormat, setParaFormat, and applyStyle', () => {
    const doc = makeDoc(['Heading sample', 'Body paragraph text'])
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const targetStyle = styles.length > 1 ? styles[1] : styles[0]

    const res = runMacroOnDocument(
      doc,
      `
      select(0, 0, 0, 0, 0, 7);
      const sel = getSelection();
      setCharFormat({
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        fontSize: 16,
        color: "#112233",
      });
      setParaFormat({
        align: "center",
        lineSpacing: 180,
        leftMargin: 10,
        rightMargin: 10,
        firstLineIndent: 12,
        spaceBefore: 6,
        spaceAfter: 8,
      });
      applyStyle(${JSON.stringify(targetStyle.name)});
      cancelSelection();
      const cleared = getSelection();
      selectAll();
      const allSel = getSelection();
      ({ sel, cleared, allSel });
    `,
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as {
      sel: { text: string; startOffset: number; endOffset: number }
      cleared: unknown
      allSel: { text: string }
    }
    expect(val.sel.text).toBe('Heading')
    expect(val.sel.startOffset).toBe(0)
    expect(val.sel.endOffset).toBe(7)
    expect(val.cleared).toBeNull()
    expect(val.allSel.text).toBe('Heading sample\nBody paragraph text')

    const charProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0))
    expect(charProps.bold).toBe(true)
    expect(charProps.italic).toBe(true)
    expect(charProps.underline).toBe(true)
    expect(charProps.strikethrough).toBe(true)
    expect(charProps.fontSize).toBe(1600)
    expect(String(charProps.textColor).toLowerCase()).toBe('#112233')

    const paraProps = JSON.parse(doc.getParaPropertiesAt(0, 0))
    expect(paraProps.alignment).toBe('center')
    expect(paraProps.lineSpacing).toBe(180)

    const appliedStyle = JSON.parse(doc.getStyleAt(0, 0))
    expect(appliedStyle.id).toBe(targetStyle.id)
  })

  it('supports find, replaceNext, replaceAll, and insertTable while preserving table counts', () => {
    const doc = makeDoc(['cat dog cat', 'another cat here'])
    const res = runMacroOnDocument(
      doc,
      `
      const hits = find("cat");
      const first = replaceNext("cat", "fox");
      const rest = replaceAll("cat", "wolf");
      moveDocEnd();
      breakPara();
      const tbl = insertTable(2, 3);
      ({ hitCount: hits.length, first, rest, tbl });
    `,
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as {
      hitCount: number
      first: { replaced: number; found: boolean }
      rest: { replaced: number }
      tbl: { ok: boolean; rows: number; cols: number }
    }
    expect(val.hitCount).toBe(3)
    expect(val.first.replaced).toBe(1)
    expect(val.first.found).toBe(true)
    expect(val.rest.replaced).toBe(2)
    expect(val.tbl.ok).toBe(true)
    expect(val.tbl.rows).toBe(2)
    expect(val.tbl.cols).toBe(3)

    expect(bodyTexts(doc).slice(0, 2)).toEqual(['fox dog wolf', 'another wolf here'])
    const controls = JSON.parse(doc.getControls()) as Array<{ ctrlId: string }>
    expect(controls.filter((c) => c.ctrlId === 'tbl').length).toBe(1)
  })

  it('supports deleteSelection, selection replacement via insertText, fontName formatting, numeric applyStyle, and refreshAll', () => {
    const doc = makeDoc(['Hello world again'])
    const res = runMacroOnDocument(
      doc,
      `
      select(0, 0, 6, 0, 0, 11);
      deleteSelection();
      select(0, 0, 0, 0, 0, 5);
      insertText("Hi");
      selectAll();
      setCharFormat({ fontName: "Batang" });
      applyStyle(0);
      const refreshRes = refreshAll();
      ({ text: getText(), refreshRes });
    `,
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as { text: string; refreshRes: { ok: boolean; refreshed: number } }
    expect(val.text).toBe('Hi  again')
    expect(val.refreshRes).toEqual({ ok: true, refreshed: 0 })

    const charProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0))
    expect(charProps.fontFamily).toBe('Batang')
  })

  it('rejects unknown style names and syntax errors with zero undo steps and byte-identical rollback', () => {
    const doc = makeDoc(['Baseline'])
    const beforeBytes = doc.exportHwp()
    const mock = createMockHost(doc)

    const badStyle = executeMacroTransaction(
      mock.host,
      'insertText("dirty ");\napplyStyle("NonExistentStyleName");',
    )
    expect(badStyle.ok).toBe(false)
    if (!badStyle.ok) {
      expect(badStyle.code).toBe('invalid_argument')
      expect(badStyle.line).toBe(2)
    }
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)

    const syntaxErr = executeMacroTransaction(mock.host, 'const x = ;')
    expect(syntaxErr.ok).toBe(false)
    if (!syntaxErr.ok) {
      expect(syntaxErr.code).toBe('syntax_error')
      expect(syntaxErr.line).toBe(1)
    }
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })

  it('supports changeOutlineLevel on a mapped heading paragraph', () => {
    const doc = makeDoc(['Section Heading'])
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const h1 = styles.find((s) => s.name === '개요 1' || s.name === '제목 1')
    const h2 = styles.find((s) => s.name === '개요 2' || s.name === '제목 2')
    if (!h1 || !h2) return

    doc.applyStyle(0, 0, h1.id)
    const res = runMacroOnDocument(doc, 'changeOutlineLevel(0, 0, 1);', {
      appStyleMap: { [h1.name]: 1, [h2.name]: 2 },
    })
    expect(res.ok).toBe(true)
    const afterStyle = JSON.parse(doc.getStyleAt(0, 0))
    expect(afterStyle.id).toBe(h2.id)
  })
})

describe('macro-host: compatibility object (HAction & HParameterSet)', () => {
  it('exposes expected supported and refused action sets', () => {
    expect(REFUSED_COMPAT_ACTIONS.has('Undo')).toBe(true)
    expect(REFUSED_COMPAT_ACTIONS.has('Redo')).toBe(true)
    expect(SUPPORTED_COMPAT_ACTIONS.has('InsertText')).toBe(true)
    expect(SUPPORTED_COMPAT_ACTIONS.has('TableCreate')).toBe(true)
    expect(SUPPORTED_COMPAT_ACTIONS.has('Undo')).toBe(false)
    expect(SUPPORTED_COMPAT_ACTIONS.has('Redo')).toBe(false)
  })

  it('executes InsertText, BreakPara, BreakPage, CharShape, ParagraphShape, Style, Move*, Select*, Find/Replace, and TableCreate', () => {
    const doc = makeDoc(['old alpha old'])
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const styleName = styles.length > 1 ? styles[1].name : styles[0].name

    const res = runMacroOnDocument(
      doc,
      `
      HAction.Run("MoveDocEnd");
      HAction.GetDefault("InsertText", HParameterSet.HInsertText.HSet);
      HParameterSet.HInsertText.Text = " tail";
      HAction.Execute("InsertText", HParameterSet.HInsertText.HSet);

      HAction.Run("BreakPara");
      HParameterSet.HInsertText.Text = "second old line";
      HAction.Execute("InsertText", HParameterSet.HInsertText.HSet);

      HAction.Run("BreakPage");
      HParameterSet.HInsertText.Text = "third page";
      HAction.Execute("InsertText", HParameterSet.HInsertText.HSet);

      // Select first paragraph via MoveDocBegin + Select + MoveParaEnd
      HAction.Run("MoveDocBegin");
      HAction.Run("Select");
      HAction.Run("MoveParaEnd");
      const selectedFirst = getSelection().text;

      HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
      HParameterSet.HCharShape.Bold = 1;
      HParameterSet.HCharShape.Italic = true;
      HParameterSet.HCharShape.UnderlineType = 1;
      HParameterSet.HCharShape.StrikeoutType = 1;
      HParameterSet.HCharShape.Height = 1400;
      HParameterSet.HCharShape.TextColor = "#aa2200";
      HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);

      HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
      HParameterSet.HParaShape.AlignType = 3; // center
      HParameterSet.HParaShape.LineSpacing = 170;
      HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);

      HAction.GetDefault("Style", HParameterSet.HStyle.HSet);
      HParameterSet.HStyle.StyleName = ${JSON.stringify(styleName)};
      HAction.Execute("Style", HParameterSet.HStyle.HSet);

      HAction.Run("Cancel");
      HAction.Run("MoveDocBegin");

      // FindReplace replaces one occurrence at/after caret
      HAction.GetDefault("FindReplace", HParameterSet.HFindReplace.HSet);
      HParameterSet.HFindReplace.FindString = "old";
      HParameterSet.HFindReplace.ReplaceString = "first";
      const oneRep = HAction.Execute("FindReplace", HParameterSet.HFindReplace.HSet);

      // RepeatFind moves selection to next occurrence
      const foundNext = HAction.Execute("RepeatFind", HParameterSet.HFindReplace.HSet);
      const repeatSel = getSelection();

      // AllReplace replaces remaining occurrences
      HParameterSet.HFindReplace.ReplaceString = "new";
      const allRep = HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);

      // SelectAll then Cancel then TableCreate at doc end
      HAction.Run("SelectAll");
      const allLen = getSelection().text.length;
      HAction.Run("Cancel");
      HAction.Run("MoveDocEnd");
      HAction.Run("BreakPara");
      HAction.GetDefault("TableCreate", HParameterSet.HTableCreation.HSet);
      HParameterSet.HTableCreation.Rows = 2;
      HParameterSet.HTableCreation.Cols = 2;
      HAction.Execute("TableCreate", HParameterSet.HTableCreation.HSet);

      ({ selectedFirst, oneRep, foundNext, repeatSel, allRep, allLen });
    `,
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as {
      selectedFirst: string
      oneRep: { replaced: number }
      foundNext: boolean
      repeatSel: { text: string }
      allRep: { replaced: number }
      allLen: number
    }
    expect(val.selectedFirst).toBe('old alpha old tail')
    expect(val.oneRep.replaced).toBe(1)
    expect(val.foundNext).toBe(true)
    expect(val.repeatSel.text).toBe('old')
    expect(val.allRep.replaced).toBe(2)
    expect(val.allLen).toBeGreaterThan(20)

    expect(bodyTexts(doc).slice(0, 3)).toEqual([
      'first alpha new tail',
      'second new line',
      'third page',
    ])

    const charProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0))
    expect(charProps.bold).toBe(true)
    expect(charProps.italic).toBe(true)
    expect(charProps.fontSize).toBe(1400)
    expect(String(charProps.textColor).toLowerCase()).toBe('#aa2200')

    const paraProps = JSON.parse(doc.getParaPropertiesAt(0, 0))
    expect(paraProps.alignment).toBe('center')
    expect(paraProps.lineSpacing).toBe(170)

    const page3Props = JSON.parse(doc.getParaPropertiesAt(0, 2))
    expect(page3Props.pageBreakBefore).toBe(true)

    const controls = JSON.parse(doc.getControls()) as Array<{ ctrlId: string }>
    expect(controls.filter((c) => c.ctrlId === 'tbl').length).toBe(1)
  })

  it('supports numeric RGB TextColor on CharShape', () => {
    const doc = makeDoc(['Color test'])
    const res = runMacroOnDocument(
      doc,
      `
      HAction.Run("SelectAll");
      HParameterSet.HCharShape.TextColor = 0x336699;
      HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
    `,
    )
    expect(res.ok).toBe(true)
    const charProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0))
    expect(String(charProps.textColor).toLowerCase()).toBe('#336699')
  })
})

describe('macro-host: single undo step and atomic rollback', () => {
  it('commits a multi-step macro as exactly 1 undo step with foreign: true and undoes cleanly', () => {
    const doc = makeDoc(['Original paragraph'])
    const beforeBytes = doc.exportHwp()
    const mock = createMockHost(doc)

    const res = executeMacroTransaction(
      mock.host,
      `
      moveParaEnd();
      insertText(" — step 1");
      breakPara();
      insertText("step 2");
      replaceAll("Original", "Updated");
    `,
    )

    expect(res.ok).toBe(true)
    expect(mock.undoCount()).toBe(1)
    expect(mock.labels()).toEqual(['macro'])
    expect(mock.txOptions()).toEqual([{ foreign: true }])
    expect(bodyTexts(mock.doc())).toEqual(['Updated paragraph — step 1', 'step 2'])

    expect(mock.undo()).toBe(true)
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })

  it.each(['Undo', 'Redo', 'NonExistentAction'])(
    'refuses %s action with exact line/column and rolls back atomically to byte-identical bytes',
    (badAction) => {
      const doc = makeDoc(['Immutable baseline'])
      const beforeBytes = doc.exportHwp()
      const mock = createMockHost(doc)

      const script = [
        'insertText("mutated ");',
        'breakPara();',
        `HAction.Run("${badAction}");`,
      ].join('\n')

      const res = executeMacroTransaction(mock.host, script)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.code).toBe('unsupported_action')
      expect(res.unsupportedAction).toBe(badAction)
      expect(res.error).toContain(badAction)
      expect(res.line).toBe(3)
      expect(res.column).toBeGreaterThanOrEqual(1)
      expect(mock.undoCount()).toBe(0)
      expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
    },
  )

  it('rolls back byte-identically on time limit and step limit', () => {
    const doc1 = makeDoc(['Before timeout'])
    const before1 = doc1.exportHwp()
    let clock = 1000
    const resTime = runMacroOnDocument(
      doc1,
      `
      insertText("changed ");
      for (let i = 0; i < 1000; i++) {
        insertText("x");
      }
    `,
      {
        limits: { maxTimeMs: 50 },
        now: () => {
          clock += 20
          return clock
        },
      },
    )
    expect(resTime.ok).toBe(false)
    if (!resTime.ok) {
      expect(resTime.code).toBe('time_limit')
      expect(resTime.line).toBeGreaterThanOrEqual(2)
    }
    expect(bytesEqual(doc1.exportHwp(), before1)).toBe(true)

    const doc2 = makeDoc(['Before step limit'])
    const before2 = doc2.exportHwp()
    const mock = createMockHost(doc2)
    const resSteps = executeMacroTransaction(
      mock.host,
      `
      insertText("partial ");
      let n = 0;
      while (n < 500) {
        n = n + 1;
      }
    `,
      { limits: { maxSteps: 25 } },
    )
    expect(resSteps.ok).toBe(false)
    if (!resSteps.ok) {
      expect(resSteps.code).toBe('step_limit')
      expect(resSteps.line).toBeGreaterThanOrEqual(3)
    }
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), before2)).toBe(true)
  })
})

describe('macro-host: object and memo protection', () => {
  it('stops with object_loss and line number and rolls back completely when deleting a selection containing a footnote', () => {
    const doc = makeDoc(['Hello world'])
    const fn = JSON.parse(doc.insertFootnote(0, 0, 5)) as { ok: boolean }
    expect(fn.ok).toBe(true)
    const beforeBytes = doc.exportHwp()
    const beforeControls = JSON.parse(doc.getControls()) as Array<{ ctrlId: string }>
    const mock = createMockHost(doc)

    const script = [
      'moveDocEnd();',
      'insertText(" extra");',
      'selectAll();',
      'deleteSelection();',
    ].join('\n')

    const res = executeMacroTransaction(mock.host, script)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('object_loss')
    expect(res.line).toBe(4)
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)

    const afterControls = JSON.parse(mock.doc().getControls()) as Array<{ ctrlId: string }>
    expect(afterControls.filter((c) => c.ctrlId === 'fn').length).toBe(
      beforeControls.filter((c) => c.ctrlId === 'fn').length,
    )
  })

  it('stops with object_loss and rolls back completely when deleting a selection spanning a table', () => {
    const doc = makeDoc(['Lead paragraph', ''])
    const made = JSON.parse(doc.createTable(0, 1, 0, 2, 2)) as { ok: boolean }
    expect(made.ok).toBe(true)
    const beforeBytes = doc.exportHwp()
    const mock = createMockHost(doc)

    const script = ['insertText("prefix ");', 'selectAll();', 'deleteSelection();'].join('\n')

    const res = executeMacroTransaction(mock.host, script)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('object_loss')
    expect(res.line).toBe(3)
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)

    const afterControls = JSON.parse(mock.doc().getControls()) as Array<{ ctrlId: string }>
    expect(afterControls.filter((c) => c.ctrlId === 'tbl').length).toBe(1)
  })

  it('stops with memo_loss and line number and rolls back completely when deleting a selection containing a user memo', () => {
    const doc = makeDoc(['Text with memo anchor inside'])
    const memoRes = JSON.parse(
      doc.insertMemo(0, 0, 10, 14, JSON.stringify({ author: 'reviewer', text: 'keep this memo' })),
    ) as { ok: boolean }
    expect(memoRes.ok).toBe(true)
    const beforeBytes = doc.exportHwp()
    const beforeMemos = JSON.parse(doc.getMemoList()) as unknown[]
    expect(beforeMemos.length).toBe(1)
    const mock = createMockHost(doc)

    const script = [
      'moveDocBegin();',
      'insertText("Prefix ");',
      'selectAll();',
      'deleteSelection();',
    ].join('\n')

    const res = executeMacroTransaction(mock.host, script)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('memo_loss')
    expect(res.line).toBe(4)
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)

    const afterMemos = JSON.parse(mock.doc().getMemoList()) as unknown[]
    expect(afterMemos.length).toBe(1)

    // Replacing a selection that spans a user memo via insertText must also fail with memo_loss.
    const resReplace = executeMacroTransaction(mock.host, 'selectAll();\ninsertText("overwrite");')
    expect(resReplace.ok).toBe(false)
    if (!resReplace.ok) {
      expect(resReplace.code).toBe('memo_loss')
      expect(resReplace.line).toBe(2)
    }
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })
})

describe('macro-host: numeric validation and sandbox isolation', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['float', 1.5],
    ['overflow int32', MAX_INT32 + 1],
  ])(
    'rejects invalid numeric value (%s) on insertTable, TableCreate, moveRight, and limits',
    (_label, bad) => {
      const doc = makeDoc(['Sample text'])
      const beforeBytes = doc.exportHwp()

      const rTable = runMacroOnDocument(doc, `insertTable(${bad}, 2);`)
      expect(rTable.ok).toBe(false)
      if (!rTable.ok) expect(rTable.code).toBe('invalid_argument')
      expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)

      const rCompatTable = runMacroOnDocument(
        doc,
        `
      HParameterSet.HTableCreation.Rows = 2;
      HParameterSet.HTableCreation.Cols = ${bad};
      HAction.Execute("TableCreate", HParameterSet.HTableCreation.HSet);
    `,
      )
      expect(rCompatTable.ok).toBe(false)
      if (!rCompatTable.ok) expect(rCompatTable.code).toBe('invalid_argument')
      expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)

      const rMove = runMacroOnDocument(doc, `moveRight(${bad});`)
      expect(rMove.ok).toBe(false)
      if (!rMove.ok) expect(rMove.code).toBe('invalid_argument')
      expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)

      expect(() => runMacroOnDocument(doc, '1 + 1;', { limits: { maxSteps: bad } })).toThrow(
        RangeError,
      )
      expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)
    },
  )

  it('blocks sandbox escapes through HAction, HParameterSet, and parameter bags', () => {
    const doc = makeDoc(['Safe doc'])
    const attempts = [
      'HAction.constructor;',
      'HAction["__proto__"];',
      'HAction.Execute.constructor;',
      'HParameterSet["__proto__"];',
      'HParameterSet.constructor;',
      'HParameterSet.HInsertText.constructor;',
      'HParameterSet.HInsertText["prototype"];',
      'doc.constructor;',
      'doc.insertText.constructor;',
    ]

    for (const script of attempts) {
      const res = runMacroOnDocument(doc, script)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('forbidden_property')
        expect(res.line).toBe(1)
      }
    }
  })
})
