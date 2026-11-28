import type { zh } from './zh'

export const vi = {
  pdfAnnotHighlight: 'Tô sáng',
  pdfAnnotUnderline: 'Gạch chân',
  pdfAnnotSquiggly: 'Gạch sóng',
  pdfAnnotStrikeout: 'Gạch ngang',
  pdfAnnotModeSelect: 'Chọn văn bản',
  pdfAnnotModeNote: 'Đặt ghi chú',
  pdfAnnotHintSelect:
    'Kéo ngang trên văn bản, hoặc nhấn giữ rồi kéo, để chọn. Chạm vào một đánh dấu để đổi màu hoặc xóa.',
  pdfAnnotHintNote: 'Chạm vào nơi muốn đặt ghi chú.',
  pdfAnnotPen: 'Bút tô sáng {n}',
  pdfAnnotColor: 'Màu {n}',
  pdfAnnotRemove: 'Xóa đánh dấu',
  pdfAnnotMarkupTitle: 'Màu đánh dấu',
  pdfAnnotClearSelection: 'Bỏ chọn',
  pdfAnnotNoText: 'Trang này không có văn bản để chọn.',
  pdfAnnotOpenNote: 'Mở ghi chú',
  pdfAnnotFailed: 'Không thể thay đổi chú thích.',
  pdfAnnotNewNote: 'Ghi chú mới',
  pdfAnnotReplyPlaceholder: 'Viết trả lời',
} as const satisfies Record<keyof typeof zh, string>
