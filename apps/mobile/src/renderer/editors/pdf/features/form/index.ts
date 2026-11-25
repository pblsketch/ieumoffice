// Feature slot "form" (PDF-T8 fills this folder only): AcroForm filling and check/cross marks as a page overlay in edit mode; no bar button.
// Empty until then; the slot contract is `PdfFeature` in ../../edit/types.ts.
import type { PdfFeature } from '../../edit/types'

export const formFeature: PdfFeature = { id: 'form' }
