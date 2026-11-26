import type { zh } from './zh'

export const ko = {
  sheetsAiUndoRefused: 'AI가 고친 뒤 표가 바뀌어 되돌리지 않았습니다.',
  sheetsAiUndoPartial: 'AI가 고친 것 가운데 일부를 되돌리지 못했습니다. 표를 확인해 주세요.',
  sheetsAiUndoExpired:
    '이 AI 변경은 이제 한 번에 되돌릴 수 없습니다(그 뒤 저장했거나 많이 고쳤습니다). 실행 취소를 쓰세요.',
} as const satisfies Record<keyof typeof zh, string>
