/** Caption menus against the real engine and the pinned studio history commands. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { captionTarget, createCaptionCommand } from '../studio-plugin/caption-commands.mjs'
import { applyPatch } from '../scripts/rhwp-patches.mjs'

const require = createRequire(import.meta.url)
const CORE = dirname(require.resolve('@rhwp/core'))
const TAG = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).rhwp.tag
const STUDIO = join(__dirname, '../node_modules/.cache/rhwp-studio', TAG, 'rhwp-studio/src')
const CAPTION_CELL = 65534
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

beforeAll(async () => {
  await init({
    module_or_path: readFileSync(join(CORE, 'rhwp_bg.wasm')),
  })
})

describe('caption target boundaries', () => {
  const ref = { sec: 0, ppi: 4, ci: 1 }
  it('uses a selected table, a selected graphic, or the table containing the caret', () => {
    expect(captionTarget({ getSelectedTableRef: () => ref })).toEqual({ ...ref, type: 'table' })
    expect(captionTarget({ getSelectedPictureRef: () => ({ ...ref, type: 'line' }) })).toEqual({
      ...ref,
      type: 'shape',
    })
    expect(
      captionTarget({
        getCursorPosition: () => ({ sectionIndex: 0, parentParaIndex: 4, controlIndex: 1 }),
      }),
    ).toEqual({ ...ref, type: 'table' })
    expect(
      captionTarget({ getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 4 }) }),
    ).toBeNull()
  })

  it.each(['equation', 'unknown'])('does not mistake a %s for a picture', (type) => {
    expect(captionTarget({ getSelectedPictureRef: () => ({ ...ref, type }) })).toBeNull()
  })

  it.each(['headerFooter', 'noteRef'])('rejects an unsupported %s route', (property) => {
    expect(
      captionTarget({ getSelectedPictureRef: () => ({ ...ref, type: 'shape', [property]: {} }) }),
    ).toBeNull()
    expect(captionTarget({ getSelectedTableRef: () => ({ ...ref, [property]: {} }) })).toBeNull()
  })

  it('rejects nested tables and preserves the full path to a graphic inside a cell', () => {
    const cellPath = [
      { controlIndex: 0, cellIndex: 1, cellParaIndex: 0 },
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
    ]
    expect(captionTarget({ getSelectedTableRef: () => ({ ...ref, cellPath }) })).toBeNull()
    expect(
      captionTarget({
        getCursorPosition: () => ({
          sectionIndex: 0,
          parentParaIndex: 4,
          controlIndex: 1,
          cellPath,
        }),
      }),
    ).toBeNull()
    expect(
      captionTarget({ getSelectedPictureRef: () => ({ ...ref, type: 'image', cellPath }) }),
    ).toEqual({ ...ref, type: 'image', cellPath })
  })

  it.each(['isInHeaderFooter', 'isInFootnote', 'isInTextBox'])(
    'rejects a table caret in %s',
    (method) => {
      expect(
        captionTarget({
          cursor: { [method]: () => true },
          getCursorPosition: () => ({ sectionIndex: 0, parentParaIndex: 4, controlIndex: 1 }),
        }),
      ).toBeNull()
      expect(
        captionTarget({ cursor: { [method]: () => true }, getSelectedTableRef: () => ref }),
      ).toBeNull()
    },
  )

  it('requires an editable, supported selection in the command context', () => {
    const command = createCaptionCommand('insert:caption-top', 'Top', 'top', {})
    const context = { hasDocument: true, isEditable: true, isFormMode: false, canEditCaption: true }
    expect(command.canExecute(context)).toBe(true)
    for (const key of ['hasDocument', 'isEditable', 'canEditCaption'])
      expect(command.canExecute({ ...context, [key]: false })).toBe(false)
    expect(command.canExecute({ ...context, isFormMode: true })).toBe(false)
  })
})

/** Load actual upstream command classes, rather than a second undo implementation. */
function studioHistory() {
  const propsSource = applyPatch(
    'studio-caption-table-router',
    readFileSync(join(STUDIO, 'engine/object-props.ts'), 'utf8'),
  )
  const compile = (source: string, dependencies: Record<string, unknown> = {}) => {
    const exports: Record<string, any> = {}
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    new Function('exports', ...Object.keys(dependencies), code)(
      exports,
      ...Object.values(dependencies),
    )
    return exports
  }
  const router = compile(propsSource)
  const source = ts.createSourceFile(
    'command.ts',
    readFileSync(join(STUDIO, 'engine/command.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const classes = ['SetObjectPropsCommand', 'SnapshotCommand'].map((name) => {
    const declaration = source.statements.find(
      (statement) => ts.isClassDeclaration(statement) && statement.name?.text === name,
    )
    if (!declaration) throw new Error(`Missing studio command: ${name}`)
    return declaration.getText(source)
  })
  return { ...router, ...compile(classes.join('\n'), { setObjectProps: router.setObjectProps }) }
}

function nativeBridge(document: HwpDocument | (() => HwpDocument)) {
  const doc = () => (typeof document === 'function' ? document() : document)
  return Object.fromEntries([
    ...['Table', 'Shape', 'Picture'].flatMap((type) => [
      [
        `get${type}Properties`,
        (...args: any[]) => JSON.parse((doc() as any)[`get${type}Properties`](...args)),
      ],
      [
        `set${type}Properties`,
        (sec: number, para: number, control: number, props: unknown) =>
          JSON.parse(
            (doc() as any)[`set${type}Properties`](sec, para, control, JSON.stringify(props)),
          ),
      ],
    ]),
    ...['Shape', 'Picture'].flatMap((type) => [
      [
        `getCell${type}PropertiesByPath`,
        (sec: number, para: number, path: unknown, control: number) =>
          JSON.parse(
            (doc() as any)[`getCell${type}PropertiesByPath`](
              sec,
              para,
              JSON.stringify(path),
              control,
            ),
          ),
      ],
      [
        `setCell${type}PropertiesByPath`,
        (sec: number, para: number, path: unknown, control: number, props: unknown) =>
          JSON.parse(
            (doc() as any)[`setCell${type}PropertiesByPath`](
              sec,
              para,
              JSON.stringify(path),
              control,
              JSON.stringify(props),
            ),
          ),
      ],
    ]),
    ['saveSnapshot', () => doc().saveSnapshot()],
    ['restoreSnapshot', (id: number) => doc().restoreSnapshot(id)],
    ['discardSnapshot', (id: number) => doc().discardSnapshot(id)],
  ]) as Record<string, any>
}

function editor(
  kind: 'table' | 'shape' | 'line' | 'image',
  initial?: { doc: HwpDocument; ref: Record<string, any> },
) {
  let doc = initial?.doc ?? HwpDocument.createEmpty()
  if (!initial) doc.createBlankDocument()
  let made: any
  if (initial) made = { ok: true }
  else if (kind === 'table') made = JSON.parse(doc.createTable(0, 0, 0, 2, 2))
  else if (kind === 'image')
    made = JSON.parse(doc.insertPicture(0, 0, 0, '', PNG, 7200, 5400, 1, 1, 'png', ''))
  else
    made = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 0,
          charOffset: 0,
          width: 17008,
          height: 5669,
          shapeType: kind === 'line' ? 'line' : 'rectangle',
        }),
      ),
    )
  expect(made.ok).toBe(true)
  const ref = initial?.ref ?? {
    sec: 0,
    ppi: made.paraIdx ?? 0,
    ci: made.controlIdx ?? 0,
    type: kind === 'line' ? 'shape' : kind,
  }
  const wasm = nativeBridge(() => doc)
  const commands = studioHistory()
  const history: any[] = []
  const operations: any[] = []
  const replaceDocument = (bytes: Uint8Array) => {
    history.forEach((command) => command.discard?.(wasm))
    history.length = 0
    doc.free()
    doc = new HwpDocument(bytes)
  }
  let allowed = true
  const input = {
    getSelectedPictureRef: () => (kind === 'table' ? null : ref),
    getSelectedTableRef: () => (kind === 'table' ? ref : null),
    executeOperation(operation: any) {
      operations.push(operation)
      if (!allowed) return
      const anchor = { sectionIndex: 0, paragraphIndex: ref.ppi, charOffset: 0 }
      const command =
        operation.kind === 'command'
          ? operation.command
          : new commands.SnapshotCommand(
              operation.operationType,
              anchor,
              anchor,
              operation.operation,
            )
      command.execute(wasm)
      if (!command.isNoOp()) history.push(command)
    },
  }
  return {
    get doc() {
      return doc
    },
    ref,
    wasm,
    history,
    operations,
    replaceDocument,
    lock: () => {
      allowed = false
    },
    props: () => commands.getObjectProps(wasm, ref),
    run(position: string) {
      const command = createCaptionCommand(`insert:caption-${position}`, position, position, {
        ...commands,
        createPropertyCommand: (...args: any[]) => new commands.SetObjectPropsCommand(...args),
      })
      command.execute({ getInputHandler: () => input, wasm })
    },
    text: () => captionText(doc),
    async addText() {
      if (kind === 'shape' || kind === 'line') {
        // Shape captions have no public text-edit API. Seed an existing caption
        // through the synthetic HWPX fixture, rather than pretend that API exists.
        const zip = await JSZip.loadAsync(doc.exportHwpx())
        const part = zip.file('Contents/section0.xml')!
        const xml = await part.async('string')
        expect(xml).toMatch(/<hp:caption\b/)
        zip.file(
          part.name,
          xml.replace(/<hp:caption\b[\s\S]*?<\/hp:caption>/, (caption) =>
            caption.replace('</hp:t>', ' custom caption</hp:t>'),
          ),
        )
        const bytes = await zip.generateAsync({ type: 'uint8array' })
        replaceDocument(bytes)
        return
      }
      const offset = doc.getCellParagraphLength(0, ref.ppi, ref.ci, CAPTION_CELL, 0)
      expect(
        JSON.parse(
          doc.insertTextInCell(0, ref.ppi, ref.ci, CAPTION_CELL, 0, offset, ' custom caption'),
        ).ok,
      ).toBe(true)
    },
    close() {
      history.forEach((command) => command.discard?.(wasm))
      doc.free()
    },
  }
}

