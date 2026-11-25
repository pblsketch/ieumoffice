// Feature slot "sign" (PDF-T7): the signature sheet (draw or picture, PC colors), the
// ten signatures remembered on the device, placing, moving, resizing and deleting image
// stamps, and the requestSignature handler for signature fields. Bar button Sign.
import type { PdfFeature } from '../../edit/types'
import { useSignFeature } from './useSignFeature'

export const signFeature: PdfFeature = { id: 'sign', useFeature: useSignFeature }
