# #463 — Formularios a 320px y 390px

## Estado de entrega

**La aceptación visual sigue pendiente.** El único AC de #463 es:

> Screenshot evidence for each route at 320px.

No hay capturas aprobadas disponibles. No se ejecutó Playwright localmente ni se
habilitaron capturas o trazas autenticadas. La ejecución CI de PR #553 falló en
los dos casos nuevos de simulación; aún no hay validación de navegador satisfactoria. Las pruebas CSS y de renderizado no sustituyen
ese AC. Mantener #463 abierto y referenciarlo con `Refs`, no `Closes`.

El epic #474 exige auditar ambos anchos. #462 ya resolvió el apilado de los seis
selectores de Comparación; este trabajo conserva esa entrega y amplía la revisión
al resto de los formularios y controles de selección, incluso fuera de `<form>`.

## Hallazgos y correcciones de código

- Exploración mantenía dos columnas por debajo de 768px. Ahora sus filtros usan
  una columna hasta 480px, incluidos los selectores del desplegable territorial.
- Evidencia mantenía dos columnas por debajo de 650px y sólo extendía el primer
  campo. Ahora todos los campos del contexto tienen su propia fila hasta 480px.
- Un selector nativo no envuelve la opción seleccionada. Incluso una fila completa
  puede recortar nombres de categorías, agrupaciones o listas. `ResponsiveSelect`
  conserva el `<select>` nativo y muestra una segunda línea visual con el valor
  completo, que envuelve en teléfonos. La línea usa `aria-hidden`: el lector de
  pantalla ya recibe el valor íntegro a través del control nativo. No cambia nombres
  accesibles, claves GET, autorización, consultas ni separación de fuentes.
- Los campos nativos pueden encogerse dentro de su contenedor; `.field` elimina
  su mínimo intrínseco. Los controles y acciones dentro de formularios conservan
  mínimos de 44px en teléfonos, y etiquetas/botones permiten envolver el texto.
  No se oculta el desbordamiento para disimular problemas.

## Inventario de alcance

La matriz es una **auditoría de código**, no una afirmación de validación visual.
Los dos anchos se parametrizan en `e2e/root.spec.ts` y `e2e/simulate.spec.ts`.

| Ruta/superficie | Formularios y controles inventariados | Cobertura preparada |
| --- | --- | --- |
| `/login` | Correo, contraseña, inicio de sesión | Contexto anónimo, etiquetas y geometría |
| `/` | Territorio del panorama, búsqueda de territorios | Ruta real y contexto electoral |
| `/drilldown` | Elección, categoría, territorio desplegable, agrupación fija, búsquedas territoriales | Abrir desplegables con campos y comprobar controles visibles |
| `/compare` | Seis selectores, agrupación del detalle, búsqueda y orden del siguiente nivel | Conservar #462; valores completos, etiquetas y geometría |
| `/municipal` | Contexto electoral; no hay formulario local para el alcance fijo | Ruta real y contexto electoral |
| `/fiscalizacion` | Cuatro selectores automáticos de alcance | Ruta real; sin mezclar con resultados oficiales |
| `/evidencia` | Contexto GET de cuatro campos, búsqueda de unidad, estado del escrutinio cuando hay pertenencia conocida | Ruta real; desplegables y campos presentes |
| `/review` | Sin formulario local de selección | Ruta real y controles compartidos |
| `/scenarios` | Sin formulario local; enlace al editor | Ruta real y acceso al editor en prueba de simulación |
| `/simulate` | Editor, transferencia y muestreo | Escenario de fixture existente, abrir editor y sensibilidad; exigir los tres formularios |
| Drawer compartido | Organización, cambio de organización, cuenta/cierre de sesión | Abrir en cada ruta; mostrar cuenta; comprobar campos y acciones |
| Barra compartida | Elección, categoría, distrito, sección y fuente | Controles presentes en las rutas de datos; valor completo incluso para fuente no oficial |

`/dashboard` redirige a `/`; no agrega un formulario independiente.
Los formularios condicionados por datos sólo pueden comprobarse cuando el fixture
servido los hace alcanzables. La matriz general no prueba que todos esos estados
hayan aparecido; la ejecución de fixtures específicos y la inspección visual siguen
siendo necesarias antes de declarar una auditoría completa.

## Verificación y límites

- `src/app/mobile-forms.test.ts`: contratos CSS de apilado, límites y tamaño mínimo.
- `src/components/ResponsiveSelect.test.tsx`: valores controlados, predeterminados,
  implícitos y numéricos; opciones vacías y agrupaciones; descripción y estado nativos.
- `src/app/(authenticated)/compare/page.test.tsx`: el renderizado de la página real
  alcanza los seis valores visuales completos, además de sus controles existentes.
- `e2e/mobile-form-geometry.ts`: sin capturas ni valores de campos en diagnósticos;
  comprueba desbordamiento de página, campos dentro del ancho, etiquetas visibles,
  objetivos de 44px y coincidencia entre opción seleccionada y texto que envuelve.
- Playwright no se ejecutó localmente. El run CI `38751980553` de PR #553 registró
  dos casos `failed` en `simulate.spec.ts:8`, no `timedOut`; cada uno tenía una
  ubicación de error externa al spec (`foreignErrorLocations: 1`). Ese diagnóstico
  no identifica la aserción ni demuestra que el problema sea `ResponsiveSelect`
  o el apilado. No se afirma una corrección de layout ni GREEN de navegador.
- Ante un fallo del helper, se adjuntan únicamente hechos acotados: fase, índice
  del control, medidas numéricas y booleanos de las mismas aserciones. El reporter
  valida una estructura estricta y los incluye en `companion.attempts[].mobileForm`
  dentro de `E2E_PLAYWRIGHT_DIAGNOSTIC`. No requiere descargar artifacts ni habilitar
  capturas: no salen texto, valores, IDs, selectores, URLs, rutas ni credenciales.
  Si falla la captura diagnóstica se conserva el error original. Las aserciones
  de tamaño, etiquetas y overflow siguen siendo bloqueantes, sin relajar umbrales.
  El paso de geometría de simulación usa `box: true` para conservar una ubicación
  útil dentro del spec cuando falla un helper.
- No se redujeron fuentes, etiquetas, nombres accesibles ni capacidades móviles para
  hacer caber los controles. No se cambió normalización ni aislamiento de fuentes.

Antes de cerrar el issue: ejecutar las pruebas de navegador autorizadas, revisar
estados dependientes de datos y obtener evidencia visual aprobada por ruta a 320px.
