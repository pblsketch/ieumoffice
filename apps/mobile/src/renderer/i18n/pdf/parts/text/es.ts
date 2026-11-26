import type { zh } from './zh'

export const es = {
  pdfTextHint: 'Toca un espacio vacío para añadir texto o toca un texto para editarlo.',
  pdfTextInputLabel: 'Texto que añadir',
  pdfTextEditLabel: 'Texto que editar',
  pdfTextStyleBar: 'Estilo del texto',
  pdfTextBold: 'Negrita',
  pdfTextSize: 'Tamaño del texto',
  pdfTextSizeDown: 'Texto más pequeño',
  pdfTextSizeUp: 'Texto más grande',
  pdfTextColor: 'Color del texto',
  pdfTextColorDocument: 'Mantener el color del documento',
  pdfTextFont: 'Fuente',
  pdfTextFontDocument: 'Fuente del documento',
  pdfTextBack: 'Atrás',
  pdfTextDelete: 'Eliminar',
  pdfTextDone: 'Aceptar',
  pdfTextCannotDraw: 'No se pueden añadir estos caracteres: {chars}',
  pdfTextFontSubstituted: 'Estos caracteres usarán otra fuente: {chars}',
  pdfTextScannedPage: 'Esta página no tiene texto. Solo puedes añadir texto nuevo.',
  pdfTextNoMatch: 'No se puede editar este texto: no se encontró en el documento.',
  pdfTextOverflow: 'El texto editado se superpondría al texto de abajo. Acórtalo.',
} as const satisfies Record<keyof typeof zh, string>
