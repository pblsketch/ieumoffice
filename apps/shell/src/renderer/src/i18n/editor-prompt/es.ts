import type { zh } from './zh'

export const es = {
  item_docs: 'Editor de Word',
  item_sheets: 'Editor de Excel',
  item_slides: 'Editor de PowerPoint',
  item_pdf: 'Editor de PDF',
  item_pdfTools: 'Herramientas PDF',
  item_markdown: 'Editor de Markdown y texto',
  item_html: 'Editor de HTML',
  item_mindmap: 'Editor de mapas mentales',
  item_diagram: 'Editor de diagramas',
  item_hwp: 'Editor de Hangul (HWP)',
  item_epub: 'Editor de EPUB',
  offMessage: '{item} está desactivado. ¿Activarlo y abrir?',
  offDetailFiles: 'Se abrirán {count} archivos con él.',
  turnOnAndOpen: 'Activar y abrir',
  fileOnly: 'Solo crear el archivo',
  cancel: 'Cancelar',
  aiOffSkillMessage: 'La IA está desactivada. ¿Activar la IA e importar la habilidad?',
  aiOnAndImport: 'Activar la IA e importar',
} satisfies Record<keyof typeof zh, string>
