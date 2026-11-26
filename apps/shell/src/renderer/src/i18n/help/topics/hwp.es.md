# Hangul (HWP / HWPX): edición, panel de trabajo e impresión

GenOffice abre y edita documentos Hangul `.hwp` y `.hwpx` en una pestaña, manteniendo los atajos de Hancom Hangul 2024, los estilos, las tablas, las notas, la impresión y un panel de IA. Todo se ejecuta de forma local en su PC.

## Apertura, guardado e impresión

- Abre archivos `.hwp` y `.hwpx` desde Inicio, **Archivo > Abrir**, arrastrándolos a la ventana o desde Google Drive; convierte archivos PDF en nuevas pestañas de Hangul mediante **Archivo > Importar PDF**.
- Guarda en el formato original del archivo abierto (`.hwp` sigue siendo `.hwp`, `.hwpx` sigue siendo `.hwpx`), conserva una copia de seguridad `.bak` antes de la primera sobrescritura, comprueba la lectura posterior de HWP y mantiene copias de autoguardado y recuperación ante fallos.
- Imprimir (Ctrl+P) incluye vista previa en vivo, exportación a PDF y opciones de diseño de impresión de varias páginas.

## Panel de trabajo izquierdo: Esquema y Buscar

- Abra el panel de trabajo izquierdo desde el botón de la barra superior, **Ver > Panel de trabajo** (Esquema / Buscar) o pulse **Ctrl+F** para ir directamente a la pestaña Buscar. La búsqueda tradicional (**Ctrl+Q,F**) y Buscar y reemplazar (**Ctrl+H**) siguen disponibles.
- **Pestaña Esquema**: enumera los encabezados de esquema nativos de Hangul y los encabezados asignados por estilo (por defecto `제목 N` / `Heading N`, personalizable por documento o para toda la aplicación en el panel de ajustes de Esquema). Filtre por nivel (`1`, `2`, `3`, ... Todos), contraiga ramas, haga clic para saltar, suba o baje niveles de encabezados (junto con sus subencabezados de forma predeterminada, o mantenga **Mayús** para un solo encabezado) y arrastre encabezados para reordenar secciones completas en un solo paso de deshacer.
- **Pestaña Buscar**: busca en el cuerpo del texto, tablas (incluidas tablas anidadas), cuadros de texto, notas al pie y notas al final (excluyendo encabezados y pies de página) con filtros de mayúsculas/minúsculas, palabra completa, expresiones regulares, estilo de párrafo y formato de caracteres. Haga clic en un resultado para saltar y seleccionarlo, o reemplace una, las seleccionadas o todas las coincidencias en un solo paso de deshacer (omitiendo objetos insertados y marcas de cita con un contador).
- El panel de trabajo recuerda su estado abierto, la pestaña activa y el ancho, se pliega en una barra de iconos en ventanas estrechas y se oculta en el modo presentación y en la vista previa de impresión. Todas las funciones del panel funcionan sin IA.

## Notas, atajos y panel de IA

- Abra la columna de notas desde la barra superior o **Insertar > Nota** para leer, añadir, editar y eliminar notas de texto sin formato junto al documento.
- Utiliza los atajos de teclado de Hancom Hangul 2024, los marcadores de párrafo de la regla horizontal, Copiar formato (**Alt+C**), conversión de Hanja (**F9** / tecla Hanja) e Información del documento (**Ctrl+Q,I**).
- El panel de IA opcional y los [comandos de terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) pueden leer y editar texto, estilos, tablas, ecuaciones, diseño de página, esquemas y resultados de búsqueda; cada edición de IA es un solo paso de deshacer.
