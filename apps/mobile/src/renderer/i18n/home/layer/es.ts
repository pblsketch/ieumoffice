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
  homeRunWelcomeTitle: 'Te damos la bienvenida',
  homeRunWelcomeBody:
    'Abre y edita documentos HWP, PDF, Markdown y más con GenOffice. Sin cuenta, sin anuncios, y tus documentos se quedan en este dispositivo.',
  homeRunStart: 'Empezar',
  homeRunTipEditButton: 'Para hacer cambios, toca [Editar]',
  homeRunTipFlowView: 'Para leer ajustado a la pantalla, toca [Vista de lectura]',
  homeRunTipFirstEdit:
    'Se crea una copia de recuperación automáticamente. El original se guarda al tocar [Listo]',
  homeRunTipFirstKeyboard: 'Cambia el formato del texto con [Aa]',
} as const satisfies Record<keyof typeof zh, string>
