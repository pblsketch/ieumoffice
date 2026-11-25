import type { zh } from './zh'

export const es = {
  pdfEditPen: 'Lápiz',
  pdfEditHighlighter: 'Resaltador',
  pdfEditTextBox: 'Cuadro de texto',
  pdfEditSign: 'Firmar',
  pdfEditPages: 'Organizar páginas',
  pdfEditLink: 'Insertar enlace',
  pdfEditSaveFailed: 'No se pudo guardar. Tus cambios se conservan y el archivo no se modificó.',
  pdfEditSaveSkipped: 'No se pudieron guardar algunas ediciones de texto de la página {pages}.',
  pdfEditShareFailed: 'No se pudo compartir.',
  pdfEditReloadFailed:
    'Se guardó, pero no se pudo volver a cargar el documento. Vuelve a abrir el archivo.',
  pdfEditSignatureUnavailable: 'La firma aún no está disponible.',
  pdfEditSaveAsHint:
    'Elige cómo se tratan los resaltados, las notas y los dibujos en la copia. «Integrar en las páginas» también integra los campos de formulario; «Omitir anotaciones» conserva enlaces y campos.',
  pdfEditKeepAnnots: 'Conservar anotaciones (editables en otras aplicaciones)',
  pdfEditFlattenAnnots: 'Integrar en las páginas (visible en todas las aplicaciones)',
  pdfEditStripAnnots: 'Omitir anotaciones (enlaces y campos permanecen)',
  pdfEditSaveVerifyFailed:
    'Los cambios de la página {pages} no se pudieron escribir íntegramente; se canceló el guardado y el archivo quedó intacto. Deshaz la edición afectada e inténtalo de nuevo',
} as const satisfies Record<keyof typeof zh, string>
