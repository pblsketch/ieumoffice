# Hangul (HWP / HWPX): edición, panel de trabajo e impresión

GenOffice abre y edita documentos Hangul `.hwp` y `.hwpx` en una pestaña, con atajos de teclado, estilos, tablas, notas, impresión y un panel de IA. Todo se ejecuta de forma local en su PC.

## Apertura, guardado e impresión

- Abre archivos `.hwp` y `.hwpx` desde Inicio, **Archivo > Abrir**, arrastrándolos a la ventana o desde Google Drive; convierte archivos PDF en nuevas pestañas de Hangul mediante **Archivo > Importar PDF**.
- Guarda en el formato original del archivo abierto (`.hwp` sigue siendo `.hwp`, `.hwpx` sigue siendo `.hwpx`), conserva una copia de seguridad `.bak` antes de la primera sobrescritura, comprueba la lectura posterior de HWP y mantiene copias de autoguardado y recuperación ante fallos.
- Imprimir (Ctrl+P) incluye vista previa en vivo, exportación a PDF y opciones de diseño de impresión de varias páginas.

## Panel de trabajo izquierdo: Esquema, Buscar y Referencias

- Abra el panel de trabajo izquierdo desde el botón de la barra superior, **Ver > Panel de trabajo** (Esquema / Buscar / Referencias) o pulse **Ctrl+F** para ir directamente a la pestaña Buscar. La búsqueda tradicional (**Ctrl+Q,F**) y Buscar y reemplazar (**Ctrl+H**) siguen disponibles.
- **Pestaña Esquema**: enumera los encabezados de esquema nativos de Hangul y los encabezados asignados por estilo (por defecto `제목 N` / `Heading N`, personalizable por documento o para toda la aplicación en el panel de ajustes de Esquema). Filtre por nivel (`1`, `2`, `3`, ... Todos), contraiga ramas, haga clic para saltar, suba o baje niveles de encabezados (junto con sus subencabezados de forma predeterminada, o mantenga **Mayús** para un solo encabezado) y arrastre encabezados para reordenar secciones completas en un solo paso de deshacer.
- **Pestaña Buscar**: busca en el cuerpo del texto, tablas (incluidas tablas anidadas), cuadros de texto, notas al pie y notas al final (excluyendo encabezados y pies de página) con filtros de mayúsculas/minúsculas, palabra completa, expresiones regulares, estilo de párrafo y formato de caracteres. Haga clic en un resultado para saltar y seleccionarlo, o reemplace una, las seleccionadas o todas las coincidencias en un solo paso de deshacer (omitiendo objetos insertados y marcas de cita con un contador).
- El panel de trabajo recuerda su estado abierto, la pestaña activa y el ancho, se pliega en una barra de iconos en ventanas estrechas y se oculta en el modo presentación y en la vista previa de impresión. Todas las funciones del panel funcionan sin IA.

## Notas, atajos y panel de IA

- Abra la columna de notas desde la barra superior o **Insertar > Nota** para leer, añadir, editar y eliminar notas de texto sin formato junto al documento.
- Admite atajos de edición de documentos Hangul, marcadores de párrafo en la regla horizontal, Copiar formato (**Alt+C**), conversión de Hanja (**F9** / tecla Hanja) e Información del documento (**Ctrl+Q,I**).
- El panel de IA opcional y los [comandos de terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) pueden leer y editar texto, estilos, tablas, ecuaciones, diseño de página, esquemas y resultados de búsqueda; cada edición de IA es un solo paso de deshacer.

## Tabla de contenido: crear y actualizar

- Usa **Herramientas > Crear tabla de contenido** (o **Herramientas > Actualizar tabla de contenido**, o haz clic derecho dentro de una tabla de contenido) para insertar una **tabla de contenido** a partir de los títulos del Esquema, además de **listas de tablas**, **figuras** y **ecuaciones** tomadas de los títulos de objetos y párrafos de leyenda.
- Elige el diseño **Tabulación con puntos** (predeterminado) o **Tabla sin bordes** (de 2 columnas), define la profundidad de títulos (niveles 1–10, predeterminado 3), personaliza el título y decide si incluir enlaces clicables (haz clic o **Ctrl+clic** en una línea para saltar al título).
- Los números de página reflejan la numeración impresa del documento, incluidos los reinicios de numeración y los formatos romanos o personalizados.
- Al actualizar se renuevan las entradas y los números de página en su lugar, se muestra un aviso antes de sobrescribir líneas editadas a mano y se detectan tablas de contenido existentes sin marcar creadas en otro programa para pedir confirmación antes de sustituirlas.

## Índice: marcar entradas y crear

