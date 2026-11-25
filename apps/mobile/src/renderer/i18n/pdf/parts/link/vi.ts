import type { zh } from './zh'

export const vi = {
  pdfLinkPlaceHint: 'Kéo một khung trên trang tại chỗ đặt liên kết',
  pdfLinkEditTitle: 'Sửa liên kết',
  pdfLinkUrlLabel: 'Địa chỉ web (http, https, mailto)',
  pdfLinkPageLabel: 'Hoặc một trang trong tài liệu này (1–{count})',
  pdfLinkUrlInvalid: 'Chỉ có thể liên kết địa chỉ http, https và mailto',
  pdfLinkPageInvalid: 'Nhập số trang từ 1 đến {count}',
  pdfLinkNeedTarget: 'Nhập địa chỉ web hoặc số trang',
  pdfLinkApply: 'Thêm liên kết',
  pdfLinkDelete: 'Xóa liên kết',
  pdfLinkPending: 'Liên kết sẽ thêm: {target}',
  pdfLinkToPage: 'Trang {page}',
  pdfLinkFailed: 'Không thể thay đổi liên kết. Hãy thử lại khi lưu xong.',
  pdfLinkUpdate: 'Áp dụng',
} as const satisfies Record<keyof typeof zh, string>
