/**
 * Text box editing interactions in the HWP studio editor.
 *
 * Keeps Hancom Hangul behavior consistent across floating text boxes, newly
 * inserted text boxes, grouped text boxes, and text boxes placed inside table
 * cells:
 * - Clicking inside a selected floating text box without dragging enters text
 *   editing at the clicked point instead of keeping object selection locked.
 * - Inserting a new text box places the caret inside it immediately.
 * - Double-click and Enter enter editing for shapes, groups, and in-cell text
 *   boxes only when a text box actually exists.
 * - Border detection scales its tolerance down for thin single-line boxes and
 *   resolves in-cell shapes by cellPath.
 * - Distinguishes a text box inside a table cell ([Table, Shape]) from a table
 *   inside a text box ([Shape, Table]) so cursor movement, Tab, F5, and table
 *   commands act on the true innermost container.
 */

export const TEXTBOX_EDIT_MODULE = '@ieum/textbox-edit'

const MAX_BORDER_TOLERANCE_PX = 5

/** Normalize a cellPath step from either camelCase or short layout names. */
function normalizeStep(step) {
  return {
    controlIndex: step?.controlIndex ?? step?.controlIdx ?? 0,
    cellIndex: step?.cellIndex ?? step?.cellIdx ?? 0,
    cellParaIndex: step?.cellParaIndex ?? step?.cellParaIdx ?? 0,
  }
}

function sameStep(a, b) {
  const na = normalizeStep(a)
  const nb = normalizeStep(b)
  return (
    na.controlIndex === nb.controlIndex &&
    na.cellIndex === nb.cellIndex &&
    na.cellParaIndex === nb.cellParaIndex
  )
}

/**
 * Whether the innermost container at `(sec, parentPara, cellPath)` is a table
 * rather than a text box.
 *
 * A table inside a text box (`[Shape, Table]`) and a text box inside a table
 * cell (`[Table, Shape]`) both report `isTextBox: true` and `cellPath.length > 1`.
 * Checking `getTableDimensionsByPath` on the innermost path entry separates them.
 */
export function isTableLeafAt(wasm, sec, parentPara, cellPath, isTextBox) {
  if (parentPara === undefined || parentPara === null) return false
  if (!isTextBox) return true
  if (!Array.isArray(cellPath) || cellPath.length < 2) return false
  if (
    !wasm ||
    !('getTableDimensionsByPath' in wasm) ||
    typeof wasm.getTableDimensionsByPath !== 'function'
  ) {
    return true
  }
  const last = normalizeStep(cellPath[cellPath.length - 1])
  const tablePath = [
    ...cellPath.slice(0, -1).map(normalizeStep),
    { controlIndex: last.controlIndex, cellIndex: 0, cellParaIndex: 0 },
  ]
  try {
    const dims = wasm.getTableDimensionsByPath(sec, parentPara, JSON.stringify(tablePath))
    const rows = dims?.rowCount ?? dims?.rows ?? 0
    const cols = dims?.colCount ?? dims?.cols ?? 0
    return rows > 0 && cols > 0
  } catch {
    return false
  }
}

/**
 * Whether a DocumentPosition (or hit-test result) sits inside a table cell
 * rather than directly inside a text box.
 */
export function isTableCellPosition(wasm, pos) {
  if (!pos || pos.parentParaIndex === undefined) return false
  return isTableLeafAt(wasm, pos.sectionIndex, pos.parentParaIndex, pos.cellPath, !!pos.isTextBox)
}

/**
 * Whether a selected picture/shape/group ref owns the given text box hit.
 */
export function isSameTextBoxTarget(ref, hit) {
  if (!ref || !hit || !hit.isTextBox) return false
  if (ref.type !== 'shape' && ref.type !== 'group') return false
  if (hit.sectionIndex !== ref.sec || hit.parentParaIndex !== ref.ppi) return false

  const refPath = Array.isArray(ref.cellPath) ? ref.cellPath : []
  const hitPath = Array.isArray(hit.cellPath) ? hit.cellPath : []

  if (refPath.length > 0) {
    if (hitPath.length !== refPath.length + 1) return false
    for (let i = 0; i < refPath.length; i += 1) {
      if (!sameStep(refPath[i], hitPath[i])) return false
    }
    return normalizeStep(hitPath[hitPath.length - 1]).controlIndex === ref.ci
  }

  if (hitPath.length > 1) return false
  const hitCtrl = hitPath.length === 1 ? normalizeStep(hitPath[0]).controlIndex : hit.controlIndex
  return hitCtrl === ref.ci
}

/**
 * Border hit check with tolerance clamped to a quarter of each dimension so
 * thin single-line text boxes keep an editable interior.
 */
