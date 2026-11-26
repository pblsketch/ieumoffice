import type { zh } from './zh'

export const ja = {
  aiOutboundTitle: 'このアドレスを取得しますか？',
  aiOutboundIntro: 'AIが、会話に出てきていないアドレスを取得しようとしています。',
  aiOutboundHint:
    'アドレスに文書の内容が含まれている場合や、知らないサイトの場合はブロックしてください。',
  aiOutboundBlock: 'ブロック',
  aiOutboundAllow: '許可',
} as const satisfies Record<keyof typeof zh, string>
