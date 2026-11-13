import type { zh } from './zh'

export const de = {
  item_docs: 'Word-Editor',
  item_sheets: 'Excel-Editor',
  item_slides: 'PowerPoint-Editor',
  item_pdf: 'PDF-Editor',
  item_pdfTools: 'PDF-Werkzeuge',
  item_markdown: 'Markdown- und Texteditor',
  item_html: 'HTML-Editor',
  item_mindmap: 'Mindmap-Editor',
  item_diagram: 'Diagramm-Editor',
  item_hwp: 'Hangul-Editor (HWP)',
  item_epub: 'EPUB-Editor',
  offMessage: '{item} ist ausgeschaltet. Einschalten und öffnen?',
  offDetailFiles: '{count} Dateien werden damit geöffnet.',
  turnOnAndOpen: 'Einschalten und öffnen',
  fileOnly: 'Nur die Datei erstellen',
  cancel: 'Abbrechen',
  aiOffSkillMessage: 'KI ist ausgeschaltet. KI einschalten und den Skill importieren?',
  aiOnAndImport: 'KI einschalten und importieren',
} satisfies Record<keyof typeof zh, string>
