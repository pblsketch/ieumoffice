import type { zh } from './zh'

export const de = {
  pdfLinkPlaceHint: 'Ziehen Sie auf der Seite einen Rahmen, wo der Link hin soll',
  pdfLinkEditTitle: 'Link bearbeiten',
  pdfLinkUrlLabel: 'Webadresse (http, https, mailto)',
  pdfLinkPageLabel: 'Oder eine Seite in diesem Dokument (1–{count})',
  pdfLinkUrlInvalid: 'Nur http-, https- und mailto-Adressen können verlinkt werden',
  pdfLinkPageInvalid: 'Geben Sie eine Seitenzahl von 1 bis {count} ein',
  pdfLinkNeedTarget: 'Geben Sie eine Webadresse oder eine Seitenzahl ein',
  pdfLinkApply: 'Link hinzufügen',
  pdfLinkDelete: 'Link löschen',
  pdfLinkPending: 'Hinzuzufügender Link: {target}',
  pdfLinkToPage: 'Seite {page}',
  pdfLinkFailed:
    'Der Link konnte nicht geändert werden. Versuchen Sie es nach dem Speichern erneut.',
  pdfLinkUpdate: 'Übernehmen',
} as const satisfies Record<keyof typeof zh, string>
