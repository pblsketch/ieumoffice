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
  MAX_MACRO_MESSAGE_LENGTH,
  MAX_MACRO_TOTAL_MESSAGE_CHARS,
  createMacroApi,
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
  const argCounts: number[] = []
  let noOpCalls = 0

  const host: MacroTransactionHost = {
    transaction<T>(
      label: string,
      fn: (tx: { doc(): HwpDocument; deferPagination(): void; markNoOp(): void }) => T,
    ): T {
      argCounts.push(arguments.length)
      const before = current.exportHwp()
      let isNoOp = false
      try {
        const result = fn({
          doc: () => current,
          deferPagination: () => {},
          markNoOp: () => {
            isNoOp = true
            noOpCalls += 1
          },
        })
        labels.push(label)
        if (!isNoOp) {
          undoStack.push(before)
        }
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
    argCounts: () => [...argCounts],
    noOpCalls: () => noOpCalls,
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

  it('supports numeric BGR TextColor, ParameterSet para units, StrikeOutType, FindRegExp, and refuses UseWildCards/RegExp', () => {
    const doc = makeDoc(['Red Blue 1234'])
    const resRed = runMacroOnDocument(
      doc,
      `
      select(0, 0, 0, 0, 0, 3);
      HParameterSet.HCharShape.TextColor = 255; // BGR -> #ff0000
      HParameterSet.HCharShape.StrikeOutType = 1;
      HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);

      select(0, 0, 4, 0, 0, 8);
      HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
      HParameterSet.HCharShape.TextColor = 0xff0000; // BGR -> #0000ff
      HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);

      HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
      HParameterSet.HParaShape.LeftMargin = 2000; // 10 pt
      HParameterSet.HParaShape.PagebreakBefore = 1;
      HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);

      HAction.GetDefault("AllReplace", HParameterSet.HFindReplace.HSet);
      HParameterSet.HFindReplace.FindString = "\\\\d+";
      HParameterSet.HFindReplace.ReplaceString = "NUM";
      HParameterSet.HFindReplace.FindRegExp = true;
      HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);
    `,
    )
    expect(resRed.ok).toBe(true)
    const redProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 0))
    expect(String(redProps.textColor).toLowerCase()).toBe('#ff0000')
    expect(redProps.strikethrough).toBe(true)
    const blueProps = JSON.parse(doc.getCharPropertiesAt(0, 0, 5))
    expect(String(blueProps.textColor).toLowerCase()).toBe('#0000ff')

    const paraProps = JSON.parse(doc.getParaPropertiesAt(0, 0))
    // 2000 HWPUNITs = 10 pt = 13.3 px (at 96/72 dpi)
    expect(paraProps.marginLeft).toBeCloseTo(13.3, 1)
    expect(paraProps.pageBreakBefore).toBe(true)
    expect(bodyTexts(doc)[0]).toBe('Red Blue NUM')

    // Refuse UseWildCards when truthy
    const wildRes = runMacroOnDocument(
      doc,
      `
      HAction.GetDefault("AllReplace", HParameterSet.HFindReplace.HSet);
      HParameterSet.HFindReplace.FindString = "Red*";
      HParameterSet.HFindReplace.ReplaceString = "X";
      HParameterSet.HFindReplace.UseWildCards = true;
      HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);
    `,
    )
    expect(wildRes.ok).toBe(false)
    if (!wildRes.ok) {
      expect(wildRes.code).toBe('unsupported_action')
      expect(wildRes.error).toContain('UseWildCards')
    }

    // Refuse legacy RegExp key when truthy and guide caller to FindRegExp
    const regExpRes = runMacroOnDocument(
      doc,
      `
      HAction.GetDefault("AllReplace", HParameterSet.HFindReplace.HSet);
      HParameterSet.HFindReplace.FindString = "NUM";
      HParameterSet.HFindReplace.ReplaceString = "Y";
      HParameterSet.HFindReplace.RegExp = true;
      HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);
    `,
    )
    expect(regExpRes.ok).toBe(false)
    if (!regExpRes.ok) {
      expect(regExpRes.code).toBe('invalid_argument')
      expect(regExpRes.error).toContain('RegExp')
      expect(regExpRes.error).toContain('FindRegExp')
    }
  })
})

