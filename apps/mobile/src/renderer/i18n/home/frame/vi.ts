import type { zh } from './zh'

export const vi = {
  homeTabNav: 'Menu màn hình chính',
  homeTabRecent: 'Gần đây',
  homeTabFolders: 'Thư mục',
  homeTabTools: 'Công cụ',
  homeTabSettings: 'Cài đặt',
  homeListAll: 'Tất cả',
  homeListFavorites: 'Yêu thích',
  homeListChips: 'Lọc danh sách',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'Chưa có tệp yêu thích. Dùng [⋯] của tệp để thêm vào yêu thích.',
  homeListGroupEmpty: 'Chưa có tệp nào trong nhóm này.',
  homeListFavoriteLost: 'Không mở được tệp này. Có thể tệp đã bị di chuyển hoặc xóa.',
  homeEmptyText: 'Bạn chưa mở tài liệu nào. Hãy xem tài liệu mẫu hoặc mở một tệp.',
  homeEmptySample: 'Mở tài liệu mẫu',
  homeEmptyCreate: 'Tạo mới',
  homeCreateFab: 'Tạo mới',
  homeCreateTitle: 'Tạo mới',
  homeCreateClose: 'Đóng',
  homeCreatePdfTools: 'Công cụ PDF',
} as const satisfies Record<keyof typeof zh, string>
