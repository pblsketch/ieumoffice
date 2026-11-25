import type { zh } from './zh'

export const en = {
  pdfLinkPlaceHint: 'Drag a box on the page where the link goes',
  pdfLinkEditTitle: 'Edit link',
  pdfLinkUrlLabel: 'Web address (http, https, mailto)',
  pdfLinkPageLabel: 'Or a page in this document (1–{count})',
  pdfLinkUrlInvalid: 'Only http, https and mailto addresses can be linked',
  pdfLinkPageInvalid: 'Enter a page number from 1 to {count}',
  pdfLinkNeedTarget: 'Enter a web address or a page number',
  pdfLinkApply: 'Add link',
  pdfLinkDelete: 'Delete link',
  pdfLinkPending: 'Link to be added: {target}',
  pdfLinkToPage: 'Page {page}',
  pdfLinkFailed: 'Could not change the link. Try again when the save is done.',
  pdfLinkUpdate: 'Apply',
} as const satisfies Record<keyof typeof zh, string>
