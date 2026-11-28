// The feature registry: the seven feature slots joined into the edit frame. Each
// feature task fills only its own editors/pdf/features/<id>/index.ts; this file
// does not change when they do.
import { annotFeature } from '../features/annot'
import { drawFeature } from '../features/draw'
import { formFeature } from '../features/form'
import { linkFeature } from '../features/link'
import { pagesFeature } from '../features/pages'
import { signFeature } from '../features/sign'
import { textFeature } from '../features/text'
import type { PdfFeature, PdfFeatureChrome, PdfFeatureContext, PdfFeatureId } from './types'

export type PdfFeatureSet = Readonly<Record<PdfFeatureId, PdfFeature>>

export const PDF_FEATURES: PdfFeatureSet = {
  annot: annotFeature,
  draw: drawFeature,
  sign: signFeature,
  form: formFeature,
  text: textFeature,
  pages: pagesFeature,
  link: linkFeature,
}

/** Render order of the slots (overlays stack in this order, later on top). */
export const PDF_FEATURE_ORDER: readonly PdfFeatureId[] = [
  'form',
  'annot',
  'draw',
  'sign',
  'text',
  'link',
  'pages',
]

const NO_CHROME: PdfFeatureChrome = {}
const useNoFeature = (): PdfFeatureChrome => NO_CHROME

function useFeatureSlot(feature: PdfFeature, ctx: PdfFeatureContext): PdfFeatureChrome {
  // a feature's hook never changes for the life of the document, so hook order holds
  const useFeature = feature.useFeature ?? useNoFeature
  return useFeature(ctx)
}

/** Calls every feature's hook, always in the same order (React hook rules). */
export function usePdfFeatureChromes(
  features: PdfFeatureSet,
  contextFor: (id: PdfFeatureId) => PdfFeatureContext,
): Readonly<Record<PdfFeatureId, PdfFeatureChrome>> {
  const form = useFeatureSlot(features.form, contextFor('form'))
  const annot = useFeatureSlot(features.annot, contextFor('annot'))
  const draw = useFeatureSlot(features.draw, contextFor('draw'))
  const sign = useFeatureSlot(features.sign, contextFor('sign'))
  const text = useFeatureSlot(features.text, contextFor('text'))
  const link = useFeatureSlot(features.link, contextFor('link'))
  const pages = useFeatureSlot(features.pages, contextFor('pages'))
  return { annot, draw, sign, form, text, pages, link }
}
