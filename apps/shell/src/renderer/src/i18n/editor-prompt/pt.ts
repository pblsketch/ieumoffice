import type { zh } from './zh'

export const pt = {
  item_docs: 'Editor do Word',
  item_sheets: 'Editor do Excel',
  item_slides: 'Editor do PowerPoint',
  item_pdf: 'Editor de PDF',
  item_pdfTools: 'Ferramentas de PDF',
  item_markdown: 'Editor de Markdown e texto',
  item_html: 'Editor de HTML',
  item_mindmap: 'Editor de mapas mentais',
  item_diagram: 'Editor de diagramas',
  item_hwp: 'Editor de Hangul (HWP)',
  item_epub: 'Editor de EPUB',
  offMessage: '{item} está desativado. Ativar e abrir?',
  offDetailFiles: '{count} arquivos serão abertos nele.',
  turnOnAndOpen: 'Ativar e abrir',
  fileOnly: 'Só criar o arquivo',
  cancel: 'Cancelar',
  aiOffSkillMessage: 'A IA está desativada. Ativar a IA e importar a habilidade?',
  aiOnAndImport: 'Ativar a IA e importar',
} satisfies Record<keyof typeof zh, string>
