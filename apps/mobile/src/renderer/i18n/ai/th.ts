import type { zh } from './zh'

export const th = {
  aiOutboundTitle: 'ดึงข้อมูลจากที่อยู่นี้ไหม',
  aiOutboundIntro: 'AI ต้องการดึงข้อมูลจากที่อยู่ที่ไม่เคยปรากฏในบทสนทนา',
  aiOutboundHint: 'หากที่อยู่มีเนื้อหาจากเอกสารของคุณ หรือเป็นเว็บไซต์ที่ไม่รู้จัก ให้บล็อก',
  aiOutboundBlock: 'บล็อก',
  aiOutboundAllow: 'อนุญาต',
} as const satisfies Record<keyof typeof zh, string>
