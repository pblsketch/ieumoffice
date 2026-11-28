import type { zh } from './zh'

export const es = {
  homeHelpSection: 'Ayuda',
  homeHelpClose: 'Cerrar',
  homeHelpReplay: 'Ver de nuevo la guía de bienvenida',
  homeHelpReplayFailed:
    'No se pudo volver a activar la guía de bienvenida. Inténtalo de nuevo en un momento.',
  homeHelpFeedback: 'Enviar comentarios',
  homeHelpWhatsNew: 'Novedades de esta versión',

  homeHelpOpenTitle: 'Abrir documentos',
  homeHelpOpenBody1:
    'En la pestaña «Recientes», toca «Abrir archivo» para elegir un documento de este dispositivo o de otra app de almacenamiento.',
  homeHelpOpenBody2:
    'Vincula una carpeta que uses a menudo y sus documentos aparecerán enseguida en la pestaña «Carpetas».',
  homeHelpOpenBody3:
    'Los documentos que abres se quedan en la pestaña «Recientes». Márcalos con una estrella para encontrarlos también en «Favoritos».',
  homeHelpOpenBody4:
    'Los documentos se abren primero para leer. Cuando quieras cambiar algo, toca [Editar].',

  homeHelpEditTitle: 'Editar y guardar',
  homeHelpEditBody1: 'En modo lectura, toca [Editar] arriba para empezar a hacer cambios.',
  homeHelpEditBody2:
    'Toca el texto para que aparezca el teclado. La barra de encima tiene formatos como negrita y listas.',
  homeHelpEditBody3:
    'Cuando termines, toca [Listo]. Se guarda el archivo original y vuelves al modo lectura.',
  homeHelpEditBody4:
    'Si no se puede escribir en el archivo original, usa «Guardar como» para crear un archivo nuevo.',

  homeHelpRecoveryTitle: 'Guardado y copias de recuperación',
  homeHelpRecoveryBody1:
    'Mientras editas, la app guarda una copia de recuperación por su cuenta. No tienes que tocar nada.',
  homeHelpRecoveryBody2: 'El archivo original se guarda al tocar [Listo].',
  homeHelpRecoveryBody3:
    'Si la app se cierra antes de guardar, la próxima vez aparecerá un aviso de la copia de recuperación arriba en la pestaña «Recientes». Restáurala desde ahí.',
  homeHelpRecoveryBody4:
    'En Ajustes > Almacenamiento puedes ver cuánto espacio ocupan las copias de recuperación y borrarlas.',

  homeHelpShareTitle: 'Compartir y recibir',
  homeHelpShareBody1:
    'Mientras ves un documento, toca [Compartir] para enviar el original tal cual o en otro formato, como PDF.',
  homeHelpShareBody2:
    'En una lista de la pantalla de inicio, elige [⋯] > Compartir para enviar el archivo original. Mantén pulsado para seleccionar varios archivos y enviarlos juntos.',
  homeHelpShareBody3:
    'Un archivo que llega desde otra app se abre en solo lectura. Para cambiarlo, toca [Editar una copia]. El original no cambia.',

  homeHelpFlowTitle: 'Vista de lectura para HWP',
  homeHelpFlowBody1:
    'Los documentos HWP se abren en vista de página tal como se imprimirían. Para ajustar el texto al ancho de la pantalla, toca [Vista de lectura] en las herramientas de vista.',
  homeHelpFlowBody2:
    'Para volver al diseño de página impresa, toca [Vista de página] en las herramientas de vista.',
  homeHelpFlowBody3:
    'La vista de lectura solo cambia cómo se muestra el documento. Sus páginas y el archivo guardado siguen igual.',

  homeHelpAiTitle: 'Activar y desactivar la IA',
  homeHelpAiBody1:
    'La IA viene desactivada. Mientras esté desactivada, no aparece ningún botón de IA.',
  homeHelpAiBody2:
    'Para usarla, activa la IA en Ajustes y luego añade una clave API o elige una conexión gratuita en «Conexiones IA». No necesitas una cuenta para esta app.',
  homeHelpAiBody3:
    'El contenido solo se envía al servicio de IA que elegiste cuando le pides algo a la IA. Si vuelves a desactivarla, desaparecen todos los botones de IA.',

  homeHelpFeedbackTitle: 'Enviar comentarios',
  homeHelpFeedbackBody:
    'La encuesta se abre en el navegador. Los datos de abajo se copian al portapapeles para que los pegues en la encuesta. La aplicación no envía nada por sí misma y el contenido de los documentos nunca se incluye.',
  homeHelpFeedbackDetails: 'Versión {version}\nSistema {os}\nIdioma {language}',
  homeHelpFeedbackOpen: 'Abrir la encuesta',
  homeHelpFeedbackCancel: 'Cancelar',
  homeHelpFeedbackCopyFailed:
    'No se pudo copiar al portapapeles. Mantén pulsado el texto de abajo para copiarlo y pégalo en la encuesta.',
  homeHelpFeedbackOpenFailed: 'No se pudo abrir el navegador.',

  homeHelpWhatsNewVersion: 'Versión {version}',
  homeHelpWhatsNewEmpty: 'No hay notas para esta versión.',
  homeHelpNew010First: 'La primera versión de la app móvil de GenOffice.',
  homeHelpNew010Edit: 'Abre y edita documentos HWP, PDF, Markdown, HTML y hojas de cálculo.',
  homeHelpNew010Read: 'Lee libros EPUB y presentaciones PPT.',
  homeHelpNew010PdfTools:
    'Herramientas PDF: organizar páginas, convertir, reducir el tamaño y proteger, quitar anotaciones.',
  homeHelpNew010Ai:
    'Un asistente de IA, desactivado al principio, que funciona con una clave API o una conexión gratuita.',
  homeHelpNew010Mobile:
    'Compartir y recibir archivos, vista de lectura para HWP, guía de bienvenida, gestión del almacenamiento y pantalla encendida mientras lees.',
} as const satisfies Record<keyof typeof zh, string>
