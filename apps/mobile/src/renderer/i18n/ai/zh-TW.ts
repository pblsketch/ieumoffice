import type { zh } from './zh'

export const zhTW = {
  aiOutboundTitle: '要取得這個網址嗎？',
  aiOutboundIntro: 'AI 想取得一個對話中從未出現過的網址。',
  aiOutboundHint: '如果網址含有文件內容，或是不認識的網站，請選擇封鎖。',
  aiOutboundBlock: '封鎖',
  aiOutboundAllow: '允許',
} as const satisfies Record<keyof typeof zh, string>
