import type { zh } from './zh'

export const vi = {
  homeRunEditorOffTitle: 'Trình soạn thảo {name} đang tắt',
  homeRunEditorOffBody: 'Hãy bật lên để mở tệp này. Bạn có thể tắt lại trong Cài đặt.',
  homeRunEditorOffConfirm: 'Bật và mở',
  homeRunStripSample: 'Tài liệu mẫu · Chỉ đọc',
  homeRunStripReceived: 'Tệp đã nhận · Chỉ đọc',
  homeRunStripReadOnly: 'Chỉ đọc',
  homeRunStripCopy: 'Sửa bản sao',
  homeRunStripClose: 'Đóng thông báo',
  homeRunReceiveTitle: 'Tệp đã nhận',
  homeRunReceiveCount: '{count} tệp',
  homeRunReceiveClose: 'Đóng tệp đã nhận',
  homeRunReceiveOpen: 'Mở',
  homeRunReceivePdfOff: 'Công cụ PDF đang tắt',
  homeRunReceivePdfOn: 'Bật và tiếp tục',
  homeRunGuideLabel: 'Hướng dẫn bắt đầu',
  homeRunWelcomeTitle: 'Chào mừng',
  homeRunWelcomeBody:
    'Mở và chỉnh sửa tài liệu HWP, PDF, Markdown và nhiều loại khác bằng GenOffice. Không cần tài khoản, không quảng cáo, tài liệu chỉ nằm trên thiết bị này.',
  homeRunStart: 'Bắt đầu',
  homeRunTipEditButton: 'Để thay đổi, chạm vào [Chỉnh sửa]',
  homeRunTipFlowView: 'Đã chuyển sang chế độ đọc · Xem theo trang ở đây',
  homeRunTipFirstEdit:
    'Bản sao khôi phục được tạo tự động. Bản gốc được lưu khi bạn chạm vào [Xong]',
  homeRunTipFirstKeyboard: 'Đổi định dạng chữ bằng [Aa]',
} as const satisfies Record<keyof typeof zh, string>
