import type { zh } from './zh'

export const ms = {
  item_docs: 'Editor Word',
  item_sheets: 'Editor Excel',
  item_slides: 'Editor PowerPoint',
  item_pdf: 'Editor PDF',
  item_pdfTools: 'Alat PDF',
  item_markdown: 'Editor Markdown dan teks',
  item_html: 'Editor HTML',
  item_mindmap: 'Editor peta minda',
  item_diagram: 'Editor rajah',
  item_hwp: 'Editor Hangul (HWP)',
  item_epub: 'Editor EPUB',
  offMessage: '{item} dimatikan. Hidupkan dan buka?',
  offDetailFiles: '{count} fail akan dibuka dengannya.',
  turnOnAndOpen: 'Hidupkan dan buka',
  fileOnly: 'Cipta fail sahaja',
  cancel: 'Batal',
  aiOffSkillMessage: 'AI dimatikan. Hidupkan AI dan import kemahiran?',
  aiOnAndImport: 'Hidupkan AI dan import',
} satisfies Record<keyof typeof zh, string>
