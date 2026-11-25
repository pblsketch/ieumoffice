import type { zh } from './zh'

export const vi = {
  homeSetEditorsTitle: 'Trình soạn thảo',
  homeSetEditorsHint:
    'Trình soạn thảo đã tắt sẽ không có trong danh sách tài liệu mới. Tắt hết thì xem như bật hết.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Công cụ PDF',
  homeSetCardsTitle: 'Tài liệu mới trên màn hình chính',
  homeSetCardShow: 'Hiện {name} trên màn hình chính',
  homeSetCardUp: 'Đưa {name} lên',
  homeSetCardDown: 'Đưa {name} xuống',
  homeSetKeepScreenOn: 'Giữ màn hình sáng khi đọc',
  homeSetKeepScreenOnDesc: 'Màn hình không tắt khi bạn đọc PDF, EPUB hoặc trình chiếu PPT.',
  homeSetFoldersTitle: 'Thư mục tài liệu',
  homeSetFoldersEmpty:
    'Chưa liên kết thư mục nào. Liên kết thư mục để xem tệp ngay trong thẻ Thư mục.',
  homeSetFolderLink: 'Liên kết thư mục',
  homeSetFolderRelink: 'Liên kết lại',
  homeSetFolderRemove: 'Gỡ',
  homeSetFolderRemoveNamed: 'Gỡ {name}',
  homeSetFolderOk: 'Đã liên kết',
  homeSetFolderLost:
    'Không truy cập được thư mục này. Nếu bạn đã chuyển hoặc xóa nó, hãy liên kết lại.',
  homeSetFolderRemoveTitle: 'Gỡ thư mục "{name}"?',
  homeSetFolderRemoveBody:
    '{count} mục gần đây và yêu thích của các tệp trong thư mục này cũng sẽ bị gỡ. Bản thân các tệp vẫn còn.',
  homeSetBackupsTotal: 'Tổng {size}',
  homeSetStorageTitle: 'Bộ nhớ',
  homeSetStorageRecovery: 'Bản sao khôi phục',
  homeSetStorageTemp: 'Tệp tạm',
  homeSetStorageBackups: 'Sao lưu tệp gốc HWP',
  homeSetStorageClearTemp: 'Xóa tệp tạm',
  homeSetStorageClearRecovery: 'Xóa mọi bản sao khôi phục',
  homeSetStorageClearTempTitle: 'Xóa tệp tạm?',
  homeSetStorageClearTempBody:
    'Các tệp tạo tạm khi chia sẻ hoặc nhận sẽ bị xóa. Tài liệu của bạn vẫn giữ nguyên.',
  homeSetStorageClearRecoveryTitle: 'Xóa mọi bản sao khôi phục?',
  homeSetStorageClearRecoveryBody:
    'Các thay đổi chưa lưu sẽ mất. Bản sao khôi phục của tài liệu đang mở được giữ lại.',
  homeSetStorageClearAction: 'Xóa',
  homeSetStorageCleared: 'Đã giải phóng {size}.',
  homeSetFailed: 'Không thực hiện được. Hãy thử lại sau giây lát.',
} as const satisfies Record<keyof typeof zh, string>
