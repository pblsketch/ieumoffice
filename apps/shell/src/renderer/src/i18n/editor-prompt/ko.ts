import type { zh } from './zh'

export const ko = {
  item_docs: '워드 편집기',
  item_sheets: '엑셀 편집기',
  item_slides: '파워포인트 편집기',
  item_pdf: 'PDF 편집기',
  item_pdfTools: 'PDF 도구',
  item_markdown: '마크다운·텍스트 편집기',
  item_html: 'HTML 편집기',
  item_mindmap: '마인드맵 편집기',
  item_diagram: '다이어그램 편집기',
  item_hwp: '한글 편집기',
  item_epub: '전자책(EPUB) 편집기',
  offMessage: '{item}가 꺼져 있습니다. 켜고 열까요?',
  offDetailFiles: '이 편집기로 열 파일이 {count}개 있습니다.',
  turnOnAndOpen: '켜고 열기',
  fileOnly: '파일만 만들기',
  cancel: '취소',
  aiOffSkillMessage: 'AI가 꺼져 있습니다. AI를 켜고 스킬을 가져올까요?',
  aiOnAndImport: 'AI 켜고 가져오기',
} satisfies Record<keyof typeof zh, string>
