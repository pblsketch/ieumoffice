import type { zh } from './zh'

export const es = {
  pdfAnnotHighlight: 'Resaltar',
  pdfAnnotUnderline: 'Subrayar',
  pdfAnnotSquiggly: 'Ondulado',
  pdfAnnotStrikeout: 'Tachar',
  pdfAnnotModeSelect: 'Seleccionar texto',
  pdfAnnotModeNote: 'Colocar nota',
  pdfAnnotHintSelect:
    'Arrastra en horizontal sobre el texto, o mantén pulsado y luego arrastra, para seleccionar. Toca una marca para cambiar su color o quitarla.',
  pdfAnnotHintNote: 'Toca donde quieras colocar la nota.',
  pdfAnnotPen: 'Resaltador {n}',
  pdfAnnotColor: 'Color {n}',
  pdfAnnotRemove: 'Quitar marca',
  pdfAnnotMarkupTitle: 'Color de la marca',
  pdfAnnotClearSelection: 'Quitar selección',
  pdfAnnotNoText: 'Esta página no tiene texto seleccionable.',
  pdfAnnotOpenNote: 'Abrir nota',
  pdfAnnotFailed: 'No se pudo cambiar la anotación.',
  pdfAnnotNewNote: 'Nota nueva',
  pdfAnnotReplyPlaceholder: 'Escribe una respuesta',
} as const satisfies Record<keyof typeof zh, string>
