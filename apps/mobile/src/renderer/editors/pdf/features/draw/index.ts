// Feature slot "draw" (PDF-T6): freehand ink, shapes, eraser and the pen/finger rule;
// bar button Pen. The slot contract is `PdfFeature` in ../../edit/types.ts.
import type { PdfFeature } from '../../edit/types'
import { useDrawFeature } from './useDrawFeature'

export const drawFeature: PdfFeature = { id: 'draw', useFeature: useDrawFeature }

export { PEN_PREFS_KEY, createPenInputRouter, loadPenPrefs, savePenPrefs } from './penInput'
export type { PenInputRouter, PenPrefs, PointerDecision, PointerRoute } from './penInput'
export { startStroke, drawingHit, erasedIds } from './drawGeometry'
export type { DrawShapeTool, DrawToolChoice } from './drawGeometry'
