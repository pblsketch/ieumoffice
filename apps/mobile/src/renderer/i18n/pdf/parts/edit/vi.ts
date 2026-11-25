import type { zh } from './zh'

export const vi = {
  pdfEditPen: 'Bút',
  pdfEditHighlighter: 'Bút đánh dấu',
  pdfEditTextBox: 'Hộp văn bản',
  pdfEditSign: 'Ký',
  pdfEditPages: 'Sắp xếp trang',
  pdfEditLink: 'Chèn liên kết',
  pdfEditSaveFailed: 'Không thể lưu. Các thay đổi của bạn vẫn còn và tệp không bị thay đổi.',
  pdfEditSaveSkipped: 'Không thể lưu một số chỉnh sửa văn bản trên trang {pages}.',
  pdfEditShareFailed: 'Không thể chia sẻ.',
  pdfEditReloadFailed: 'Đã lưu nhưng không thể tải lại tài liệu. Hãy mở lại tệp.',
  pdfEditSignatureUnavailable: 'Tính năng ký chưa khả dụng.',
  pdfEditSaveAsHint:
    'Chọn cách xử lý đánh dấu, ghi chú và hình vẽ trong bản sao. “In vào trang” cũng in cả trường biểu mẫu; “Bỏ chú thích” giữ nguyên liên kết và trường biểu mẫu.',
  pdfEditKeepAnnots: 'Giữ chú thích (có thể chỉnh sửa trong ứng dụng khác)',
  pdfEditFlattenAnnots: 'In vào trang (hiển thị trong mọi ứng dụng)',
  pdfEditStripAnnots: 'Bỏ chú thích (giữ liên kết và trường biểu mẫu)',
  pdfEditSaveVerifyFailed:
    'Không thể ghi lại nguyên vẹn các thay đổi trên trang {pages}, vì vậy việc lưu đã bị hủy và tệp được giữ nguyên; hãy hoàn tác chỉnh sửa bị ảnh hưởng và thử lại',
} as const satisfies Record<keyof typeof zh, string>
