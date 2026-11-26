import type { zh } from './zh'

export const vi = {
  webNotUtf8Notice:
    'Tệp này không ở dạng UTF-8 nên không thể chỉnh sửa. Bạn vẫn có thể xem và chia sẻ tệp gốc.',
} as const satisfies Record<keyof typeof zh, string>
