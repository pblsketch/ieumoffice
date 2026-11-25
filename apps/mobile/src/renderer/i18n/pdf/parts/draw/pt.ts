import type { zh } from './zh'

export const pt = {
  pdfDrawSettings: 'Configurações da caneta',
  pdfDrawTool: 'Ferramenta',
  pdfDrawPen: 'Caneta',
  pdfDrawRect: 'Retângulo',
  pdfDrawEllipse: 'Elipse',
  pdfDrawLine: 'Linha',
  pdfDrawArrow: 'Seta',
  pdfDrawEraser: 'Borracha',
  pdfDrawColor: 'Cor',
  pdfDrawColorRed: 'Vermelho',
  pdfDrawColorYellow: 'Amarelo',
  pdfDrawColorGreen: 'Verde',
  pdfDrawColorBlue: 'Azul',
  pdfDrawColorBlack: 'Preto',
  pdfDrawWidth: 'Espessura',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Desenhar também com o dedo',
  pdfDrawFingerHint:
    'Ativado: o dedo continua desenhando depois de usar uma caneta. Desativado: depois de usar uma caneta, o dedo move a página.',
  pdfDrawEraserHint: 'A borracha remove apenas traços e formas ainda não salvos.',
  pdfDrawRefused: 'Não é possível desenhar agora. Tente novamente em instantes.',
} as const satisfies Record<keyof typeof zh, string>
