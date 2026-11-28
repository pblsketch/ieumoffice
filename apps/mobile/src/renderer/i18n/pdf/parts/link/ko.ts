import type { zh } from './zh'

export const ko = {
  pdfLinkPlaceHint: '링크를 넣을 자리를 쪽 위에 끌어서 그리세요',
  pdfLinkEditTitle: '링크 고치기',
  pdfLinkUrlLabel: '웹 주소(http, https, mailto)',
  pdfLinkPageLabel: '또는 이 문서의 쪽(1~{count})',
  pdfLinkUrlInvalid: 'http, https, mailto 주소만 링크로 넣을 수 있습니다',
  pdfLinkPageInvalid: '1부터 {count} 사이의 쪽 번호를 입력하세요',
  pdfLinkNeedTarget: '웹 주소나 쪽 번호를 입력하세요',
  pdfLinkApply: '링크 넣기',
  pdfLinkDelete: '링크 지우기',
  pdfLinkPending: '넣을 링크: {target}',
  pdfLinkToPage: '{page}쪽',
  pdfLinkFailed: '링크를 바꾸지 못했습니다. 저장이 끝난 뒤 다시 해 보세요.',
  pdfLinkUpdate: '바꾸기',
} as const satisfies Record<keyof typeof zh, string>