- Usa **Herramientas > Marcar entrada de índice** (o clic derecho en el texto principal) para marcar la palabra seleccionada o la situada bajo el cursor, añadir una subentrada opcional o activar **Marcar todas las coincidencias** (solo en el cuerpo del texto; informa cuántas apariciones en tablas, cuadros de texto y notas se omitieron). En el mismo cuadro de diálogo puedes ver y eliminar las marcas existentes.
- Usa **Herramientas > Crear índice** para insertar el índice en la posición del cursor y **Herramientas > Actualizar índice** para ponerlo al día después de editar. El título predeterminado («Índice») puede personalizarse.
- Las entradas se ordenan en orden coreano (가나다) → inglés (ABC) → otros, con encabezados de grupo por consonante o letra opcionales, de 1–3 columnas (2 por defecto, aplicadas solo al índice sin alterar las columnas del resto del documento) y diseño de **Tabulación con puntos** o **Tabla sin bordes**.

## Aviso de desactualización y copia de entrega

- Al guardar manualmente, imprimir, exportar a PDF o guardar como copia de entrega, el editor comprueba si alguna tabla de contenido o el índice están desactualizados y ofrece actualizar todo en un solo paso de deshacer. Esta comprobación nunca se ejecuta durante el guardado automático ni bloquea el guardado.
- Usa **Archivo > Guardar como copia de entrega** para guardar una copia limpia aparte sin marcas internas de edición (marcas de índice, marcas de bloque de índice y ajustes guardados), manteniendo intactas las tablas de contenido, los anclajes de títulos y los enlaces. El archivo de trabajo original permanece intacto para que puedas seguir actualizándolo más adelante.

## Referencias y citas

- Abre la pestaña **Referencias** en el panel de trabajo izquierdo (o **Herramientas > Referencias**) para administrar una única biblioteca local en tu PC con búsqueda, etiquetas, añadir/editar/eliminar, importación y exportación (`BibTeX`, `RIS`, `CSL JSON`) e importación de líneas desde una lista de referencias existente del documento con vista previa antes de confirmar.
- Admite cuatro estilos de cita (**APA 7**, **Chicago**, **MLA 9** e **IEEE**; las referencias en coreano siguen el formato académico coreano en los cuatro estilos). Inserta citas parentéticas, narrativas o múltiples con indicación de páginas y genera o actualiza una bibliografía con sangría francesa; al cambiar de estilo, las citas marcadas y la bibliografía se actualizan en un solo paso de deshacer sin sobrescribir las citas editadas a mano.
- La auditoría integrada de 6 puntos (falta en la bibliografía, entradas sin citar, orden de clasificación, sufijos a/b faltantes, citas editadas manualmente y elementos sin verificar) permite saltar al instante a cada problema, y antes de guardar manualmente, imprimir o exportar avisa si la bibliografía o la numeración IEEE están desactualizadas.
- La búsqueda opcional de referencias con IA (cuando las herramientas de Internet están activas) incorpora siempre los candidatos como **Sin verificar** con la URL de origen en las notas; no pueden citarse ni incluirse en la bibliografía hasta que los revises y los marques tú mismo como **Verificados**.

## Macros: grabación de teclas y scripts

- Usa **Herramientas > Macros** (o **Alt+Shift+H** para iniciar o detener la grabación de teclas y **Alt+Shift+X** para detenerla) para grabar texto escrito, movimientos del cursor, formato, estilos, tablas y ediciones compatibles directamente en un script editable. Mientras grabas aparece un indicador en la barra superior, y las acciones no compatibles o los clics del ratón se avisan al instante y se enumeran como omitidos al terminar.
- Abre el **Administrador de macros** para gestionar tus macros guardadas localmente, asignar hasta 11 ranuras de atajo (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), editar scripts con avisos de línea y columna ante errores de sintaxis, y exportar o importar archivos de texto plano `.ieummacro`. Los scripts importados se muestran completos y deben confirmarse y guardarse antes de poder ejecutarse; las macros incrustadas en documentos nunca se leen ni se ejecutan. En macOS, inicia y gestiona las macros desde el menú **Herramientas > Macros**, ya que las combinaciones con la tecla Opción escriben caracteres.
- Cada macro se ejecuta de forma síncrona dentro de un intérprete restringido compatible con la API de documentos de la aplicación y con objetos de script de macros compatibles (`HAction`, `HParameterSet`), con límites de tiempo, pasos, profundidad de llamada y memoria, además de protección de objetos y notas. Cada ejecución cuenta siempre como un único paso de deshacer y revierte todo si ocurre algún error, acción no admitida o exceso de límite.
- La opción **Escribir con IA** (visible en el editor de macros solo si la IA está activada) te permite describir una tarea repetitiva para redactar un borrador de script; únicamente se envían tu descripción y la referencia de la API de macros, nunca el documento. Los borradores aparecen solo en el cuadro de edición y nunca se guardan ni se ejecutan automáticamente.
