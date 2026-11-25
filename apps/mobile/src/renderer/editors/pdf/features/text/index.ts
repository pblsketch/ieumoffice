// Feature slot "text" (PDF-T9): text insert and document text edit; bar button Text box.
// Spec 2.3 and 3.7. Kept to this folder so the scope change can be lifted out whole.
import type { PdfFeature } from '../../edit/types'
import { useTextFeature } from './useTextFeature'

export const textFeature: PdfFeature = { id: 'text', useFeature: useTextFeature }
