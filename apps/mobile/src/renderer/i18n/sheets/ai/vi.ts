import type { zh } from './zh'

export const vi = {
  sheetsAiUndoRefused:
    'Trang tính đã được sửa sau các thay đổi của AI nên chúng không được hoàn tác.',
  sheetsAiUndoPartial: 'Không thể hoàn tác một số thay đổi của AI. Hãy kiểm tra trang tính.',
  sheetsAiUndoExpired:
    'Không thể hoàn tác các thay đổi của AI trong một bước nữa (sổ tính đã được lưu hoặc sửa nhiều sau đó). Hãy dùng Hoàn tác.',
} as const satisfies Record<keyof typeof zh, string>
