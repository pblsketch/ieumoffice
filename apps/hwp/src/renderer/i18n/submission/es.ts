import type { zh } from './zh'

export const es = {
  staleDialogTitle: 'Hay elementos que requieren actualización',
  staleDialogBody:
    'Los siguientes elementos pueden haber quedado desactualizados tras los cambios recientes. ¿Actualizarlos antes de continuar?',
  staleActionSave: 'Guardar',
  staleActionPrint: 'Imprimir',
  staleActionPdf: 'Exportar a PDF',
  staleActionSubmission: 'Guardar copia de entrega',
  staleBtnRefreshAll: 'Actualizar todo',
  staleBtnContinue: 'Continuar sin actualizar',
  staleBtnCancel: 'Cancelar',
  staleReasonPagesChanged: 'Cambiaron los números de página',
  staleReasonEntriesChanged: 'Cambiaron las entradas',
  staleKindTocBody: 'Índice de contenido',
  staleKindTocTable: 'Índice de tablas',
  staleKindTocFigure: 'Índice de figuras',
  staleKindTocEquation: 'Índice de ecuaciones',
  staleKindIndex: 'Índice alfabético',
  staleKindBibliography: 'Bibliografía',
  staleManualConfirmTitle: 'Se detectaron cambios manuales',
  staleManualConfirmBody:
    'Se encontraron ediciones manuales en: {items}. ¿Sobrescribirlas y actualizar?',
  staleManualOverwrite: 'Sobrescribir y actualizar',
  staleManualSkip: 'Omitir',
  staleRefreshDone: 'Se actualizaron {count} elementos.',
  staleRefreshFailed: 'No se pudieron actualizar algunos elementos: {error}',
  submissionMenuLabel: 'Guardar como copia de entrega…',
  submissionMenuDesc:
    'Guarda una copia limpia aparte sin marcas de índice, citas ni ajustes.',
  submissionSaving: 'Creando copia de entrega…',
  submissionSaved: 'Copia de entrega guardada: {name}',
  submissionSavedTailsLost:
    'Copia de entrega guardada ({name}). Es posible que no se hayan conservado algunas páginas maestras o comentarios.',
  submissionFailedProtected:
    'Los documentos protegidos con contraseña no se pueden guardar como copia de entrega.',
  submissionFailedTracked:
    'Los documentos con control de cambios no se pueden guardar como copia de entrega.',
  submissionFailedVerify:
    'Error al verificar la copia de entrega ({before} → {after} páginas). Intenta guardarla en formato HWPX.',
  submissionFailedExport: 'No se pudo generar la copia de entrega: {error}',
  submissionFailedWrite: 'No se pudo guardar la copia de entrega: {error}',
} satisfies Record<keyof typeof zh, string>
