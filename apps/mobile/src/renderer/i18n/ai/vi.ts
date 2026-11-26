import type { zh } from './zh'

export const vi = {
  aiOutboundTitle: 'Tải địa chỉ này?',
  aiOutboundIntro: 'AI muốn tải một địa chỉ chưa từng xuất hiện trong cuộc trò chuyện.',
  aiOutboundHint: 'Nếu địa chỉ chứa nội dung tài liệu của bạn hoặc là trang web lạ, hãy chặn.',
  aiOutboundBlock: 'Chặn',
  aiOutboundAllow: 'Cho phép',
} as const satisfies Record<keyof typeof zh, string>
