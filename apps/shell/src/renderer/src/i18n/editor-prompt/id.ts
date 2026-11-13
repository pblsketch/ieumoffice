import type { zh } from './zh'

export const id = {
  item_docs: 'Editor Word',
  item_sheets: 'Editor Excel',
  item_slides: 'Editor PowerPoint',
  item_pdf: 'Editor PDF',
  item_pdfTools: 'Alat PDF',
  item_markdown: 'Editor Markdown dan teks',
  item_html: 'Editor HTML',
  item_mindmap: 'Editor peta pikiran',
  item_diagram: 'Editor diagram',
  item_hwp: 'Editor Hangul (HWP)',
  item_epub: 'Editor EPUB',
  offMessage: '{item} sedang nonaktif. Aktifkan lalu buka?',
  offDetailFiles: '{count} file akan dibuka dengannya.',
  turnOnAndOpen: 'Aktifkan dan buka',
  fileOnly: 'Buat file saja',
  cancel: 'Batal',
  aiOffSkillMessage: 'AI sedang nonaktif. Aktifkan AI lalu impor skill?',
  aiOnAndImport: 'Aktifkan AI dan impor',
} satisfies Record<keyof typeof zh, string>
