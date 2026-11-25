import type { zh } from './zh'

export const vi = {
  pdfFormAddCheck: 'Thêm dấu kiểm',
  pdfFormAddCross: 'Thêm dấu X',
  pdfFormPlaceCheck: 'Chạm vào trang để đặt dấu kiểm',
  pdfFormPlaceCross: 'Chạm vào trang để đặt dấu X',
  pdfFormCheckMark: 'Dấu kiểm',
  pdfFormCrossMark: 'Dấu X',
  pdfFormDeleteMark: 'Xóa dấu',
  pdfFormDone: 'Xong',
  pdfFormSignField: 'Chạm để ký',
  pdfFormDateInvalid: 'Nhập ngày theo định dạng {format}',
  pdfFormDatePick: 'Chọn ngày',
} as const satisfies Record<keyof typeof zh, string>
