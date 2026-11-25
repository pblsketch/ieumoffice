// Feature slot "draw" (PDF-T6 fills this folder only): freehand ink, shapes, eraser and the pen/finger rule; bar button Pen.
// Empty until then; the slot contract is `PdfFeature` in ../../edit/types.ts.
import type { PdfFeature } from '../../edit/types'

export const drawFeature: PdfFeature = { id: 'draw' }
