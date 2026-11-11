/** Caption commands use the editor's mutation gate and history, never raw file edits. */
export const CAPTION_COMMAND_MODULE = '@ieum/caption-commands'

const GRAPHICS = new Set(['image', 'shape', 'group', 'line', 'ole'])
const POSITIONS = {
  top: ['Top', 'Top'],
  lt: ['Left', 'Top'],
  lm: ['Left', 'Center'],
  lb: ['Left', 'Bottom'],
  rt: ['Right', 'Top'],
  rm: ['Right', 'Center'],
  rb: ['Right', 'Bottom'],
  bottom: ['Bottom', 'Top'],
}

/** Only return references whose getter and setter address the same engine object. */
export function captionTarget(input) {
  if (!input) return null
  const cursor = input.cursor
  if (cursor?.isInHeaderFooter?.() || cursor?.isInFootnote?.()) return null
  const graphic = input.getSelectedPictureRef?.()
  if (graphic) {
    // The existing generic shape router has no header/footer or note route.
    // Do not accidentally edit a body object with the same local indices.
    if (!GRAPHICS.has(graphic.type) || graphic.headerFooter || graphic.noteRef) return null
    return { ...graphic, type: graphic.type === 'image' ? 'image' : 'shape' }
  }
  const table = input.getSelectedTableRef?.()
  if (table) {
    if (
      (table.cellPath?.length ?? 0) > 1 ||
      table.headerFooter ||
      table.noteRef ||
      cursor?.isInTextBox?.()
    )
      return null
    return { ...table, type: 'table' }
  }
  if (cursor?.isInTextBox?.()) return null
  const pos = input.getCursorPosition?.()
  if (
    !pos ||
    pos.isTextBox ||
    pos.parentParaIndex === undefined ||
    pos.controlIndex === undefined ||
    (pos.cellPath?.length ?? 0) > 1
  )
    return null
  return { type: 'table', sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex }
}

function positionProps(target, position, current) {
  if (position === 'none') return { hasCaption: false }
  const [direction, align] = POSITIONS[position]
  const table = target.type === 'table'
  // Vertical alignment only places side captions; preserve it for top/bottom.
  const vertical =
    direction === 'Top' || direction === 'Bottom'
      ? (current.captionVertAlign ?? (table ? 0 : 'Top'))
      : table
        ? ['Top', 'Center', 'Bottom'].indexOf(align)
        : align
  return {
    hasCaption: true,
    captionDirection: table ? ['Left', 'Right', 'Top', 'Bottom'].indexOf(direction) : direction,
    captionVertAlign: vertical,
  }
}

/**
 * Position changes keep only inverse scalar properties in history. Adding or
 * deleting a caption needs a snapshot because its paragraphs must survive undo.
 * Dependencies are the studio's existing symmetric object-property router.
 */
export function createCaptionCommand(id, label, position, deps) {
  if (position !== 'none' && !Object.hasOwn(POSITIONS, position))
    throw new Error('Unknown caption position')
  return {
    id,
    label,
    canExecute: (context) =>
      context.hasDocument &&
      context.isEditable &&
      !context.isFormMode &&
      context.canEditCaption === true,
    execute(services) {
      const input = services.getInputHandler()
      const target = captionTarget(input)
      if (!target) return
      const props = deps.getObjectProps(services.wasm, target)
      if (!props || typeof props.hasCaption !== 'boolean') return
      const after = positionProps(target, position, props)
      const before = Object.fromEntries(Object.keys(after).map((key) => [key, props[key]]))
      if (Object.keys(after).every((key) => Object.is(before[key], after[key]))) return
      if (props.hasCaption && after.hasCaption) {
        input.executeOperation({
          kind: 'command',
          command: deps.createPropertyCommand(target, before, after),
          meta: { refresh: 'full' },
        })
      } else {
        input.executeOperation({
          kind: 'snapshot',
          operationType: 'captionPosition',
          operation(wasm) {
            const result = deps.setObjectProps(wasm, target, after)
            if (result?.ok === false || result?.error) return null
            return { sectionIndex: target.sec, paragraphIndex: target.ppi, charOffset: 0 }
          },
          meta: { refresh: 'full' },
        })
      }
    },
  }
}
