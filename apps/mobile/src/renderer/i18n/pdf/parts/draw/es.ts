import type { zh } from './zh'

export const es = {
  pdfDrawSettings: 'Ajustes del lápiz',
  pdfDrawTool: 'Herramienta',
  pdfDrawPen: 'Lápiz',
  pdfDrawRect: 'Rectángulo',
  pdfDrawEllipse: 'Elipse',
  pdfDrawLine: 'Línea',
  pdfDrawArrow: 'Flecha',
  pdfDrawEraser: 'Borrador',
  pdfDrawColor: 'Color',
  pdfDrawColorRed: 'Rojo',
  pdfDrawColorYellow: 'Amarillo',
  pdfDrawColorGreen: 'Verde',
  pdfDrawColorBlue: 'Azul',
  pdfDrawColorBlack: 'Negro',
  pdfDrawWidth: 'Grosor',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Dibujar también con el dedo',
  pdfDrawFingerHint:
    'Activado: el dedo sigue dibujando después de usar un lápiz. Desactivado: una vez usado un lápiz, el dedo mueve la página.',
  pdfDrawEraserHint: 'El borrador solo quita los trazos y las formas que aún no se han guardado.',
  pdfDrawRefused: 'No se puede dibujar ahora. Inténtalo de nuevo en un momento.',
} as const satisfies Record<keyof typeof zh, string>
