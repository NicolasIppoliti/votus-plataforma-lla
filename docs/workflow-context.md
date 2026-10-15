# Contexto electoral entre módulos (#442)

Los enlaces de **Continuar el análisis** conservan la elección, categoría,
territorio y fuente del contexto compartido. La navegación principal permite
seguir el recorrido **Panorama → Exploración → Comparación** sin volver a
seleccionar esos valores, tanto en escritorio como en el menú móvil.

## Recorrido

1. Abrir Panorama con una selección en la URL (por ejemplo, desde la barra de
   contexto electoral).
2. Pulsar **Explorar resultados**. El enlace incluye el contexto y el nivel
   correspondiente al territorio seleccionado.
3. Abrir **Comparación** desde la navegación principal. La selección viaja como
   lado A; los parámetros del lado B se conservan si estaban presentes. Sin lado
   B, Comparación mantiene su petición de selección: no se inventa otra elección.

Cada destino sigue comprobando la disponibilidad y el acceso autorizado. Un
contexto en la URL no concede acceso ni garantiza que haya resultados.

## Contrato y límites

- `src/lib/context/workflow.ts` usa exclusivamente el parser/serializador de
  `src/lib/context/url.ts`; no introduce otra normalización de códigos.
- Los enlaces de Panorama a Exploración, Comparación, Simulación y Evidencia
  transportan el contexto explícito de la URL. Sin contexto explícito, usan la
  selección oficial autorizada que ya resolvió Panorama; si no existe, conservan
  las rutas sin selección.
- La navegación principal conserva el contexto entre Panorama, Exploración,
  Comparación y Simulación. Los enlaces de entrada a los flujos separados
  Municipal y Fiscalización, los catálogos Evidencia/Escenarios y Revisión no
  cambian. Esta es la lectura conservadora de «Non-goals: unrelated routes» y
  de la separación ya visible en el briefing.
- Solo viajan las claves del contrato compartido, incluidos `bElectionId` y
  `bCategoryId`. Los filtros locales no viajan. Para Exploración se deriva
  `level` de la línea territorial (sección, circuito, establecimiento o mesa),
  porque su página todavía lo exige; no se reutiliza un nivel de otro módulo.
- `sourceKind` nunca se cambia de fiscalización a oficial. Exploración rechaza
  fuentes no oficiales antes de consultar datos, igual que Comparación. Los
  contextos inválidos o repetidos se transportan sin corregirlos para que el
  destino los rechace, en lugar de reemplazarlos por otra selección.
- Este cambio transporta enlaces; no cambia las cifras ni los pseudoselectores
  actuales de Panorama (#436), ni rediseña los editores de Comparación (#438).
  La barra de contexto y las cifras predeterminadas de Panorama aún pueden
  diferir hasta #436; el texto de los enlaces indica que llevan el contexto URL.

## Verificación

Los tests de Vitest renderizan la página raíz real y la navegación principal:
selección explícita, selección predeterminada autorizada, datos no disponibles,
fuentes separadas, códigos normalizados, filtros finos y contexto inválido.

`apps/web/e2e/comparison.spec.ts` añade el recorrido completo con resultados
oficiales autorizados a 1440 y 390 px, comprobando la URL y los resultados
renderizados en ambos destinos. Los specs de Playwright se escribieron pero no
se ejecutaron en esta tarea, por instrucción expresa.
