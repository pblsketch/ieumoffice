// Feature slot "form" (PDF-T8, spec 3.8): AcroForm filling and check/cross marks as a
// page overlay in edit mode; no bar button. Text fields are typed in a sheet, choices
// picked from one, signature fields go to the sign feature (`requestSignature`), and
// the file's saved static fills are handed to the save (`savedStaticFormFills`).
import type { PdfFeature } from '../../edit/types'
import { createUseFormFeature, type FormFeatureDeps } from './useFormFeature'

export function createFormFeature(deps: FormFeatureDeps = {}): PdfFeature {
  return { id: 'form', useFeature: createUseFormFeature(deps) }
}

export const formFeature: PdfFeature = createFormFeature()

export type { FormFeatureDeps } from './useFormFeature'
export {
  loadFormCatalog,
  readSavedStaticFormFills,
  type FormCatalog,
  type FormMarkKind,
  type FormWidget,
} from './formModel'
