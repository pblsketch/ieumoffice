import type { zh } from './zh'

export const vi = {
  homeFolderListLabel: 'Thư mục đã liên kết',
  homeFolderEmptyTitle: 'Chưa liên kết thư mục nào',
  homeFolderEmptyBody:
    'Liên kết thư mục bạn hay dùng, tài liệu và hình ảnh trong đó sẽ hiện ngay tại đây.',
  homeFolderLink: 'Liên kết thư mục',
  homeFolderRelink: 'Liên kết lại',
  homeFolderRelinkNamed: 'Liên kết lại {name}',
  homeFolderOk: 'Đã liên kết',
  homeFolderLostRevoked: 'Quyền truy cập thư mục này đã mất. Hãy liên kết lại.',
  homeFolderLostMissing:
    'Không tìm thấy thư mục này. Nếu bạn đã chuyển hoặc xóa nó, hãy liên kết lại.',
  homeFolderLost: 'Không truy cập được thư mục. Hãy liên kết lại.',
  homeFolderMenu: 'Menu của {name}',
  homeFolderRemove: 'Gỡ',
  homeFolderRemoveTitle: 'Gỡ thư mục "{name}"?',
  homeFolderRemoveBody:
    '{count} mục gần đây và yêu thích của các tệp trong thư mục này cũng sẽ bị gỡ. Bản thân các tệp vẫn còn.',
  homeFolderRemoved: 'Đã gỡ thư mục.',
  homeFolderBack: 'Lên thư mục trên',
  homeFolderPath: 'Thư mục hiện tại',
  homeFolderSubfolder: 'Thư mục',
  homeFolderInsideEmpty: 'Thư mục này không có tài liệu hay hình ảnh nào để mở.',
} as const satisfies Record<keyof typeof zh, string>
