import type { zh } from './zh'

export const zhTW = {
  pdfTextHint: '點按空白處新增文字，點按文字即可修改。',
  pdfTextInputLabel: '要新增的文字',
  pdfTextEditLabel: '要修改的文字',
  pdfTextStyleBar: '文字樣式',
  pdfTextBold: '粗體',
  pdfTextSize: '字型大小',
  pdfTextSizeDown: '縮小字型',
  pdfTextSizeUp: '放大字型',
  pdfTextColor: '文字顏色',
  pdfTextColorDocument: '保留文件顏色',
  pdfTextFont: '字型',
  pdfTextFontDocument: '文件字型',
  pdfTextBack: '返回',
  pdfTextDelete: '刪除',
  pdfTextDone: '確定',
  pdfTextCannotDraw: '無法新增這些字元：{chars}',
  pdfTextFontSubstituted: '這些字元將改用其他字型：{chars}',
  pdfTextScannedPage: '此頁沒有文字。只能新增文字。',
  pdfTextNoMatch: '無法修改此文字：在文件中找不到它。',
  pdfTextOverflow: '修改後的文字會與下方內容重疊，請縮短文字。',
} as const satisfies Record<keyof typeof zh, string>
