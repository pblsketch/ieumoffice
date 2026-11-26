import type { zh } from './zh'

export const vi = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Đang tải lưới…',
  sheetsOpening: 'Đang mở sổ làm việc… Tệp lớn cần một chút thời gian.',
  sheetsPasswordTitle: 'Sổ làm việc được bảo vệ bằng mật khẩu',
  sheetsPasswordMessage: 'Nhập mật khẩu để mở sổ làm việc này.',
  sheetsPasswordLabel: 'Mật khẩu',
  sheetsPasswordWrong: 'Mật khẩu không đúng. Hãy thử lại.',
  sheetsPasswordOpen: 'Mở',
  sheetsPasswordCancel: 'Hủy',
  sheetsEncryptionUnsupported: 'Không thể mở kiểu bảo vệ bằng mật khẩu này.',
  sheetsEncryptionDamaged: 'Sổ làm việc được bảo vệ này bị hỏng và không thể mở.',
  sheetsNoticeMacros: 'Macro được giữ nguyên nhưng không chạy.',
  sheetsNoticeExternalLinks: 'Các ô trỏ tới tệp khác hiển thị giá trị được lưu gần nhất.',
  sheetsNoticeMacrosAndLinks:
    'Macro được giữ nguyên nhưng không chạy. Các ô trỏ tới tệp khác hiển thị giá trị được lưu gần nhất.',
} as const satisfies Record<keyof typeof zh, string>
