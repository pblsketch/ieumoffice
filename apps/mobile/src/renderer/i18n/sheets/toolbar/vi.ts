import type { zh } from './zh'

export const vi = {
  sheetsToolbarFormat: 'Định dạng ô',
  sheetsToolbarRows: 'Hàng và cột',
  sheetsToolbarSort: 'Sắp xếp và lọc',
  sheetsToolbarInsert: 'Chèn',
  sheetsToolbarInsertValues: 'Ngày và trang tính',
  sheetsToolbarToday: 'Ngày hôm nay',
  sheetsToolbarTimeNow: 'Giờ hiện tại',
  sheetsToolbarNewSheet: 'Trang tính mới',
  sheetsToolbarFind: 'Tìm',
  sheetsToolbarViewOnly:
    'Biểu đồ, PivotTable và định dạng có điều kiện ở đây chỉ để xem. Hãy mở tệp trên máy tính để thay đổi.',
  sheetsToolbarFullLoaded: 'Đã tải toàn bộ sổ làm việc. Hãy chạm lại vào sắp xếp hoặc lọc.',
} as const satisfies Record<keyof typeof zh, string>
