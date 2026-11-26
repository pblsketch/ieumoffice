import type { zh } from './zh'

export const ko = {
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
