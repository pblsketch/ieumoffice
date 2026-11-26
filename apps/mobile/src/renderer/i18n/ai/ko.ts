import type { zh } from './zh'

export const ko = {
  aiOutboundTitle: '이 주소를 가져올까요?',
  aiOutboundIntro: 'AI가 대화에 나온 적 없는 주소를 가져오려고 합니다.',
  aiOutboundHint: '주소에 문서 내용이 들어 있거나 모르는 사이트면 막으세요.',
  aiOutboundBlock: '막기',
  aiOutboundAllow: '허용',
} as const satisfies Record<keyof typeof zh, string>
