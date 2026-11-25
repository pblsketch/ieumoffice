import type { zh } from './zh'

export const ko = {
  pdfAnnotHighlight: '형광펜',
  pdfAnnotUnderline: '밑줄',
  pdfAnnotSquiggly: '물결 밑줄',
  pdfAnnotStrikeout: '취소선',
  pdfAnnotModeSelect: '글자 고르기',
  pdfAnnotModeNote: '메모 놓기',
  pdfAnnotHintSelect:
    '글자 위를 옆으로 끌거나, 길게 누른 뒤 끌어서 고르세요. 표시를 누르면 색을 바꾸거나 지울 수 있습니다.',
  pdfAnnotHintNote: '메모를 놓을 자리를 누르세요.',
  pdfAnnotPen: '형광펜 {n}',
  pdfAnnotColor: '색 {n}',
  pdfAnnotRemove: '표시 지우기',
  pdfAnnotMarkupTitle: '표시 색',
  pdfAnnotClearSelection: '고르기 해제',
  pdfAnnotNoText: '이 쪽에는 고를 수 있는 글자가 없습니다.',
  pdfAnnotOpenNote: '메모 열기',
  pdfAnnotFailed: '주석을 바꾸지 못했습니다.',
  pdfAnnotNewNote: '새 메모',
  pdfAnnotReplyPlaceholder: '답글 내용',
} as const satisfies Record<keyof typeof zh, string>
