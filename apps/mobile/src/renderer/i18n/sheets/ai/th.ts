import type { zh } from './zh'

export const th = {
  sheetsAiUndoRefused: 'มีการแก้ไขชีตหลังการเปลี่ยนแปลงของ AI จึงไม่ได้เลิกทำ',
  sheetsAiUndoPartial: 'ไม่สามารถเลิกทำการเปลี่ยนแปลงบางส่วนของ AI ได้ โปรดตรวจสอบชีต',
  sheetsAiUndoExpired:
    'ไม่สามารถเลิกทำการเปลี่ยนแปลงของ AI ในครั้งเดียวได้อีกแล้ว (มีการบันทึกหรือแก้ไขเวิร์กบุ๊กมากหลังจากนั้น) โปรดใช้เลิกทำ',
} as const satisfies Record<keyof typeof zh, string>
