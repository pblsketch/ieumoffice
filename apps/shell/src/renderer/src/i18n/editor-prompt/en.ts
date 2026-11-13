import type { zh } from './zh'

export const en = {
  item_docs: 'Word editor',
  item_sheets: 'Excel editor',
  item_slides: 'PowerPoint editor',
  item_pdf: 'PDF editor',
  item_pdfTools: 'PDF Tools',
  item_markdown: 'Markdown and text editor',
  item_html: 'HTML editor',
  item_mindmap: 'Mind map editor',
  item_diagram: 'Diagram editor',
  item_hwp: 'Hangul (HWP) editor',
  item_epub: 'EPUB editor',
  offMessage: '{item} is turned off. Turn it on and open?',
  offDetailFiles: '{count} files will open in it.',
  turnOnAndOpen: 'Turn on and open',
  fileOnly: 'Create the file only',
  cancel: 'Cancel',
  aiOffSkillMessage: 'AI is turned off. Turn on AI and import the skill?',
  aiOnAndImport: 'Turn on AI and import',
} satisfies Record<keyof typeof zh, string>
