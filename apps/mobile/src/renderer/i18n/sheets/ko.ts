import type { zh } from './zh'

export const ko = {
  sheetsProvisionalNotice: '시험판 격자입니다. 고친 내용은 아직 저장되지 않습니다.',
  sheetsLoading: '격자를 불러오는 중…',
  sheetsShareFailed: '이 파일을 공유하지 못했습니다.',
  sheetsFreezeTopRow: '맨 위 행 고정',
  sheetsFreezeFirstColumn: '첫 열 고정',
  sheetsUnfreeze: '틀 고정 풀기',
  sheetsKeyboardBar: '수식 입력 도구',
  sheetsInsertSum: '합계 함수',
  sheetsInsertParens: '괄호',
  sheetsNumericKeys: '숫자 키보드',
  sheetsCancelEdit: '취소',
  sheetsConfirmEdit: '확인',
} as const satisfies Record<keyof typeof zh, string>
