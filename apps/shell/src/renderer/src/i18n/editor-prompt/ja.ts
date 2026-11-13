import type { zh } from './zh'

export const ja = {
  item_docs: 'Word エディター',
  item_sheets: 'Excel エディター',
  item_slides: 'PowerPoint エディター',
  item_pdf: 'PDF エディター',
  item_pdfTools: 'PDF ツール',
  item_markdown: 'Markdown・テキストエディター',
  item_html: 'HTML エディター',
  item_mindmap: 'マインドマップエディター',
  item_diagram: 'ダイアグラムエディター',
  item_hwp: 'ハングル(HWP)エディター',
  item_epub: 'EPUB エディター',
  offMessage: '{item}はオフになっています。オンにして開きますか？',
  offDetailFiles: 'これで開くファイルが {count} 件あります。',
  turnOnAndOpen: 'オンにして開く',
  fileOnly: 'ファイルだけ作成',
  cancel: 'キャンセル',
  aiOffSkillMessage: 'AI はオフになっています。AI をオンにしてスキルを取り込みますか？',
  aiOnAndImport: 'AI をオンにして取り込む',
} satisfies Record<keyof typeof zh, string>