async function captionText(doc: HwpDocument): Promise<string> {
  const zip = await JSZip.loadAsync(doc.exportHwpx())
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  const caption = xml.match(/<hp:caption\b[\s\S]*?<\/hp:caption>/)?.[0] ?? ''
  return [...caption.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)]
    .map((match) => match[1])
    .join('')
}

// Source comes from the pinned studio build cache, as in rhwp-patches.test.ts.
describe.skipIf(!existsSync(STUDIO))('native caption commands with studio undo and redo', () => {
  it.each(['table', 'shape', 'line', 'image'] as const)(
    'adds, moves, removes and restores a %s caption without losing its body',
    async (kind) => {
      const e = editor(kind)
      e.run('bottom')
      expect(e.props().hasCaption).toBe(true)
      expect(e.operations.at(-1).kind).toBe('snapshot')
      const added = e.history.at(-1)
      added.undo(e.wasm)
      expect(e.props().hasCaption).toBe(false)
      added.execute(e.wasm)
      expect(e.props().hasCaption).toBe(true)
      await e.addText()
      const originalText = await e.text()
      expect(originalText).toContain('custom caption')
      const before = e.props()
      const beforeBytes = e.doc.exportHwpx()
      e.run('rm')
      expect(e.props()).toMatchObject({
        captionDirection: kind === 'table' ? 1 : 'Right',
        captionVertAlign: kind === 'table' ? 1 : 'Center',
      })
      expect(e.operations.at(-1).kind).toBe('command')
      const moved = e.history.at(-1)
      moved.undo(e.wasm)
      expect(e.props()).toEqual(before)
      expect(e.doc.exportHwpx()).toEqual(beforeBytes)
      moved.execute(e.wasm)
      expect(await e.text()).toBe(originalText)
      e.run('none')
      expect(e.props().hasCaption).toBe(false)
      const removed = e.history.at(-1)
      removed.undo(e.wasm)
      expect(e.props().hasCaption).toBe(true)
      expect(await e.text()).toBe(originalText)
      removed.execute(e.wasm)
      expect(e.props().hasCaption).toBe(false)
      e.close()
    },
  )

  it.each(['table', 'shape', 'image'] as const)(
    'persists all eight positions for a %s in HWP and HWPX',
    async (kind) => {
      const e = editor(kind)
      e.run('bottom')
      await e.addText()
      const positions = [
        ['lt', 0, 0],
        ['lm', 0, 1],
        ['lb', 0, 2],
        ['rt', 1, 0],
        ['rm', 1, 1],
        ['rb', 1, 2],
        ['top', 2, 2],
        ['bottom', 3, 2],
      ] as const
      for (const [position, direction, align] of positions) {
        e.run(position)
        const expected = {
          hasCaption: true,
          captionDirection:
            kind === 'table' ? direction : ['Left', 'Right', 'Top', 'Bottom'][direction],
          captionVertAlign: kind === 'table' ? align : ['Top', 'Center', 'Bottom'][align],
        }
        expect(e.props(), position).toMatchObject(expected)
        for (const bytes of [e.doc.exportHwp(), e.doc.exportHwpx()]) {
          const reopened = new HwpDocument(bytes)
          const props = nativeBridge(reopened)[
            kind === 'table'
              ? 'getTableProperties'
              : kind === 'image'
                ? 'getPictureProperties'
                : 'getShapeProperties'
          ](0, e.ref.ppi, e.ref.ci)
          expect(props, `${position} after reopen`).toMatchObject(expected)
          expect(await captionText(reopened)).toContain('custom caption')
          reopened.free()
        }
      }
      e.close()
    },
  )

  it('does not create history for a no-op or mutate before the editor gate', () => {
    const e = editor('table')
    e.run('none')
    expect(e.operations).toHaveLength(0)
    e.lock()
    const before = e.doc.exportHwpx()
    e.run('top')
    expect(e.history).toHaveLength(0)
    expect(e.doc.exportHwpx()).toEqual(before)
    expect(e.props().hasCaption).toBe(false)
    e.close()
  })

  it.each(['table', 'shape', 'image'] as const)(
    'restores both serialized formats exactly after moving an existing %s caption',
    async (kind) => {
      for (const format of ['hwp', 'hwpx']) {
        const e = editor(kind)
        e.run('bottom')
        await e.addText()
        e.replaceDocument(format === 'hwp' ? e.doc.exportHwp() : e.doc.exportHwpx())
        const before = [e.doc.exportHwp(), e.doc.exportHwpx()]
        e.run('lb')
        expect(e.history).toHaveLength(1)
        e.history[0].undo(e.wasm)
        expect(e.doc.exportHwp(), `${kind} from ${format}: HWP undo`).toEqual(before[0])
        expect(e.doc.exportHwpx(), `${kind} from ${format}: HWPX undo`).toEqual(before[1])
        expect(await e.text()).toContain('custom caption')
        e.close()
      }
    },
  )

  it('addresses a cell picture separately from its containing table caption', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const created = JSON.parse(doc.createTable(0, 0, 0, 2, 2))
    expect(created.ok).toBe(true)
    const para = created.paraIdx ?? 0
    const control = created.controlIdx ?? 0
    const path = [{ controlIndex: control, cellIndex: 1, cellParaIndex: 0 }]
    const picture = JSON.parse(
      doc.insertPictureInCell(0, para, 0, JSON.stringify(path), PNG, 7200, 5400, 1, 1, 'png', ''),
    )
    expect(picture.ok).toBe(true)
    const e = editor('image', {
      doc,
      ref: { sec: 0, ppi: para, ci: picture.controlIdx, type: 'image', cellPath: path },
    })
    const table = JSON.parse(doc.getTableProperties(0, para, control))
    e.run('rt')
    expect(e.props()).toMatchObject({
      hasCaption: true,
      captionDirection: 'Right',
      captionVertAlign: 'Top',
    })
    const changedTable = JSON.parse(doc.getTableProperties(0, para, control))
    // A picture caption can expand the measured cell height; it must not
    // create a caption on the containing table or change its other properties.
    const { tableHeight: oldHeight, ...before } = table
    const { tableHeight: newHeight, ...after } = changedTable
    expect(after).toEqual(before)
    expect(newHeight).toBeGreaterThanOrEqual(oldHeight)
    e.history[0].undo(e.wasm)
    expect(e.props().hasCaption).toBe(false)
    expect(JSON.parse(doc.getTableProperties(0, para, control))).toEqual(table)
    e.history[0].execute(e.wasm)
    expect(e.props().hasCaption).toBe(true)
    e.close()
  })

  it('makes an invalidated selection a harmless no-op', () => {
    const mutate = vi.fn()
    createCaptionCommand('insert:caption-top', 'Top', 'top', { getObjectProps: mutate }).execute({
      getInputHandler: () => null,
    })
    expect(mutate).not.toHaveBeenCalled()
  })
})