export function isPointNearBoxBorder(pageX, pageY, bbox) {
  if (!bbox) return false
  const w = bbox.width ?? bbox.w ?? 0
  const h = bbox.height ?? bbox.h ?? 0
  if (w <= 0 || h <= 0) return false
  const tolX = Math.min(MAX_BORDER_TOLERANCE_PX, w / 4)
  const tolY = Math.min(MAX_BORDER_TOLERANCE_PX, h / 4)
  const nearLeft = Math.abs(pageX - bbox.x) <= tolX
  const nearRight = Math.abs(pageX - (bbox.x + w)) <= tolX
  const nearTop = Math.abs(pageY - bbox.y) <= tolY
  const nearBottom = Math.abs(pageY - (bbox.y + h)) <= tolY
  const inVertRange = pageY >= bbox.y - tolY && pageY <= bbox.y + h + tolY
  const inHorzRange = pageX >= bbox.x - tolX && pageX <= bbox.x + w + tolX
  return (
    (nearLeft && inVertRange) ||
    (nearRight && inVertRange) ||
    (nearTop && inHorzRange) ||
    (nearBottom && inHorzRange)
  )
}

/** Resolve the selection ref for a text box hit (body or in-cell shape/group). */
export function shapeRefFromTextBoxHit(ih, hit, pageIdx) {
  if (!hit || !hit.isTextBox || hit.parentParaIndex === undefined) return null
  const hitPath = Array.isArray(hit.cellPath) ? hit.cellPath : []
  if (hitPath.length > 1) {
    const parentCellPath = hitPath.slice(0, -1).map(normalizeStep)
    const leaf = normalizeStep(hitPath[hitPath.length - 1])
    const base = {
      sec: hit.sectionIndex,
      ppi: hit.parentParaIndex,
      ci: leaf.controlIndex,
      cellPath: parentCellPath,
      pageIndex: pageIdx,
    }
    const shapeBox = ih?.findPictureBbox?.({ ...base, type: 'shape' })
    if (shapeBox) return { ...base, type: 'shape', bbox: shapeBox }
    const groupBox = ih?.findPictureBbox?.({ ...base, type: 'group' })
    if (groupBox) return { ...base, type: 'group', bbox: groupBox }
    return { ...base, type: 'shape', bbox: null }
  }
  const ci = hitPath.length === 1 ? normalizeStep(hitPath[0]).controlIndex : hit.controlIndex
  if (ci === undefined) return null
  try {
    const raw = ih?.wasm?.getShapeBBox?.(hit.sectionIndex, hit.parentParaIndex, ci)
    if (raw) {
      return {
        sec: hit.sectionIndex,
        ppi: hit.parentParaIndex,
        ci,
        type: 'shape',
        pageIndex: pageIdx,
        bbox: { x: raw.x, y: raw.y, w: raw.width, h: raw.height },
      }
    }
  } catch {
    // Fall back to page control layout (for groups or non-body shapes).
  }
  const base = { sec: hit.sectionIndex, ppi: hit.parentParaIndex, ci, pageIndex: pageIdx }
  const shapeBox = ih?.findPictureBbox?.({ ...base, type: 'shape' })
  if (shapeBox) return { ...base, type: 'shape', bbox: shapeBox }
  const groupBox = ih?.findPictureBbox?.({ ...base, type: 'group' })
  if (groupBox) return { ...base, type: 'group', bbox: groupBox }
  return { ...base, type: 'shape', bbox: null }
}

/**
 * Whether a click on a text box hit falls on the box's outer border.
 */
export function isTextBoxBorderClick(ih, pageIdx, pageX, pageY, hit, knownRef = null) {
  if (!hit?.isTextBox || isTableCellPosition(ih?.wasm, hit)) return false
  if (knownRef) {
    const bbox = ih?.findPictureBbox?.(knownRef)
    if (bbox) return isPointNearBoxBorder(pageX, pageY, bbox)
  }
  const resolved = shapeRefFromTextBoxHit(ih, hit, pageIdx)
  if (!resolved?.bbox) return false
  return isPointNearBoxBorder(pageX, pageY, resolved.bbox)
}

/**
 * Check whether clicking on a selected shape/group should enter text editing on
 * mouseup if the pointer does not drag.
 */
export function preparePendingTextBoxEnter(ih, ref, pageIdx, pageX, pageY) {
  if (!ref || (ref.type !== 'shape' && ref.type !== 'group')) return null
  try {
    const hit = ih.wasm.hitTest(pageIdx, pageX, pageY)
    if (!hit?.isTextBox) return null
    if (!isSameTextBoxTarget(ref, hit)) return null
    if (isTextBoxBorderClick(ih, pageIdx, pageX, pageY, hit, ref)) return null
    return hit
  } catch {
    return null
  }
}

