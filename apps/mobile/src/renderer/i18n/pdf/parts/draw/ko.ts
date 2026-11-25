import type { zh } from './zh'

export const ko = {
  pdfDrawSettings: '펜 설정',
  pdfDrawTool: '도구',
  pdfDrawPen: '펜',
  pdfDrawRect: '사각형',
  pdfDrawEllipse: '원',
  pdfDrawLine: '선',
  pdfDrawArrow: '화살표',
  pdfDrawEraser: '지우개',
  pdfDrawColor: '색',
  pdfDrawColorRed: '빨강',
  pdfDrawColorYellow: '노랑',
  pdfDrawColorGreen: '초록',
  pdfDrawColorBlue: '파랑',
  pdfDrawColorBlack: '검정',
  pdfDrawWidth: '굵기',
  pdfDrawWidthValue: '{width}pt',
  pdfDrawFinger: '손가락으로도 그리기',
  pdfDrawFingerHint:
    '켜면 펜을 쓴 뒤에도 손가락으로 그립니다. 끄면 펜을 쓴 뒤로는 손가락이 화면을 움직입니다.',
  pdfDrawEraserHint: '지우개는 아직 저장하지 않은 획과 도형만 지웁니다.',
  pdfDrawRefused: '지금은 그릴 수 없습니다. 잠시 뒤 다시 해 보세요.',
} as const satisfies Record<keyof typeof zh, string>
