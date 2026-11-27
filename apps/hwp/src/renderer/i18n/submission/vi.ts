import type { zh } from './zh'

export const vi = {
  staleDialogTitle: 'Có mục cần được cập nhật',
  staleDialogBody:
    'Các mục sau có thể đã cũ sau những chỉnh sửa gần đây. Bạn có muốn làm mới trước khi tiếp tục không?',
  staleActionSave: 'Lưu',
  staleActionPrint: 'In',
  staleActionPdf: 'Xuất PDF',
  staleActionSubmission: 'Lưu bản nộp',
  staleBtnRefreshAll: 'Làm mới tất cả',
  staleBtnContinue: 'Vẫn tiếp tục',
  staleBtnCancel: 'Hủy',
  staleReasonPagesChanged: 'Số trang đã thay đổi',
  staleReasonEntriesChanged: 'Nội dung mục đã thay đổi',
  staleKindTocBody: 'Mục lục',
  staleKindTocTable: 'Danh mục bảng',
  staleKindTocFigure: 'Danh mục hình',
  staleKindTocEquation: 'Danh mục công thức',
  staleKindIndex: 'Chỉ mục',
  staleKindBibliography: 'Tài liệu tham khảo',
  staleManualConfirmTitle: 'Phát hiện chỉnh sửa thủ công',
  staleManualConfirmBody:
    'Đã phát hiện chỉnh sửa thủ công trong: {items}. Ghi đè và làm mới?',
  staleManualOverwrite: 'Ghi đè và làm mới',
  staleManualSkip: 'Bỏ qua',
  staleRefreshDone: 'Đã cập nhật {count} mục.',
  staleRefreshFailed: 'Không thể cập nhật một số mục: {error}',
  submissionMenuLabel: 'Lưu bản nộp…',
  submissionMenuDesc:
    'Lưu một bản sao sạch riêng biệt đã loại bỏ dấu chỉ mục, trích dẫn và cài đặt.',
  submissionSaving: 'Đang tạo bản nộp…',
  submissionSaved: 'Đã lưu bản nộp: {name}',
  submissionSavedTailsLost:
    'Đã lưu bản nộp ({name}). Một số trang chủ hoặc ghi chú có thể không được giữ lại.',
  submissionFailedProtected: 'Không thể lưu tài liệu có mật khẩu thành bản nộp.',
  submissionFailedTracked: 'Không thể lưu tài liệu có theo dõi thay đổi thành bản nộp.',
  submissionFailedVerify:
    'Xác minh bản nộp thất bại ({before} → {after} trang). Hãy thử lưu ở định dạng HWPX.',
  submissionFailedExport: 'Không thể tạo bản nộp: {error}',
  submissionFailedWrite: 'Không thể lưu bản nộp: {error}',
} satisfies Record<keyof typeof zh, string>
