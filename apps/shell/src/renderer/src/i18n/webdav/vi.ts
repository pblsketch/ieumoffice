import type { zh } from './zh'

export const vi = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Kết nối máy chủ WebDAV (như Nextcloud hoặc Synology NAS) để mở tệp của nó ngay tại đây. Khi lưu, thay đổi được gửi lại máy chủ.',
  webdavNoServers: 'Chưa kết nối máy chủ nào.',
  webdavAdd: 'Thêm máy chủ',
  webdavFieldName: 'Tên',
  webdavFieldUrl: 'Địa chỉ máy chủ',
  webdavFieldUser: 'Tên người dùng',
  webdavFieldPassword: 'Mật khẩu hoặc mật khẩu ứng dụng',
  webdavUserHint: 'Để trống tên người dùng nếu máy chủ không yêu cầu đăng nhập.',
  webdavInsecureWarn:
    'Đây là kết nối HTTP không mã hóa. Mật khẩu và tệp đi qua mạng ở dạng đọc được.',
  webdavInsecureConfirm: 'Tôi hiểu rủi ro và muốn dùng HTTP',
  webdavSave: 'Kết nối',
  webdavCancel: 'Hủy',
  webdavChecking: 'Đang kiểm tra kết nối…',
  webdavRemove: 'Xóa máy chủ',
  webdavRemoveConfirm:
    'Xóa kết nối tới máy chủ này khỏi PC này? Các tệp trên máy chủ không bị xóa.',
  webdavRemoveYes: 'Xóa',
  webdavNeedPassword: 'PC này không thể lưu mật khẩu ở dạng mã hóa. Hãy nhập lại.',
  webdavNotPersisted:
    'PC này không thể lưu mật khẩu ở dạng mã hóa, nên bạn sẽ phải nhập lại sau khi đóng ứng dụng.',
  webdavPrivacy:
    'Mật khẩu chỉ nằm trên PC này, được hệ thống mã hóa. Tệp chỉ đi qua lại giữa PC này và máy chủ bạn nhập, khi bạn mở hoặc lưu chúng.',
  webdavEmptyTitle: 'Chưa kết nối máy chủ WebDAV',
  webdavEmptyBody: 'Thêm máy chủ trong Cài đặt → Tích hợp, rồi duyệt và mở tệp của nó tại đây.',
  webdavOpenSettings: 'Mở Cài đặt',
  webdavRoot: 'Gốc',
  webdavFolderEmpty: 'Thư mục này trống.',
  webdavLoading: 'Đang tải…',
  webdavRefresh: 'Làm mới',
  webdavUnsupported: 'Ứng dụng không mở được định dạng này',
  webdavOpening: 'Đang mở…',
  webdavServer: 'Máy chủ',
  webdavErrUrl: 'Địa chỉ không hợp lệ. Hãy nhập địa chỉ đầy đủ bắt đầu bằng https:// hoặc http://.',
  webdavErrInsecure: 'Hãy đánh dấu xác nhận trước khi dùng kết nối HTTP không mã hóa.',
  webdavErrAuth:
    'Máy chủ từ chối đăng nhập. Hãy kiểm tra tên người dùng và mật khẩu (nhiều dịch vụ yêu cầu mật khẩu ứng dụng).',
  webdavErrNotFound: 'Không có thư mục hoặc tệp đó trên máy chủ.',
  webdavErrForbidden: 'Tài khoản này không được phép làm việc đó.',
  webdavErrNetwork: 'Không kết nối được máy chủ. Hãy kiểm tra địa chỉ và mạng.',
  webdavErrLimit: 'Bạn có thể kết nối tối đa 10 máy chủ.',
  webdavErrTooLarge: 'Tệp quá lớn để mở.',
  webdavErrRateLimit: 'Máy chủ yêu cầu thử lại sau.',
  webdavErrLocked: 'Người khác đã khóa tệp này.',
  webdavErrDisk: 'Không thể lưu tệp vào PC này.',
} satisfies Record<keyof typeof zh, string>