describe('macro-host: single undo step and atomic rollback', () => {
  it('commits a multi-step macro as exactly 1 undo step with 2-arg transaction, marks no-ops, and undoes cleanly', () => {
    const doc = makeDoc(['Original paragraph'])
    const beforeBytes = doc.exportHwp()
    const mock = createMockHost(doc)

    // Read-only macro marks no-op and records 0 undo steps.
    const readOnly = executeMacroTransaction(mock.host, 'const t = getText(); t.length;')
    expect(readOnly.ok).toBe(true)
    if (readOnly.ok) expect(readOnly.changed).toBe(false)
    expect(mock.argCounts()).toEqual([2])
    expect(mock.noOpCalls()).toBe(1)
    expect(mock.undoCount()).toBe(0)

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
    expect(mock.labels()).toEqual(['macro', 'macro'])
    expect(mock.argCounts()).toEqual([2, 2])
    expect(mock.noOpCalls()).toBe(1)
    expect(bodyTexts(mock.doc())).toEqual(['Updated paragraph — step 1', 'step 2'])

    expect(mock.undo()).toBe(true)
    expect(mock.undoCount()).toBe(0)
    expect(bytesEqual(mock.doc().exportHwp(), beforeBytes)).toBe(true)
  })

  it('preserves exact failure fields across StudioCommandError-shaped wrapping and invokes onRecoveryReport', async () => {
    const doc = makeDoc(['Immutable baseline'])
    const beforeBytes = doc.exportHwp()
    let current = doc
    const recoveryPayload = { recovered: true, reason: 'rollback_ok' }
    const reportPromise = Promise.resolve(recoveryPayload)
    const receivedReports: Array<Promise<unknown>> = []

    const wrappingHost: MacroTransactionHost = {
      transaction<T>(_label: string, fn: (tx: { doc(): HwpDocument }) => T): T {
        const before = current.exportHwp()
        try {
          return fn({ doc: () => current })
        } catch (err) {
          current = new HwpDocument(before)
          const wrapped = new Error('Studio 편집 명령을 완료하지 못했습니다.') as Error & {
            cause?: unknown
            report?: Promise<unknown>
          }
          wrapped.cause = err
          wrapped.report = reportPromise
          throw wrapped
        }
      },
    }

    const res = executeMacroTransaction(
      wrappingHost,
      'message("before fail");\ninsertText("temp ");\nHAction.Run("FileSave");',
      {
        onRecoveryReport: (report) => {
          receivedReports.push(report)
        },
      },
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('unsupported_action')
      expect(res.unsupportedAction).toBe('FileSave')
      expect(res.error).toContain('FileSave')
      expect(res.line).toBe(3)
      expect(res.column).toBe(12)
      expect(res.messages).toEqual(['before fail'])
    }
    expect(receivedReports).toHaveLength(1)
    expect(await receivedReports[0]).toEqual(recoveryPayload)
    expect(bytesEqual(current.exportHwp(), beforeBytes)).toBe(true)
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

describe('macro-host: S1/S5/S6/B2/N1/N9 behavioral and safety guarantees', () => {
  it('pending setCharFormat without selection styles only newly inserted text', () => {
    const doc = makeDoc([''])
    const res = runMacroOnDocument(
      doc,
      `
      insertText("plain ");
      setCharFormat({ bold: true });
      insertText("bold");
      setCharFormat({ bold: false });
      insertText(" normal");
    `,
    )
    expect(res.ok).toBe(true)
    expect(bodyTexts(doc)).toEqual(['plain bold normal'])
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 0)).bold).toBe(false)
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 7)).bold).toBe(true)
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 12)).bold).toBe(false)

    // setCharFormat alone without selection is a no-op (changed === false) and clears on caret move.
    const doc2 = makeDoc(['abc'])
    const noOp = runMacroOnDocument(doc2, 'setCharFormat({ bold: true });')
    expect(noOp.ok).toBe(true)
    if (noOp.ok) expect(noOp.changed).toBe(false)
    expect(JSON.parse(doc2.getCharPropertiesAt(0, 0, 0)).bold).toBe(false)

    const moveClear = runMacroOnDocument(
      doc2,
      'setCharFormat({ bold: true }); moveRight(1); insertText("Z");',
    )
    expect(moveClear.ok).toBe(true)
    expect(bodyTexts(doc2)).toEqual(['aZbc'])
    expect(JSON.parse(doc2.getCharPropertiesAt(0, 0, 1)).bold).toBe(false)
  })

  it('supports deleteBackward, deleteForward, and select* movement extensions with protection', () => {
    const doc = makeDoc(['Hello', 'World'])
    const res = runMacroOnDocument(
      doc,
      `
      moveParaEnd();
      deleteBackward(2); // "Hel"
      deleteForward(1);  // merges "World" -> "HelWorld"
      selectRight(5);    // selects "World"
      const sel1 = getSelection();
      deleteForward(1);  // deletes selection -> "Hel"
      selectParaBegin();
      const sel2 = getSelection();
      cancelSelection();
      moveDocBegin();
      selectWordRight(1);
      const sel3 = getSelection();
      ({ sel1, sel2, sel3 });
    `,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as {
      sel1: { text: string }
      sel2: { text: string }
      sel3: { text: string }
    }
    expect(val.sel1.text).toBe('World')
    expect(val.sel2.text).toBe('Hel')
    expect(val.sel3.text).toBe('Hel')
    expect(bodyTexts(doc)).toEqual(['Hel'])

    // deleteBackward must refuse removing a footnote and roll back byte-identically.
    const fnDoc = makeDoc(['ab'])
    fnDoc.insertFootnote(0, 0, 1)
    const beforeBytes = fnDoc.exportHwp()
    const delFn = runMacroOnDocument(fnDoc, 'selectAll(); deleteBackward();')
    expect(delFn.ok).toBe(false)
    if (!delFn.ok) expect(delFn.code).toBe('object_loss')
    expect(bytesEqual(fnDoc.exportHwp(), beforeBytes)).toBe(true)
  })

  it('moves by real visual lines in wrapped paragraphs for moveLineEnd, moveLineBegin, moveDown, and moveUp', () => {
    const longPara = 'word '.repeat(80)
    const doc = makeDoc([longPara, 'next'])
    const line0 = JSON.parse(doc.getLineInfo(0, 0, 0)) as {
      lineIndex: number
      lineCount: number
      charStart: number
      charEnd: number
    }
    expect(line0.lineCount).toBeGreaterThan(1)

    const res = runMacroOnDocument(
      doc,
      `
      moveLineEnd();
      const endPos = getCaret();
      moveLineEnd(); // repeating stays on line 0 end
      const endPos2 = getCaret();
      moveLineBegin(); // returns to line 0 start
      const startPos = getCaret();
      moveDown(1); // moves to visual line 1 inside paragraph 0, NOT paragraph 1
      const line1Pos = getCaret();
      moveUp(1);
      const backToLine0 = getCaret();
      ({ endPos, endPos2, startPos, line1Pos, backToLine0 });
    `,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const val = res.value as {
      endPos: { para: number; offset: number }
      endPos2: { para: number; offset: number }
      startPos: { para: number; offset: number }
      line1Pos: { para: number; offset: number }
      backToLine0: { para: number; offset: number }
    }
    expect(val.endPos).toEqual({ sec: 0, para: 0, offset: line0.charEnd })
    expect(val.endPos2).toEqual({ sec: 0, para: 0, offset: line0.charEnd })
    expect(val.startPos).toEqual({ sec: 0, para: 0, offset: 0 })
    expect(val.line1Pos.para).toBe(0)
    expect(val.line1Pos.offset).toBe(line0.charEnd)
    expect(val.backToLine0).toEqual({ sec: 0, para: 0, offset: 0 })
  })

  it('executes ordinary and ReDoS regexes linearly via Thompson NFA, expands $1 captures, and refuses unsupported features', () => {
    // Ordinary regexes including alternation under quantifier and nested optional patterns
    const doc = makeDoc(['제 3 장  foo&nbsp; bar 2024-11 abc 12.5 Ab Cd x@y.com'])
    for (const [pat, minHits] of [
      ['(\\s|&nbsp;)+', 1],
      ['(\\w+\\s?)+', 1],
      ['(\\r?\\n)+', 0],
      ['(\\d{4})-(\\d{2})', 1],
      ['[가-힣]+', 1],
      ['(제|第)\\s*\\d+\\s*(장|절)', 1],
      ['[a+]+', 1],
    ] as const) {
      const r = runMacroOnDocument(doc, `find(${JSON.stringify(pat)}, { regex: true }).length;`)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value as number).toBeGreaterThanOrEqual(minHits)
      }
    }

    // $1/$2 capture expansion in replaceAll and replaceNext
    const capDoc = makeDoc(['2024-11 and 2025-03'])
    const capRes = runMacroOnDocument(
      capDoc,
      `
      const first = replaceNext("(\\\\d{4})-(\\\\d{2})", "$2/$1", { regex: true });
      const rest = replaceAll("(\\\\d{4})-(\\\\d{2})", "$2.$1", { regex: true });
      ({ first, rest });
    `,
    )
    expect(capRes.ok).toBe(true)
    expect(bodyTexts(capDoc)).toEqual(['11/2024 and 03.2025'])

    // ReDoS patterns complete linearly in <500ms on 3,000 chars
    const longDoc = makeDoc(['a'.repeat(3000)])
    const longBangDoc = makeDoc(['a'.repeat(3000) + '!'])
    for (const [targetDoc, redosPat] of [
      [longDoc, '\\w*-?\\w*-?\\w*!'],
      [longDoc, '\\w*\\s?\\w*!'],
      [longBangDoc, '(a+)+$'],
    ] as const) {
      const t0 = Date.now()
      const r = runMacroOnDocument(
        targetDoc,
        `find(${JSON.stringify(redosPat)}, { regex: true }).length;`,
        { limits: { maxTimeMs: 1000 } },
      )
      expect(Date.now() - t0).toBeLessThan(500)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value).toBe(0)
      }
    }

    // Backreferences, lookarounds, and oversized patterns are refused with invalid_argument
    const checkDoc = makeDoc(['aaab'])
    for (const unsupported of [
      '(a)\\1',
      '(?=a)a',
      '(?!a)a',
      '(?<=a)b',
      '(?<!a)b',
      'a'.repeat(300),
    ]) {
      const r = runMacroOnDocument(
        checkDoc,
        `find(${JSON.stringify(unsupported)}, { regex: true });`,
      )
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('invalid_argument')
      }
    }
  })

  it('batches 3,600 replaceAll edits fast, preserves mixed char formatting, and rolls back on timeout', () => {
    const bulkDoc = makeDoc(Array.from({ length: 60 }, () => 'ab '.repeat(60)))
    const t0 = Date.now()
    const bulkRes = runMacroOnDocument(bulkDoc, 'replaceAll("ab", "abc").replaced;')
    expect(Date.now() - t0).toBeLessThan(500)
    expect(bulkRes.ok).toBe(true)
    if (bulkRes.ok) {
      expect(bulkRes.value).toBe(3600)
    }
    expect(bodyTexts(bulkDoc)[0]).toBe('abc '.repeat(60))

    // Mixed char formatting within the same paragraph is preserved across batched replaceAll
    const fmtDoc = makeDoc(['ab ab cd ab ab'])
    fmtDoc.applyCharFormat(0, 0, 0, 5, JSON.stringify({ bold: true }))
    fmtDoc.applyCharFormat(0, 0, 6, 14, JSON.stringify({ italic: true }))
    const fmtRes = runMacroOnDocument(fmtDoc, 'replaceAll("ab", "XY").replaced;')
    expect(fmtRes.ok).toBe(true)
    if (fmtRes.ok) expect(fmtRes.value).toBe(4)
    expect(bodyTexts(fmtDoc)).toEqual(['XY XY cd XY XY'])
    expect(JSON.parse(fmtDoc.getCharPropertiesAt(0, 0, 0)).bold).toBe(true)
    expect(JSON.parse(fmtDoc.getCharPropertiesAt(0, 0, 3)).bold).toBe(true)
    expect(JSON.parse(fmtDoc.getCharPropertiesAt(0, 0, 9)).italic).toBe(true)
    expect(JSON.parse(fmtDoc.getCharPropertiesAt(0, 0, 9)).bold).toBe(false)

    // Tight timeout during replaceAll aborts cleanly with time_limit and byte-identical rollback
    const timeoutDoc = makeDoc(Array.from({ length: 60 }, () => 'ab '.repeat(60)))
    const beforeBytes = timeoutDoc.exportHwp()
    let clock = 1000
    const timeoutRes = runMacroOnDocument(timeoutDoc, 'replaceAll("ab", "abc");', {
      limits: { maxTimeMs: 1 },
      now: () => {
        clock += 1
        return clock
      },
    })
    expect(timeoutRes.ok).toBe(false)
    if (!timeoutRes.ok) {
      expect(timeoutRes.code).toBe('time_limit')
    }
    expect(bytesEqual(timeoutDoc.exportHwp(), beforeBytes)).toBe(true)
  })

  it('enforces URC even integers and refuses odd URC values and non-Percent LineSpacingType on HParaShape', () => {
    const doc = makeDoc(['Paragraph text'])
    const okRes = runMacroOnDocument(
      doc,
      `
      HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
      HParameterSet.HParaShape.LeftMargin = 10000; // 50 pt
      HParameterSet.HParaShape.Indentation = -2000; // -10 pt
      HParameterSet.HParaShape.PrevSpacing = 1200; // 6 pt
      HParameterSet.HParaShape.NextSpacing = 1600; // 8 pt
      HParameterSet.HParaShape.LineSpacingType = 0; // Percent
      HParameterSet.HParaShape.LineSpacing = 160;
      HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);
    `,
    )
    expect(okRes.ok).toBe(true)

    const beforeBytes = doc.exportHwp()
    for (const [field, val] of [
      ['LeftMargin', 2001],
      ['RightMargin', 1],
      ['Indentation', -1001],
      ['PrevSpacing', 3],
      ['NextSpacing', 99],
    ] as const) {
      const oddRes = runMacroOnDocument(
        doc,
        `
        HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
        HParameterSet.HParaShape.${field} = ${val};
        HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);
      `,
      )
      expect(oddRes.ok).toBe(false)
      if (!oddRes.ok) {
        expect(oddRes.code).toBe('invalid_argument')
        expect(oddRes.error).toContain(field)
      }
      expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)
    }

    const fixedSpacingRes = runMacroOnDocument(
      doc,
      `
      HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
      HParameterSet.HParaShape.LineSpacingType = 1;
      HParameterSet.HParaShape.LineSpacing = 2000;
      HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);
    `,
    )
    expect(fixedSpacingRes.ok).toBe(false)
    if (!fixedSpacingRes.ok) {
      expect(fixedSpacingRes.code).toBe('unsupported_action')
      expect(fixedSpacingRes.unsupportedAction).toBe('LineSpacingType')
    }
    expect(bytesEqual(doc.exportHwp(), beforeBytes)).toBe(true)
  })

  it('extends selectDown to end on last line and selectUp to start on first line without changing moveDown/moveUp', () => {
    const d1 = makeDoc(['abc'])
    const r1 = runMacroOnDocument(d1, 'selectDown(); deleteSelection();')
    expect(r1.ok).toBe(true)
    expect(bodyTexts(d1)).toEqual([''])

    const d2 = makeDoc(['abcdef'])
    const r2 = runMacroOnDocument(d2, 'moveParaEnd(); selectUp(); getSelection().text;')
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.value).toBe('abcdef')

    // Plain moveDown on last line and moveUp on first line do not jump to line edges.
    const d3 = makeDoc(['abcdef'])
    const r3 = runMacroOnDocument(
      d3,
      'moveRight(2); moveDown(); const c1 = getCaret().offset; moveUp(); const c2 = getCaret().offset; [c1, c2];',
    )
    expect(r3.ok).toBe(true)
    if (r3.ok) expect(r3.value).toEqual([2, 2])
  })

  it('matches engine deletion semantics for footnotes and protects tables on deleteForward and deleteBackward', () => {
    // Footnote at offset 3 in "abcdef": single-char DEL at 3 and BS at 4 delete 'd' while
    // keeping the footnote at offset 3 (matching engine deleteText(0, 1, 3, 1)); BS at 3
    // deletes 'c'; multi-char deletion crossing offset 3 refuses object_loss and rolls back.
    for (const [offset, script] of [
      [3, 'deleteForward();'],
      [4, 'deleteBackward();'],
    ] as const) {
      const fnDoc = makeDoc(['first', 'abcdef'])
      fnDoc.insertFootnote(0, 1, 3)
      const fnRes = runMacroOnDocument(fnDoc, script, {
        caret: { sec: 0, para: 1, offset },
      })
      expect(fnRes.ok).toBe(true)
      expect(bodyTexts(fnDoc)).toEqual(['first', 'abcef'])
      const ctrls = JSON.parse(fnDoc.getControls()) as Array<{ ctrlId: string }>
      expect(ctrls.filter((c) => c.ctrlId === 'fn')).toHaveLength(1)
      expect(JSON.parse(fnDoc.getControlTextPositions(0, 1))).toEqual([3])
    }

    // Backspace at offset 3 deletes 'c' before the footnote while keeping the footnote intact.
    const fnSafeDoc = makeDoc(['first', 'abcdef'])
    fnSafeDoc.insertFootnote(0, 1, 3)
    const fnSafeRes = runMacroOnDocument(fnSafeDoc, 'deleteBackward();', {
      caret: { sec: 0, para: 1, offset: 3 },
    })
    expect(fnSafeRes.ok).toBe(true)
    expect(bodyTexts(fnSafeDoc)).toEqual(['first', 'abdef'])
    const safeCtrls = JSON.parse(fnSafeDoc.getControls()) as Array<{ ctrlId: string }>
    expect(safeCtrls.filter((c) => c.ctrlId === 'fn')).toHaveLength(1)

    // Multi-char deletion strictly crossing a footnote refuses with object_loss and rolls back.
    const fnSpanDoc = makeDoc(['first', 'abcdef'])
    fnSpanDoc.insertFootnote(0, 1, 3)
    const fnSpanBefore = fnSpanDoc.exportHwp()
    const fnSpanRes = runMacroOnDocument(fnSpanDoc, 'deleteForward(2);', {
      caret: { sec: 0, para: 1, offset: 2 },
    })
    expect(fnSpanRes.ok).toBe(false)
    if (!fnSpanRes.ok) expect(fnSpanRes.code).toBe('object_loss')
    expect(bytesEqual(fnSpanDoc.exportHwp(), fnSpanBefore)).toBe(true)

    // Pure paragraph-boundary merge with a footnote at end of para 0 or start of para 1 keeps the footnote.
    for (const [fnPara, fnOffset, caret, script] of [
      [0, 5, { sec: 0, para: 1, offset: 0 }, 'deleteBackward();'],
      [0, 5, { sec: 0, para: 0, offset: 5 }, 'deleteForward();'],
      [1, 0, { sec: 0, para: 1, offset: 0 }, 'deleteBackward();'],
      [1, 0, { sec: 0, para: 0, offset: 5 }, 'deleteForward();'],
    ] as const) {
      const mergeDoc = makeDoc(['first', 'second'])
      mergeDoc.insertFootnote(0, fnPara, fnOffset)
      const mergeRes = runMacroOnDocument(mergeDoc, script, { caret })
      expect(mergeRes.ok).toBe(true)
      expect(bodyTexts(mergeDoc)).toEqual(['firstsecond'])
      const mergeCtrls = JSON.parse(mergeDoc.getControls()) as Array<{ ctrlId: string }>
      expect(mergeCtrls.filter((c) => c.ctrlId === 'fn')).toHaveLength(1)
    }

    // Table boundary protection on deleteForward before table and deleteBackward crossing table.
    const tblDoc = makeDoc(['hello', 'after'])
    runMacroOnDocument(tblDoc, 'moveParaEnd(); insertTable(2, 2);')
    const tblBefore = tblDoc.exportHwp()
    const delBeforeTbl = runMacroOnDocument(tblDoc, 'deleteForward(3);', {
      caret: { sec: 0, para: 0, offset: 5 },
    })
    expect(delBeforeTbl.ok).toBe(false)
    if (!delBeforeTbl.ok) expect(delBeforeTbl.code).toBe('object_loss')
    expect(bytesEqual(tblDoc.exportHwp(), tblBefore)).toBe(true)

    const lastPara = tblDoc.getParagraphCount(0) - 1
    const bsAcrossTbl = runMacroOnDocument(tblDoc, 'deleteBackward(5);', {
      caret: { sec: 0, para: lastPara, offset: 0 },
    })
    expect(bsAcrossTbl.ok).toBe(false)
    if (!bsAcrossTbl.ok) expect(bsAcrossTbl.code).toBe('object_loss')
    expect(bytesEqual(tblDoc.exportHwp(), tblBefore)).toBe(true)
  })

  it('enforces insertText per-call and cumulative limits and fast linear moveWordRight', () => {
    const doc = makeDoc(['start'])
    const before = doc.exportHwp()

    const perCall = runMacroOnDocument(doc, `insertText("x".repeat(60000));`)
    expect(perCall.ok).toBe(false)
    if (!perCall.ok) expect(perCall.code).toBe('memory_limit')
    expect(bytesEqual(doc.exportHwp(), before)).toBe(true)

    const cumulative = runMacroOnDocument(
      doc,
      `var chunk = "x".repeat(400); for (var i = 0; i < 6; i++) { insertText(chunk); }`,
      { limits: { maxTotalInsertChars: 1500 } },
    )
    expect(cumulative.ok).toBe(false)
    if (!cumulative.ok) expect(cumulative.code).toBe('memory_limit')
    expect(bytesEqual(doc.exportHwp(), before)).toBe(true)

    const wordDoc = makeDoc(['a '.repeat(2000)])
    const t0 = Date.now()
    const wordRes = runMacroOnDocument(
      wordDoc,
      'moveDocBegin(); moveWordRight(2147483647); getCaret().offset;',
    )
    expect(Date.now() - t0).toBeLessThan(200)
    expect(wordRes.ok).toBe(true)
    if (wordRes.ok) expect(wordRes.value).toBe(4000)
  })

  it('truncates per-message length to 500 chars and caps cumulative message text to 4000 chars', () => {
    const doc = makeDoc(['x'])
    const res = runMacroOnDocument(
      doc,
      `
      var s = "a".repeat(2000);
      for (var i = 0; i < 50; i++) {
        message(s);
      }
      1;
    `,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.messages.length).toBeGreaterThan(0)
    let total = 0
    for (const m of res.messages) {
      expect(m.length).toBeLessThanOrEqual(MAX_MACRO_MESSAGE_LENGTH)
      expect(m.endsWith('…')).toBe(true)
      total += m.length
    }
    expect(total).toBeLessThanOrEqual(MAX_MACRO_TOTAL_MESSAGE_CHARS)
  })

  it('reports line: null, column: null, phase: post_run when post-run deadline check fails', () => {
    const doc = makeDoc(['x'])
    let calls = 0
    const res = runMacroOnDocument(doc, '1;', {
      limits: { maxTimeMs: 10 },
      now: () => {
        calls += 1
        // Stay within budget during parse/eval (calls 1..3), jump past deadline on post-run check (call 4).
        return calls <= 3 ? 1000 : 2000
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('time_limit')
      expect(res.line).toBeNull()
      expect(res.column).toBeNull()
      expect(res.phase).toBe('post_run')
    }
  })

  it('tags regex time_limit and step_limit failures with detail: regex and rolls back atomically (T4)', () => {
    const timeDoc = makeDoc(['a'.repeat(5000)])
    const beforeTime = timeDoc.exportHwp()
    let clock = 1000
    const timeRes = runMacroOnDocument(
      timeDoc,
      'insertText("dirty ");\nfind(".*x|a", { regex: true });',
      {
        limits: { maxTimeMs: 20 },
        now: () => {
          clock += 1
          return clock
        },
      },
    )
    expect(timeRes.ok).toBe(false)
    if (!timeRes.ok) {
      expect(timeRes.code).toBe('time_limit')
      expect(timeRes.detail).toBe('regex')
      expect(timeRes.line).toBe(2)
      expect(timeRes.error).toContain('Regex')
    }
    expect(bytesEqual(timeDoc.exportHwp(), beforeTime)).toBe(true)

    const stepDoc = makeDoc(['a'.repeat(5000)])
    const beforeStep = stepDoc.exportHwp()
    const stepRes = runMacroOnDocument(
      stepDoc,
      'insertText("dirty "); find(".*x|a", { regex: true });',
      { limits: { maxSteps: 100 } },
    )
    expect(stepRes.ok).toBe(false)
    if (!stepRes.ok) {
      expect(stepRes.code).toBe('step_limit')
      expect(stepRes.detail).toBe('regex')
      expect(stepRes.error).toContain('Regex')
    }
    expect(bytesEqual(stepDoc.exportHwp(), beforeStep)).toBe(true)

    // Non-regex step_limit must NOT carry detail: 'regex'.
    const nonRegexDoc = makeDoc(['abc'])
    const nonRegexRes = runMacroOnDocument(
      nonRegexDoc,
      'let n = 0; while (n < 500) { n = n + 1; }',
      { limits: { maxSteps: 20 } },
    )
    expect(nonRegexRes.ok).toBe(false)
    if (!nonRegexRes.ok) {
      expect(nonRegexRes.code).toBe('step_limit')
      expect(nonRegexRes.detail).toBeUndefined()
    }
  })

  it('validates compat parameter sets using exact compat parameter names (T7)', () => {
    const doc = makeDoc(['Sample text'])
    const beforeBytes = doc.exportHwp()

    const cases: Array<{
      name: string
      script: string
      expectedField: string
      forbiddenField?: string
    }> = [
      {
        name: 'HCharShape.Height below 100',
        script: `
          HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
          HParameterSet.HCharShape.Height = 1;
          HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
        `,
        expectedField: 'Height',
        forbiddenField: 'fontSize',
      },
      {
        name: 'HCharShape.Height above 50000',
        script: `
          HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
          HParameterSet.HCharShape.Height = 50001;
          HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
        `,
        expectedField: 'Height',
        forbiddenField: 'fontSize',
      },
      {
        name: 'HCharShape.FontSize out of range',
        script: `
          HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
          HParameterSet.HCharShape.FontSize = 501;
          HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
        `,
        expectedField: 'FontSize',
        forbiddenField: 'fontSize',
      },
      {
        name: 'HCharShape.FaceNameHangul empty',
        script: `
          HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
          HParameterSet.HCharShape.FaceNameHangul = "";
          HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
        `,
        expectedField: 'FaceNameHangul',
        forbiddenField: 'fontName',
      },
      {
        name: 'HCharShape.FaceNameLatin with control char',
        script: `
          HAction.GetDefault("CharShape", HParameterSet.HCharShape.HSet);
          HParameterSet.HCharShape.FaceNameLatin = "Bad\\nFont";
          HAction.Execute("CharShape", HParameterSet.HCharShape.HSet);
        `,
        expectedField: 'FaceNameLatin',
        forbiddenField: 'fontName',
      },
      {
        name: 'HParaShape.LineSpacing out of range',
        script: `
          HAction.GetDefault("ParagraphShape", HParameterSet.HParaShape.HSet);
          HParameterSet.HParaShape.LineSpacing = 20;
          HAction.Execute("ParagraphShape", HParameterSet.HParaShape.HSet);
        `,
        expectedField: 'LineSpacing',
        forbiddenField: 'lineSpacing',
      },
      {
        name: 'HTableCreation.Rows out of range',
        script: `
          HAction.GetDefault("TableCreate", HParameterSet.HTableCreation.HSet);
          HParameterSet.HTableCreation.Rows = 101;
          HParameterSet.HTableCreation.Cols = 2;
          HAction.Execute("TableCreate", HParameterSet.HTableCreation.HSet);
        `,
        expectedField: 'Rows',
        forbiddenField: 'rows',
      },
      {
        name: 'HTableCreation.Cols out of range',
        script: `
          HAction.GetDefault("TableCreate", HParameterSet.HTableCreation.HSet);
          HParameterSet.HTableCreation.Rows = 2;
          HParameterSet.HTableCreation.Cols = 51;
          HAction.Execute("TableCreate", HParameterSet.HTableCreation.HSet);
        `,
        expectedField: 'Cols',
        forbiddenField: 'cols',
      },
      {
        name: 'HInsertText.Text null',
        script: `
          HAction.GetDefault("InsertText", HParameterSet.HInsertText.HSet);
          HParameterSet.HInsertText.Text = null;
          HAction.Execute("InsertText", HParameterSet.HInsertText.HSet);
        `,
        expectedField: 'Text',
      },
      {
        name: 'HStyle.StyleName blank',
        script: `
          HAction.GetDefault("Style", HParameterSet.HStyle.HSet);
          HParameterSet.HStyle.StyleName = "   ";
          HAction.Execute("Style", HParameterSet.HStyle.HSet);
        `,
        expectedField: 'StyleName',
      },
      {
        name: 'HStyle.Style negative',
        script: `
          HAction.GetDefault("Style", HParameterSet.HStyle.HSet);
          HParameterSet.HStyle.Style = -1;
          HAction.Execute("Style", HParameterSet.HStyle.HSet);
        `,
        expectedField: 'Style',
      },
      {
        name: 'HFindReplace.FindString empty',
        script: `
          HAction.GetDefault("AllReplace", HParameterSet.HFindReplace.HSet);
          HParameterSet.HFindReplace.FindString = "";
          HParameterSet.HFindReplace.ReplaceString = "X";
          HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);
        `,
        expectedField: 'FindString',
      },
      {
        name: 'HFindReplace.ReplaceString with newline',
        script: `
          HAction.GetDefault("AllReplace", HParameterSet.HFindReplace.HSet);
          HParameterSet.HFindReplace.FindString = "Sample";
          HParameterSet.HFindReplace.ReplaceString = "A\\nB";
          HAction.Execute("AllReplace", HParameterSet.HFindReplace.HSet);
        `,
        expectedField: 'ReplaceString',
      },
      {
        name: 'MoveRight Count invalid',
        script: `
          HAction.Execute("MoveRight", { Count: 0 });
        `,
        expectedField: 'Count',
        forbiddenField: 'count',
      },
    ]

    for (const tc of cases) {
      const res = runMacroOnDocument(doc, tc.script)
      expect(res.ok, tc.name).toBe(false)
      if (!res.ok) {
        expect(res.code, tc.name).toBe('invalid_argument')
        expect(res.error, tc.name).toContain(tc.expectedField)
        if (tc.forbiddenField) {
          expect(res.error, tc.name).not.toContain(tc.forbiddenField)
        }
      }
      expect(bytesEqual(doc.exportHwp(), beforeBytes), tc.name).toBe(true)
    }
  })

  it('never mutates caller-supplied object arguments across all object-accepting APIs', () => {
    const doc = makeDoc(['Hello world'])
    const api = createMacroApi(doc)

    const charProps = Object.freeze({
      bold: true,
      italic: false,
      fontSize: 12,
      textColor: '#112233',
    })
    expect(() => api.setCharFormat(charProps)).not.toThrow()

    const paraProps = Object.freeze({
      align: 'center',
      lineSpacing: 160,
      leftMargin: 10,
      rightMargin: 10,
      firstLineIndent: 5,
      spaceBefore: 4,
      spaceAfter: 6,
      pageBreakBefore: false,
    })
    expect(() => api.setParaFormat(paraProps)).not.toThrow()

    const findOpts = Object.freeze({ caseSensitive: false, wholeWord: false, regex: true })
    expect(api.find('Hello', findOpts)).toHaveLength(1)
    expect(api.replaceAll('Hello', 'Hi', findOpts).replaced).toBe(1)
    expect(api.replaceNext('world', 'earth', findOpts).replaced).toBe(1)

    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const h1 = styles.find((s) => s.name === '개요 1' || s.name === '제목 1')
    const h2 = styles.find((s) => s.name === '개요 2' || s.name === '제목 2')
    if (h1 && h2) {
      doc.applyStyle(0, 0, h1.id)
      const outlineOpts = Object.freeze({
        singleOnly: true,
        appStyleMap: Object.freeze({ [h1.name]: 1, [h2.name]: 2 }),
      })
      expect(() => api.changeOutlineLevel(0, 0, 1, outlineOpts)).not.toThrow()
    }
  })
})