/**
 * Enter text box editing when a mousedown on a selected floating shape/group
 * ended without movement. Returns true when editing was entered.
 */
export function finishPendingTextBoxEnter(ih, state) {
  const hit = state?.pendingEnterTextBoxHit
  if (!hit || state.totalDeltaH !== 0 || state.totalDeltaV !== 0) return false
  ih.cursor.exitPictureObjectSelection()
  ih.pictureObjectRenderer?.clear()
  ih.eventBus.emit('picture-object-selection-changed', false)
  ih.cursor.clearSelection()
  ih.cursor.moveToHit(hit)
  ih.cursor.resetPreferredX()
  ih.active = true
  ih.updateCaret()
  ih.emitCursorFormatState?.()
  ih.textarea?.focus()
  return true
}

/**
 * Enter text editing immediately after drawing a new text box (matching
 * Hancom Hangul). Returns true if text editing started, false to fall back to
 * object selection.
 */
export function enterCreatedTextBox(ih, sec, paraIdx, controlIdx) {
  try {
    const targetPath = [{ controlIndex: controlIdx, cellIndex: 0, cellParaIndex: 0 }]
    const count = ih.wasm.getCellParagraphCountByPath(sec, paraIdx, JSON.stringify(targetPath))
    if (!count || count <= 0) return false
    ih.cursor.clearSelection()
    ih.cursor.moveTo({
      sectionIndex: sec,
      paragraphIndex: 0,
      charOffset: 0,
      parentParaIndex: paraIdx,
      controlIndex: controlIdx,
      cellIndex: 0,
      cellParaIndex: 0,
      cellPath: targetPath,
      isTextBox: true,
    })
    ih.cursor.resetPreferredX()
    ih.active = true
    ih.updateCaret()
    ih.emitCursorFormatState?.()
    ih.textarea?.focus()
    return true
  } catch {
    return false
  }
}

/**
 * Enter text box editing from double-click on a selected shape or group
 * (including in-cell shapes). Returns true if handled.
 */
export function enterTextBoxOnDblClick(ih, ref, e) {
  if (!ref || (ref.type !== 'shape' && ref.type !== 'group')) return false
  e.preventDefault()
  const pagePoint = ih.pagePointFromClientPoint(e.clientX, e.clientY)
  const hit = ih.hitTestFromEvent(e)
  let canEnter = false
  if (pagePoint && hit?.isTextBox && isSameTextBoxTarget(ref, hit)) {
    try {
      const path =
        Array.isArray(hit.cellPath) && hit.cellPath.length > 0
          ? hit.cellPath
          : [
              {
                controlIndex: ref.ci,
                cellIndex: hit.cellIndex ?? 0,
                cellParaIndex: hit.cellParaIndex ?? 0,
              },
            ]
      const target = ih.wasm.getCursorRectByPathNear(
        ref.sec,
        ref.ppi,
        JSON.stringify(path),
        hit.charOffset,
        pagePoint.pageIdx,
      )
      canEnter = target.pageIndex === pagePoint.pageIdx
    } catch {
      // Unresolvable or repeated master-page object is not editable here.
    }
  }
  ih.cursor.exitPictureObjectSelection()
  ih.pictureObjectRenderer?.clear()
  ih.eventBus.emit('picture-object-selection-changed', false)
  if (canEnter && hit) {
    ih.cursor.clearSelection()
    ih.cursor.moveToHit(hit)
    ih.cursor.resetPreferredX()
    ih.active = true
    ih.updateCaret()
    ih.emitCursorFormatState?.()
  }
  ih.textarea?.focus()
  return true
}

/**
 * Enter text box editing when pressing Enter on a selected shape or group.
 * Checks that the shape/group actually has a text box first so plain shapes
 * without text are not broken. Returns true if text editing was entered.
 */
export function enterTextBoxOnEnterKey(ih, ref) {
  if (!ref || (ref.type !== 'shape' && ref.type !== 'group')) return false
  const prefix = Array.isArray(ref.cellPath) ? ref.cellPath.map(normalizeStep) : []
  const targetPath = [...prefix, { controlIndex: ref.ci, cellIndex: 0, cellParaIndex: 0 }]
  try {
    const count = ih.wasm.getCellParagraphCountByPath(ref.sec, ref.ppi, JSON.stringify(targetPath))
    if (!count || count <= 0) return false
  } catch {
    return false
  }
  ih.cursor.exitPictureObjectSelection()
  ih.pictureObjectRenderer?.clear()
  ih.eventBus.emit('picture-object-selection-changed', false)
  ih.cursor.clearSelection()
  ih.cursor.moveTo({
    sectionIndex: ref.sec,
    paragraphIndex: 0,
    charOffset: 0,
    parentParaIndex: ref.ppi,
    controlIndex: targetPath[0].controlIndex,
    cellIndex: targetPath[0].cellIndex,
    cellParaIndex: 0,
    cellPath: targetPath,
    isTextBox: true,
  })
  ih.cursor.resetPreferredX()
  ih.active = true
  ih.updateCaret()
  ih.emitCursorFormatState?.()
  ih.textarea?.focus()
  return true
}

