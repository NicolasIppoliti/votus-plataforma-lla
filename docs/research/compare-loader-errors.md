# /compare: fallos de carga y reintento (#430)

La comparación distingue una denegación de acceso de una indisponibilidad de las opciones. **No se ha identificado la causa del incidente de producción**: este cambio no accedió a producción. El responsable debe adjuntar al issue evidencia de servidor o tiempos RPC antes de cerrar ese criterio de aceptación.

## Ayuda para quien usa la página

- Si aparece «No tiene autorización», verifique su sesión y espacio de trabajo.
- Si las opciones están «temporalmente no disponibles», el servicio puede no estar disponible o la solicitud puede haber superado el tiempo de espera; no significa que se haya denegado el acceso.
- «Reintentar» vuelve a solicitar la misma URL, conservando la selección. Es un enlace nativo que funciona sin JavaScript. No cambia permisos ni presenta cifras parciales.

Esto se aplica a la carga inicial y a las cargas posteriores de categorías, distritos y secciones.

## Clasificación en el servidor

| Evidencia recibida | Categoría del contexto | Presentación |
| --- | --- | --- |
| RPC `42501`, `28000`, `28P01`, `PGRST301`, `PGRST302`, `PGRST303` | `denied` | Alert `denied` |
| Claims ausentes, inválidos o rechazados por autenticación | `denied` | Alert `denied` |
| RPC `57014` (cancelación, incluido statement timeout) | `unavailable` | Alert `unavailable` |
| Conexión (`08006`), servicio PostgREST (`PGRST000`), otros errores RPC | `unavailable` | Alert `unavailable` |
| Excepción de transporte | `unavailable` | Alert `unavailable` |
| RPC `VOT03` | `mismatch` (contrato existente preservado) | Fallo de carga no clasificado como denegación |
| Facetas con autorización denegada, contexto terminado o selección de espacio requerida | Error de facetas existente | Alert `denied` |
| Payload inválido, excesivo u otro error de facetas | Error de facetas existente | Alert `unavailable` |

Un error desconocido nunca demuestra una denegación. Los mensajes RPC, detalles de transporte y parámetros no se muestran al usuario. La categoría `unavailable` no prueba por sí sola que hubo timeout.

## Evidencia disponible y pendiente

`AuthorizedOfficialFacetRepository.facets` registra `[workspace:official_facets]` con un código saneado (`authorization_denied` o `unavailable` para fallos del contexto); la validación de payload también puede registrar razones acotadas de malformación. No registra duración RPC ni detalles de error originales. No se encontró `VOTUS_PROFILE_SPANS` en `apps/web`; este cambio no agrega instrumentación ni atribuye el incidente a un cold start.

El issue reporta una carga fallida de escritorio de 10,7 s y una carga móvil exitosa de 3,6 s. Son tiempos observados de página, no tiempos RPC ni prueba de causa. El responsable debe correlacionarlos con registros del servidor/PostgREST/Postgres y adjuntar operación, duración, código de error y ventana temporal saneados. No adjuntar credenciales, claims, datos personales ni payloads.

## Regresión

`apps/web/src/app/(authenticated)/compare/loader-errors.test.tsx` inyecta respuestas RPC y excepciones de transporte, atraviesa contexto y repositorio reales y renderiza la página real. Comprueba clase visual, copia, enlace nativo y ausencia de detalles privados.
