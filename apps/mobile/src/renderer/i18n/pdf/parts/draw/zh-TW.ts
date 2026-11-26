import type { zh } from './zh'

export const zhTW = {
  pdfDrawSettings: '筆設定',
  pdfDrawTool: '工具',
  pdfDrawPen: '筆',
  pdfDrawRect: '矩形',
  pdfDrawEllipse: '橢圓',
  pdfDrawLine: '直線',
  pdfDrawArrow: '箭頭',
  pdfDrawEraser: '橡皮擦',
  pdfDrawColor: '顏色',
  pdfDrawColorRed: '紅色',
  pdfDrawColorYellow: '黃色',
  pdfDrawColorGreen: '綠色',
  pdfDrawColorBlue: '藍色',
  pdfDrawColorBlack: '黑色',
  pdfDrawWidth: '粗細',
  pdfDrawWidthValue: '{width} 點',
  pdfDrawFinger: '也用手指繪圖',
  pdfDrawFingerHint: '開啟後，用過觸控筆之後手指仍可繪圖。關閉時，用過觸控筆之後手指用來移動畫面。',
  pdfDrawEraserHint: '橡皮擦只能清除尚未儲存的筆畫和圖形。',
  pdfDrawRefused: '目前無法繪圖。請稍後再試。',
} as const satisfies Record<keyof typeof zh, string>
