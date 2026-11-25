// Feature slot "sign" (PDF-T7 fills this folder only): the signature sheet, the remembered ten, placing signatures; registers the requestSignature handler; bar button Sign.
// Empty until then; the slot contract is `PdfFeature` in ../../edit/types.ts.
import type { PdfFeature } from '../../edit/types'

export const signFeature: PdfFeature = { id: 'sign' }
