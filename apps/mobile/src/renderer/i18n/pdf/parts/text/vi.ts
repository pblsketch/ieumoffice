import type { zh } from './zh'

export const vi = {
  pdfTextHint: 'Chạm vào chỗ trống để thêm chữ, hoặc chạm vào chữ để sửa.',
  pdfTextInputLabel: 'Chữ cần thêm',
  pdfTextEditLabel: 'Chữ cần sửa',
  pdfTextStyleBar: 'Kiểu chữ',
  pdfTextBold: 'Đậm',
  pdfTextSize: 'Cỡ chữ',
  pdfTextSizeDown: 'Thu nhỏ chữ',
  pdfTextSizeUp: 'Phóng to chữ',
  pdfTextColor: 'Màu chữ',
  pdfTextColorDocument: 'Giữ màu của tài liệu',
  pdfTextFont: 'Phông chữ',
  pdfTextFontDocument: 'Phông chữ của tài liệu',
  pdfTextBack: 'Quay lại',
  pdfTextDelete: 'Xóa',
  pdfTextDone: 'Xong',
  pdfTextCannotDraw: 'Không thể thêm các ký tự này: {chars}',
  pdfTextFontSubstituted: 'Các ký tự này sẽ dùng phông chữ khác: {chars}',
  pdfTextScannedPage: 'Trang này không có chữ. Bạn chỉ có thể thêm chữ mới.',
  pdfTextNoMatch: 'Không thể sửa đoạn chữ này: không tìm thấy trong tài liệu.',
  pdfTextOverflow: 'Chữ đã sửa sẽ đè lên chữ bên dưới. Hãy rút ngắn lại.',
} as const satisfies Record<keyof typeof zh, string>
