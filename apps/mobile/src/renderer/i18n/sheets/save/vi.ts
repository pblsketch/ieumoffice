import type { zh } from './zh'

export const vi = {
  sheetsShareFailed: 'Không thể chia sẻ tệp này.',
  sheetsSaveFailed: 'Không thể lưu. Tệp gốc vẫn giữ nguyên.',
  sheetsSaveAsTitle: 'Lưu dưới dạng',
  sheetsShareTitle: 'Chia sẻ dưới dạng',
  sheetsFormatWorkbook: 'Sổ làm việc Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Sổ làm việc Excel có macro (.xlsm)',
  sheetsFormatCsv: 'CSV (chỉ trang tính hiện tại)',
  sheetsFormatOds: 'Bảng tính ODS (bản sao sổ làm việc)',
  sheetsFormatPdf: 'PDF (trang tính hiện tại)',
  sheetsOdsEncrypted: 'Không thể xuất sổ làm việc có mật khẩu sang ODS.',
  sheetsChoiceCancel: 'Hủy',
  sheetsCsvAskTitle: 'Lưu tệp CSV',
  sheetsCsvAskMessage: 'Tệp CSV chỉ giữ giá trị của trang tính hiện tại.',
  sheetsCsvAskCsv: 'Lưu dạng CSV (không có định dạng và các trang tính khác)',
  sheetsCsvAskXlsx: 'Lưu dạng tệp Excel',
  sheetsCsvFormulaTitle: 'Công thức chỉ giữ lại giá trị',
  sheetsCsvFormulaMessage:
    'Công thức của trang tính này chỉ được giữ dưới dạng giá trị đã tính trong CSV. Để giữ công thức, hãy lưu dạng tệp Excel.',
  sheetsCsvContinue: 'Tiếp tục với CSV',
  sheetsOdsLossTitle: 'Xuất sang ODS',
  sheetsOdsLossMessage:
    '{count} tính năng mà ODS không chứa được (công thức, biểu đồ, hình ảnh, định dạng có điều kiện, v.v.) sẽ không có trong bản sao.',
  sheetsOdsContinue: 'Tiếp tục',
  sheetsOdsUnreadable: 'Không mở lại được tệp ODS nên tệp không được ghi.',
  sheetsOdsFailed: 'Không xuất được sang ODS.',
  sheetsCopySaved: 'Đã lưu bản sao: {name}',
  sheetsPdfWorking: 'Đang tạo PDF…',
  sheetsPdfFailed: 'Không tạo được PDF.',
  sheetsPdfSkippedVisuals: 'Không đưa được {count} hình ảnh hoặc biểu đồ vào PDF.',
  sheetsPdfMissingGlyphs: '{count} ký tự không có trong phông chữ hiển thị là ô trống trong PDF.',
  sheetsSaveErrDiskChanged:
    'Một ứng dụng khác đã thay đổi tệp gốc sau khi mở. Tệp không bị ghi đè; hãy dùng Lưu dưới dạng.',
  sheetsSaveErrTooLarge:
    'Tệp quá lớn (hơn khoảng 14 MB) để ghi trên điện thoại này. Tệp gốc không thay đổi.',
  sheetsSaveErrUnreadable: 'Không mở lại được sổ làm việc đã lưu nên tệp gốc được giữ nguyên.',
  sheetsSaveErrLockFailed:
    'Không khóa lại được sổ làm việc bằng mật khẩu của nó nên tệp gốc được giữ nguyên.',
  sheetsSaveBusy: 'Đang lưu. Hãy thử lại khi xong.',
} as const satisfies Record<keyof typeof zh, string>
