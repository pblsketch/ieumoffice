import type { zh } from './zh'

export const es = {
  homeRunEditorOffTitle: 'El editor {name} está desactivado',
  homeRunEditorOffBody:
    'Actívalo para abrir este archivo. Puedes volver a desactivarlo en Ajustes.',
  homeRunEditorOffConfirm: 'Activar y abrir',
  homeRunStripSample: 'Documento de ejemplo · Solo lectura',
  homeRunStripReceived: 'Archivo recibido · Solo lectura',
  homeRunStripReadOnly: 'Solo lectura',
  homeRunStripCopy: 'Editar una copia',
  homeRunStripClose: 'Cerrar aviso',
  homeRunReceiveTitle: 'Archivos recibidos',
  homeRunReceiveCount: '{count} archivos',
  homeRunReceiveClose: 'Cerrar archivos recibidos',
  homeRunReceiveOpen: 'Abrir',
  homeRunReceivePdfOff: 'Las herramientas PDF están desactivadas',
  homeRunReceivePdfOn: 'Activar y continuar',
  homeRunGuideLabel: 'Guía de bienvenida',
  homeRunStep: 'Paso {current} de {total}',
  homeRunWelcomeTitle: 'Te damos la bienvenida',
  homeRunWelcomeBody:
    'Abre y edita documentos HWP, PDF, Markdown y más con GenOffice. Sin cuenta, sin anuncios, y tus documentos se quedan en este dispositivo.',
  homeRunNext: 'Siguiente',
  homeRunSkip: 'Omitir',
  homeRunFolderTitle: 'Vincular una carpeta de documentos (opcional)',
  homeRunFolderBody:
    'Vincula una carpeta que uses a menudo y sus archivos aparecerán directamente en la pestaña [Carpetas].',
  homeRunFolderPick: 'Elegir carpeta',
  homeRunLater: 'Más tarde',
  homeRunFolderLinked: '✓ Carpeta de documentos vinculada · Puedes cambiarla en Ajustes',
  homeRunStart: 'Empezar',
  homeRunTipEditButton: 'Para hacer cambios, toca [Editar]',
  homeRunTipFlowView:
    'Cambiamos a la vista continua para leer mejor · La vista de página está aquí',
  homeRunTipFirstEdit:
    'Se crea una copia de recuperación automáticamente. El original se guarda al tocar [Listo]',
  homeRunTipFirstKeyboard: 'Cambia el formato del texto con [Aa]',
} as const satisfies Record<keyof typeof zh, string>
