import type { zh } from './zh'

export const it = {
  item_docs: 'Editor Word',
  item_sheets: 'Editor Excel',
  item_slides: 'Editor PowerPoint',
  item_pdf: 'Editor PDF',
  item_pdfTools: 'Strumenti PDF',
  item_markdown: 'Editor Markdown e testo',
  item_html: 'Editor HTML',
  item_mindmap: 'Editor di mappe mentali',
  item_diagram: 'Editor di diagrammi',
  item_hwp: 'Editor Hangul (HWP)',
  item_epub: 'Editor EPUB',
  offMessage: '{item} è disattivato. Attivarlo e aprire?',
  offDetailFiles: 'Con esso si apriranno {count} file.',
  turnOnAndOpen: 'Attiva e apri',
  fileOnly: 'Crea solo il file',
  cancel: 'Annulla',
  aiOffSkillMessage: 'L’IA è disattivata. Attivare l’IA e importare l’abilità?',
  aiOnAndImport: 'Attiva l’IA e importa',
} satisfies Record<keyof typeof zh, string>
