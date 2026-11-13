import type { zh } from './zh'

export const hi = {
  item_docs: 'Word संपादक',
  item_sheets: 'Excel संपादक',
  item_slides: 'PowerPoint संपादक',
  item_pdf: 'PDF संपादक',
  item_pdfTools: 'PDF टूल',
  item_markdown: 'Markdown और टेक्स्ट संपादक',
  item_html: 'HTML संपादक',
  item_mindmap: 'माइंड मैप संपादक',
  item_diagram: 'आरेख संपादक',
  item_hwp: 'हंगुल (HWP) संपादक',
  item_epub: 'EPUB संपादक',
  offMessage: '{item} बंद है। चालू करके खोलें?',
  offDetailFiles: 'इससे {count} फ़ाइलें खुलेंगी।',
  turnOnAndOpen: 'चालू करें और खोलें',
  fileOnly: 'केवल फ़ाइल बनाएँ',
  cancel: 'रद्द करें',
  aiOffSkillMessage: 'AI बंद है। AI चालू करके कौशल आयात करें?',
  aiOnAndImport: 'AI चालू करें और आयात करें',
} satisfies Record<keyof typeof zh, string>
