import type { zh } from './zh'

export const vi = {
  pdfDrawSettings: 'Cài đặt bút',
  pdfDrawTool: 'Công cụ',
  pdfDrawPen: 'Bút',
  pdfDrawRect: 'Hình chữ nhật',
  pdfDrawEllipse: 'Hình elip',
  pdfDrawLine: 'Đường thẳng',
  pdfDrawArrow: 'Mũi tên',
  pdfDrawEraser: 'Tẩy',
  pdfDrawColor: 'Màu',
  pdfDrawColorRed: 'Đỏ',
  pdfDrawColorYellow: 'Vàng',
  pdfDrawColorGreen: 'Xanh lá',
  pdfDrawColorBlue: 'Xanh dương',
  pdfDrawColorBlack: 'Đen',
  pdfDrawWidth: 'Độ dày',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Vẽ cả bằng ngón tay',
  pdfDrawFingerHint:
    'Khi bật, ngón tay vẫn vẽ sau khi đã dùng bút. Khi tắt, sau khi đã dùng bút, ngón tay dùng để di chuyển trang.',
  pdfDrawEraserHint: 'Tẩy chỉ xóa các nét và hình chưa được lưu.',
  pdfDrawRefused: 'Hiện không thể vẽ. Hãy thử lại sau giây lát.',
} as const satisfies Record<keyof typeof zh, string>
