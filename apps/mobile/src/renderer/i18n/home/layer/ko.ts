import type { zh } from './zh'

export const ko = {
  homeRunEditorOffTitle: '{name} 편집기가 꺼져 있어요',
  homeRunEditorOffBody: '켜면 이 파일을 열 수 있어요. 설정에서 언제든 다시 끌 수 있어요.',
  homeRunEditorOffConfirm: '켜고 열기',
  homeRunStripSample: '예시 문서 · 읽기 전용',
  homeRunStripReceived: '받은 파일 · 읽기 전용',
  homeRunStripReadOnly: '읽기 전용',
  homeRunStripCopy: '사본으로 편집',
  homeRunStripClose: '알림 닫기',
  homeRunReceiveTitle: '받은 파일',
  homeRunReceiveCount: '파일 {count}개',
  homeRunReceiveClose: '받은 파일 닫기',
  homeRunReceiveOpen: '열기',
  homeRunReceivePdfOff: 'PDF 도구가 꺼져 있어요',
  homeRunReceivePdfOn: '켜고 계속',
  homeRunGuideLabel: '처음 안내',
  homeRunWelcomeTitle: '반가워요',
  homeRunWelcomeBody:
    'GenOffice로 한글·PDF·마크다운 같은 문서를 열고 고칠 수 있어요. 계정도 광고도 없고, 문서는 이 기기에만 있어요.',
  homeRunStart: '시작하기',
  homeRunTipEditButton: '고치려면 [편집]을 누르세요',
  homeRunTipFlowView: '화면에 맞춰 읽으려면 [읽기 화면]을 누르세요',
  homeRunTipFirstEdit: '복구 사본을 자동으로 만들어요. 원본은 [완료]를 누를 때 저장돼요',
  homeRunTipFirstKeyboard: '[Aa]로 글자 모양을 바꿔요',
} as const satisfies Record<keyof typeof zh, string>
