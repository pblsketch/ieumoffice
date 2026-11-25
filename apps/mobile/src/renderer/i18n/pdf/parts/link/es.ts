import type { zh } from './zh'

export const es = {
  pdfLinkPlaceHint: 'Arrastre un recuadro en la página donde irá el enlace',
  pdfLinkEditTitle: 'Editar enlace',
  pdfLinkUrlLabel: 'Dirección web (http, https, mailto)',
  pdfLinkPageLabel: 'O una página de este documento (1–{count})',
  pdfLinkUrlInvalid: 'Solo se pueden enlazar direcciones http, https y mailto',
  pdfLinkPageInvalid: 'Introduzca un número de página del 1 al {count}',
  pdfLinkNeedTarget: 'Introduzca una dirección web o un número de página',
  pdfLinkApply: 'Añadir enlace',
  pdfLinkDelete: 'Eliminar enlace',
  pdfLinkPending: 'Enlace pendiente: {target}',
  pdfLinkToPage: 'Página {page}',
  pdfLinkFailed: 'No se pudo cambiar el enlace. Inténtelo de nuevo cuando termine el guardado.',
  pdfLinkUpdate: 'Aplicar',
} as const satisfies Record<keyof typeof zh, string>
