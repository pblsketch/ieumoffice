// Feature slot "pages" (PDF-T10): the page organizer (rotate, delete, reorder, blank
// pages as pending PC edits) and taking pages from another PDF; [⋯] Organize pages.
import type { PdfFeature } from '../../edit/types'
import { usePagesFeature } from './usePagesFeature'

export const pagesFeature: PdfFeature = { id: 'pages', useFeature: usePagesFeature }