/**
 * Select the text box object when clicking its border (supporting both body
 * shapes and in-cell shapes). Returns true if a border click was handled.
 */
export function selectTextBoxOnBorderClick(ih, pageIdx, pageX, pageY, hit) {
  if (!hit?.isTextBox || hit.parentParaIndex === undefined) return false
  if (isTableCellPosition(ih.wasm, hit)) return false
  const resolved = shapeRefFromTextBoxHit(ih, hit, pageIdx)
  if (!resolved?.bbox || !isPointNearBoxBorder(pageX, pageY, resolved.bbox)) return false
  ih.cursor.clearSelection()
  ih.exitPictureObjectSelectionIfNeeded()
  ih.cursor.enterPictureObjectSelectionDirect(
    resolved.sec,
    resolved.ppi,
    resolved.ci,
    resolved.type,
    undefined,
    undefined,
    undefined,
    undefined,
    resolved.cellPath,
    undefined,
    undefined,
    pageIdx,
  )
  ih.active = true
  ih.caret.hide()
  ih.selectionRenderer.clear()
  ih.renderPictureObjectSelection()
  ih.eventBus.emit('picture-object-selection-changed', true)
  ih.textarea?.focus()
  return true
}

/**
 * Whether a shape hit returned by `findPictureAtClick` actually carries a text
 * box. Used when a click fell through `hit.isTextBox === false` so shapes with
 * text boxes don't silently fall into object selection on interior clicks.
 */
export function shapeHasTextBox(wasm, ref) {
  if (!ref || (ref.type !== 'shape' && ref.type !== 'group')) return false
  const prefix = Array.isArray(ref.cellPath) ? ref.cellPath.map(normalizeStep) : []
  const targetPath = [...prefix, { controlIndex: ref.ci, cellIndex: 0, cellParaIndex: 0 }]
  try {
    const count = wasm.getCellParagraphCountByPath(ref.sec, ref.ppi, JSON.stringify(targetPath))
    return !!count && count > 0
  } catch {
    return false
  }
}

/**
 * Horizontal cursor movement inside a nested or grouped text box (where
 * upstream `buildNavContext` would drop `cellPath` or hardcode `cellIdx: 0`).
 * Moves across characters and paragraphs inside the text box and stays inside
 * its boundaries instead of jumping to an outer table cell.
 */
export function moveHorizontalInTextBox(cursor, delta) {
  const pos = cursor.getPosition()
  if (!pos?.isTextBox || pos.parentParaIndex === undefined) return false
  const wasm = cursor.wasm
  if (isTableCellPosition(wasm, pos)) return false
  const cellPath = Array.isArray(pos.cellPath) ? pos.cellPath : []
  const needsPathNav = cellPath.length > 1 || (pos.cellIndex ?? 0) > 0
  if (!needsPathNav) return false

  const sec = pos.sectionIndex
  const ppi = pos.parentParaIndex
  const normalized = cellPath.map(normalizeStep)
  const leafIdx = normalized.length - 1
  const cpi = normalized[leafIdx].cellParaIndex
  const withPara = (paraIdx) =>
    normalized.map((step, i) => (i < leafIdx ? step : { ...step, cellParaIndex: paraIdx }))

  try {
    const newOffset = pos.charOffset + delta
    if (newOffset < 0) {
      if (cpi > 0) {
        const prevPath = withPara(cpi - 1)
        const prevLen = wasm.getCellParagraphLengthByPath(sec, ppi, JSON.stringify(prevPath))
        cursor.moveTo({
          ...pos,
          paragraphIndex: cpi - 1,
          cellParaIndex: cpi - 1,
          cellPath: prevPath,
          charOffset: prevLen,
        })
      }
      return true
    }
    const curPath = withPara(cpi)
    const paraLen = wasm.getCellParagraphLengthByPath(sec, ppi, JSON.stringify(curPath))
    if (newOffset > paraLen) {
      const paraCount = wasm.getCellParagraphCountByPath(sec, ppi, JSON.stringify(curPath))
      if (cpi + 1 < paraCount) {
        const nextPath = withPara(cpi + 1)
        cursor.moveTo({
          ...pos,
          paragraphIndex: cpi + 1,
          cellParaIndex: cpi + 1,
          cellPath: nextPath,
          charOffset: 0,
        })
      }
      return true
    }
    cursor.moveTo({ ...pos, charOffset: newOffset })
    return true
  } catch {
    return false
  }
}
