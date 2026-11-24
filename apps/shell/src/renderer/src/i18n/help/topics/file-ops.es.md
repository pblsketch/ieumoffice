# Operaciones de archivo: cambiar nombre, eliminar, exportar

Este capítulo cubre las operaciones de archivo comunes a todos los editores; las opciones de exportación propias de cada editor están en su capítulo.

El **menú ⋯** de la fila (pase el cursor por una fila de archivo) reúne estas acciones:

![El menú ⋯ de una fila de archivo](img/file-ops.png)

## Cambiar nombre

Dos puntos de entrada, un mismo conjunto de comprobaciones:

- **⋯ ▸ Cambiar nombre** en una fila de la pantalla de inicio.
- **Haga doble clic en una pestaña de archivo** para cambiar el nombre en el sitio (véase [Pestañas y gestión de ventanas](help://tabs-and-windows)).

Reglas: la extensión se conserva automáticamente; los caracteres no permitidos, los puntos finales y los nombres reservados (CON/NUL y similares) se rechazan con un mensaje; también se bloquea un conflicto de nombres en la misma carpeta. El archivo real del disco se renombra, y la lista de recientes y los destacados se actualizan.

## Eliminar

- **⋯ ▸ Eliminar** en Inicio: pregunta qué archivos y luego los mueve a la **papelera del sistema**, desde donde el sistema operativo puede restaurarlos. GenOffice no guarda ningún deshacer propio para esto — la recuperación es cosa de la papelera, no de una notificación.

## Duplicar

**⋯ ▸ Duplicar** crea una copia llamada <name> copy en la misma carpeta; si el nombre ya existe, se añade un contador automáticamente. La copia se añade a **Recientes** en lugar de abrirse: queda a un clic, no delante de ti.

## Guardar y Guardar como

- **⌘S / ctrl+S** guarda el archivo actual; si no tiene título, primero pregunta por la ubicación y el nombre.
- En la mayoría de los editores, la lista de tipos de archivo del cuadro Guardar como también ofrece los formatos de exportación (PDF, imágenes, otros formatos de documento). Al elegir uno de ellos solo se escribe una copia; el documento abierto y su pestaña siguen con el archivo original. Las imágenes de varias páginas se reparten en `nombre-01.png`, `nombre-02.png`, ….
- **Docs**: la lista Guardar como también ofrece .hwp y .hwpx (Archivo ▸ Exportar como documento HWP… hace lo mismo). Si algo no se puede trasladar, como comentarios, ecuaciones o cuadros de texto, se le avisa antes de escribir el archivo.
- **Guardar como** escribe un archivo nuevo y deja el original intacto; las ediciones posteriores se dirigen al archivo nuevo.
- Cada guardado es atómico (archivo temporal y renombrado): salir a mitad de la escritura no puede corromper el archivo.
- El autoguardado sigue el interruptor de cada editor; un documento nuevo sin archivo propio empieza tras su primer guardado (véase [Inicio rápido](help://getting-started)).

## Exportar a PDF

- **Docs**: Archivo ▸ Exportar como PDF (o el botón de la cinta de opciones), paginado según el diseño actual.
- **Slides**: la exportación rasteriza página a página, con progreso para presentaciones grandes.
- **Sheets**: la exportación sigue la paginación de impresión.
- Las exportaciones se renderizan en una ventana oculta y terminan donde usted elija.

## Exportar a Word / imágenes

- **PDF ▸ PDF a Word**: convierte el PDF en .docx (conversión local; los diseños complejos se conservan en la medida de lo posible).
- **Docs** puede exportar las páginas como imágenes (un PNG por página).

## Imprimir

Archivo ▸ Imprimir (⌘P/ctrl+P) abre una ventana de impresión con vista previa en vivo en todos los editores: Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram y Whiteboard. Si no cambias Diseño de página y usas el diálogo del sistema, imprime igual que antes.

- **Destino (impresora, PDF, imágenes)**: elige en una sola lista una impresora instalada, **Guardar como PDF**, **Guardar como imágenes** o el **Diálogo de impresión del sistema**. El guardado como imágenes admite PNG y JPG (Alta 90 %, Media 80 %, Archivo pequeño 65 %) en archivos numerados o en un ZIP único. En PDF con restricciones se desactivan PDF e imágenes, pero la impresión sigue activa.
- **Vista previa en vivo**: los diez editores muestran una vista previa antes de imprimir o guardar. Cuando el diseño, la escala de grises, la marca de agua o los encabezados/pies cambian las caras finales, se renderizan bajo demanda con navegación, zoom y cambio al diagrama.
- **Diseño**: elige Una página por hoja, Varias páginas por hoja (2, 4, 6, 9 o 16, con bordes opcionales), Folleto (encuadernación izquierda o derecha), Póster (columnas × filas, solapamiento, marcas de corte y etiquetas de mosaico) o Etiquetas (una página por etiqueta o repetida, celda inicial, plantillas A4 o medidas propias).
- **Escala, orientación, caras y orden**: selecciona Tamaño real (100 %), Ajustar al papel, Reducir páginas grandes o Escala personalizada (10 %–400 %) y orientación Automática, Vertical u Horizontal. Solo impares, solo pares y orden inverso se calculan sobre las caras finales.
- **Marca de agua, encabezados/pies, escala de grises y resolución**: añade marcas de agua de texto o imagen y 6 espacios de encabezado y pie (título, fecha, número de página o texto propio) solo para la salida, sin alterar el documento. Ajusta también escala de grises y DPI (Automático, 150, 300 o 600 dpi).
- **Rangos de páginas y selección**: Docs y Markdown remaquetan el texto seleccionado desde la página 1; Slides imprime diapositivas elegidas; PDF páginas elegidas; Hangul admite Todo, Página actual o Rango personalizado; Sheets imprime hojas activas, libro o selección.
- **Diálogo del sistema**: en folletos, activa doble cara volteando por el borde corto y deja intactos el rango y las páginas por hoja del diálogo del sistema.

Los PDF se imprimen respetando el orden y la rotación actuales.

## Dónde viven los archivos sin título

La ubicación que elija en el primer guardado es su hogar. Hasta entonces el documento no tiene archivo propio: su contenido sin guardar solo se conserva como copia de recuperación en la carpeta de datos de la aplicación, de modo que puede volver si la aplicación se apaga de repente (vea [Pestañas y gestión de ventanas](help://tabs-and-windows)). El autoguardado toma el relevo solo después de ese primer guardado.
