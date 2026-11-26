import type { zh } from './zh'

export const th = {
  webNotUtf8Notice: 'ไฟล์นี้ไม่ได้เข้ารหัสแบบ UTF-8 จึงแก้ไขไม่ได้ แต่ยังดูและแชร์ไฟล์ต้นฉบับได้',
} as const satisfies Record<keyof typeof zh, string>
