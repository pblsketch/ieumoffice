import type { zh } from './zh'

export const es = {
  pdfViewEditorName: 'Editor de PDF',
  pdfViewLoading: 'Abriendo…',
  pdfViewOpenFailed: 'No se pudo abrir este PDF. Puede que el archivo esté dañado o no sea un PDF.',
  pdfViewCertEncrypted:
    'Este PDF está protegido con un certificado, no con una contraseña. Ábralo en la aplicación que lo emitió.',
  pdfViewBlankUnavailable: 'No se pudo crear un PDF nuevo.',
  pdfViewPagesFailed: 'Algunas páginas no se pudieron leer y se muestran en blanco.',
  pdfViewPageBroken: 'No se puede mostrar esta página',
  pdfViewPageLabel: 'Página {page}',
  pdfViewPageIndicator: 'Página {page} de {count}',
  pdfViewInternalLink: 'Ir a la página enlazada',
  pdfViewPasswordTitle: 'Este PDF está cifrado',
  pdfViewPasswordBody:
    '«{name}» está protegido con contraseña. Escriba la contraseña para abrirlo.',
  pdfViewPasswordLabel: 'Contraseña',
  pdfViewPasswordPlaceholder: 'Introduce la contraseña',
  pdfViewPasswordShow: 'Mostrar contraseña',
  pdfViewPasswordHide: 'Ocultar contraseña',
  pdfViewPasswordOpen: 'Abrir',
  pdfViewPasswordWrong: 'Contraseña incorrecta, inténtalo de nuevo',
  pdfViewReadOnlyEncrypted: 'El documento cifrado es de solo lectura',
  pdfViewReadOnlyDamaged:
    'Archivo dañado: las páginas ilegibles se muestran en blanco, solo lectura',
  pdfViewReadOnlyNotWritable:
    'Este archivo no se puede guardar en su ubicación, así que es de solo lectura',
  pdfViewSearch: 'Buscar',
  pdfViewSearchPlaceholder: 'Buscar en el documento',
  pdfViewSearching: 'Buscando…',
  pdfViewSearchNone: 'Sin resultados',
  pdfViewSearchPrev: 'Anterior',
  pdfViewSearchNext: 'Siguiente',
  pdfViewSearchClose: 'Cerrar búsqueda',
  pdfViewOutline: 'Esquema',
  pdfViewOutlineEmpty: 'Este documento no tiene esquema',
  pdfViewGoToPage: 'Ir a la página',
  pdfViewGoToPageLabel: 'Número de página (1–{count})',
  pdfViewGoToPageGo: 'Ir',
  pdfViewGoToPageInvalid: 'Escribe un número del 1 al {count}',
} as const satisfies Record<keyof typeof zh, string>
