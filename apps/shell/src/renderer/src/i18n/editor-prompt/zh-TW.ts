import type { zh } from './zh'

export const zhTW = {
  item_docs: 'Word 編輯器',
  item_sheets: 'Excel 編輯器',
  item_slides: 'PowerPoint 編輯器',
  item_pdf: 'PDF 編輯器',
  item_pdfTools: 'PDF 工具',
  item_markdown: 'Markdown 與文字編輯器',
  item_html: 'HTML 編輯器',
  item_mindmap: '心智圖編輯器',
  item_diagram: '圖表編輯器',
  item_hwp: '韓文(HWP)編輯器',
  item_epub: 'EPUB 電子書編輯器',
  offMessage: '{item}已關閉。要啟用並開啟嗎？',
  offDetailFiles: '將以它開啟 {count} 個檔案。',
  turnOnAndOpen: '啟用並開啟',
  fileOnly: '僅建立檔案',
  cancel: '取消',
  aiOffSkillMessage: 'AI 功能已關閉。要啟用 AI 並匯入技能嗎？',
  aiOnAndImport: '啟用 AI 並匯入',
} satisfies Record<keyof typeof zh, string>
