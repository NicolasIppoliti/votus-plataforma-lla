# Reconstruir pares desktop sin perder las secciones inferiores (#500)

**Herramientas listas para revisión; evidencia visual y aprobación pendientes.** Los originales de `~/dev/votus-backups/visual-review-2026-10-13/r4-same-scale/` y `odd/tasks/prototype-integration.md` no están disponibles en este entorno. No se atribuyen coincidencias ni desviaciones a imágenes que no se han visto. #499 cubre densidad móvil; #501 cubre polish: este cambio no altera el producto ni aprueba esas tareas.

## Camino corto: originales existentes

1. Recuperar las cinco capturas completas `raw/r4-*-1440-full.png` y los especímenes aprobados. No sustituirlas por capturas de viewport de 900 px.
2. Copiar la estructura de [manifest.example.json](manifest.example.json) a un manifiesto de trabajo. Rutas relativas al manifiesto, no al directorio de ejecución. Conservar los nombres de página y ajustar las rutas de prototipo. Marcar `fullPage: true` sólo tras verificar su procedencia; el alto de un PNG por sí solo no prueba captura completa.
3. Ejecutar desde la raíz, con un directorio de salida **nuevo**, dentro de la superficie autorizada:

   ```sh
   node docs/visual-review/pair-desktop.mjs docs/visual-review/manifest.json docs/visual-review/pares-r4
   ```

4. Abrir `INDEX.html`, seguir cada enlace y visualizar cada SVG a **100 %**, sin «ajustar al ancho». Cada SVG es autocontenido (PNG incrustados); no necesita servidor, conversión ni dependencias adicionales. El tamaño total puede ser grande porque conserva los originales sin pérdidas.
5. Completar `NOTES.md` y solicitar revisión independiente de los mismos archivos y su manifiesto. Las filas generadas son tareas pendientes, **no** notas de coincidencia.

## Capturas nuevas, sólo cuando hagan falta

No son los originales round-4: registrar commit, versión del navegador, fecha, estado y selección en las notas; nunca presentar una recaptura actual como evidencia histórica. El nombre `r4-*` es el contrato del emparejador, no una afirmación sobre la antigüedad de la captura.

El CLI opt-in `capture-desktop.mjs` usa el Playwright ya instalado en `apps/web`, una aplicación local y un navegador local autenticado con depuración CDP habilitada. No lee archivos de sesión, credenciales ni `.env`. No ejecutarlo contra producción ni guardar datos personales. El puerto de depuración debe permanecer sólo en loopback y cerrarse al terminar.

```sh
PWDEBUG=1 node docs/visual-review/capture-desktop.mjs http://localhost:3000 http://localhost:9222 docs/visual-review/raw-nuevo
```

El operador prepara esa sesión local previamente. Se abre una pestaña por ruta real: `/`, `/drilldown`, `/compare`, `/evidencia`, `/simulate`. Antes de cada screenshot, el inspector pausa la ejecución: seleccionar datos oficiales equivalentes al espécimen, abrir las secciones que corresponda, recorrer la página completa para cargar mapas y contenido diferido, volver arriba, esperar fuentes/mapas/datos y reanudar. No aceptar un formulario inicial, error, estado vacío o mapa sin cargar como sustituto de resultados. No navegar fuera de la ruta. La selección y los disclosures se registran manualmente en las notas. Nunca activar fiscalización para compararla con cifras oficiales.

Se captura con viewport 1440 × 900, `fullPage: true`, escala CSS y animaciones desactivadas. El manifiesto generado tiene rutas de prototipo pendientes: reemplazarlas por los originales aprobados antes de emparejar. La herramienta no realiza login ni altera fixtures. No fue ejecutada en este trabajo: Playwright está expresamente fuera de la validación autorizada.

## Qué garantiza el emparejador

| Propiedad | Contrato |
|---|---|
| Fuente de producción | PNG completo con nombre `r4-<página>-1440-full.png`, ancho 1440 y declaración explícita `fullPage` |
| Prototipo | Ancho nativo 1276, 1424 o 1600; también captura completa |
| Segmentación | Mismo origen Y y paneles de 900 px de alto (configurable por `segmentHeight`), hasta el máximo alto de ambos originales; último segmento rellenado, nunca reescalado |
| Escala | Coordenadas y dimensiones nativas del PNG; sin transformaciones ni compresión adicional |
| Diferente ancho | Advertencia en **cada par**: comparación de píxeles, no viewports idénticos |
| Fin de página | Fondo gris y etiqueta «Fin de captura»; nunca se confunde con producción ausente |
| Trazabilidad | `manifest.json` de salida: rango Y, dimensiones, SHA-256 de ambos originales |
| Preservación | Rechaza directorio existente; nunca reemplaza notas ni evidencia anteriores |

`--stdin` recibe una sola pareja con PNG base64 y devuelve el array de segmentos JSON sin escribir archivos; permite probar el CLI real de manera determinista. La validación de PNG verifica firma/IHDR y dimensiones, no decodifica toda la imagen: confirmar también que el navegador muestra los originales completos y sin corrupción. Una declaración `fullPage` falsa no es detectable automáticamente.

## Inventario y revisión humana (pendiente)

Para **cada** sección inferior de Panorama, Exploración, Comparación, Evidencia y Simulación, recorrer ambos originales hasta su fin y crear una fila por elemento: título, texto, control, leyenda, mapa, tabla, estado y rail de procedencia presente. Incluir elementos presentes sólo en uno de los lados y elementos que cruzan segmentos. No inferir equivalencia de datos distintos ni confundir un reflow por ancho con contenido faltante.

| Par / rango Y | Elemento y localización | Coincidencia o desviación | Evidencia / acción |
|---|---|---|---|
| Pendiente de originales | Pendiente de inventario visual completo | Pendiente | No hay dictamen |

El verificador independiente debe recibir originales, SVG, manifiesto y notas; comprobar 1:1, continuación de producción por debajo de y=900, inventario completo de secciones inferiores y distinción de anchos. Registrar una referencia de revisión sin datos personales, hallazgos bloqueantes, resolución y dictamen. No marcar aceptación hasta que no queden bloqueantes.

## Estado de aceptación

- [ ] «No segment shows production as absent when the content exists.» La lógica está cubierta por pruebas del CLI; falta comprobar los originales reales y pares reconstruidos.
- [ ] «Every lower-section element has a match or deviation note.» Pendiente de recuperar originales e inventariar visualmente cada elemento; plantilla disponible.
- [ ] «An independent verifier finds no blocking issue.» Pendiente, no sustituido por tests automatizados.
