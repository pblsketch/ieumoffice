// Feature slot "link" (PDF-T11): [⋯] Insert link — drag a box on a page, give it an
// outside address or a page of this document, edit or delete pending links (spec 3.10).
import type { PdfFeature } from '../../edit/types'
import { useLinkFeature } from './useLinkFeature'

export const linkFeature: PdfFeature = { id: 'link', useFeature: useLinkFeature }

export {
  addLinkOps,
  dragToPdfRect,
  pageFieldOf,
  parseLinkPage,
  parseLinkUrl,
  pendingLinksOn,
  removeLinkOps,
  resolveLinkTarget,
  retargetLinkOps,
  visiblePageOrder,
  type PdfLinkTarget,
  type PdfLinkTargetError,
  type PdfLinkTargetResult,
  type PdfPendingLink,
} from './linkTarget'
