import type { zh } from './zh'

export const vi = {
  sheetsProvisionalNotice: 'Lưới dùng thử: thay đổi của bạn chưa được lưu.',
  sheetsLoading: 'Đang tải lưới…',
  sheetsShareFailed: 'Không thể chia sẻ tệp này.',
  sheetsFreezeTopRow: 'Cố định hàng trên cùng',
  sheetsFreezeFirstColumn: 'Cố định cột đầu tiên',
  sheetsUnfreeze: 'Bỏ cố định ngăn',
  sheetsKeyboardBar: 'Công cụ nhập công thức',
  sheetsInsertSum: 'Hàm tổng',
  sheetsInsertParens: 'Dấu ngoặc',
  sheetsNumericKeys: 'Bàn phím số',
  sheetsCancelEdit: 'Hủy',
  sheetsConfirmEdit: 'Xong',
} as const satisfies Record<keyof typeof zh, string>
