import type { zh } from './zh'

export const nl = {
  item_docs: 'Word-editor',
  item_sheets: 'Excel-editor',
  item_slides: 'PowerPoint-editor',
  item_pdf: 'PDF-editor',
  item_pdfTools: 'PDF-hulpmiddelen',
  item_markdown: 'Markdown- en teksteditor',
  item_html: 'HTML-editor',
  item_mindmap: 'Mindmap-editor',
  item_diagram: 'Diagrameditor',
  item_hwp: 'Hangul-editor (HWP)',
  item_epub: 'EPUB-editor',
  offMessage: '{item} staat uit. Aanzetten en openen?',
  offDetailFiles: 'Er worden {count} bestanden mee geopend.',
  turnOnAndOpen: 'Aanzetten en openen',
  fileOnly: 'Alleen het bestand maken',
  cancel: 'Annuleren',
  aiOffSkillMessage: 'AI staat uit. AI aanzetten en de vaardigheid importeren?',
  aiOnAndImport: 'AI aanzetten en importeren',
} satisfies Record<keyof typeof zh, string>
