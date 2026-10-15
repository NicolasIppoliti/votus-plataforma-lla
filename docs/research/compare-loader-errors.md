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

## Production evidence (read-only, 2026-10-15)

**Resultado (superseded by "RPC timing evidence" below): con Vercel solamente no hay evidencia suficiente para atribuir el fallo.** La consulta de Vercel devolvió cero registros; la consulta estadística de Supabase no pudo resolver el proyecto vinculado en este checkout. No se debe cerrar el criterio de causa del issue #430 con estas observaciones. Esta sección queda lista para adjuntar al issue; no se publicó un comentario en GitHub.

### Registros y límites observados

Consultas ejecutadas el 2026-10-15, horas UTC. Vercel CLI 59.17.0; Supabase CLI 2.120.0. Se descartaron cuerpos de respuesta y mensajes de aplicación; solo se conservaron metadatos y resultados saneados. No se leyó ninguna credencial ni se cambió configuración, despliegue o dato alojado.

| Inicio UTC | Comando exacto | Resultado observado |
| --- | --- | --- |
| 16:55:05 | `vercel logs --project votus-plataforma-lla --environment production --since 24h --limit 100 --json --cwd apps/web` | Exit 0; stdout vacío, 0 registros. stderr: `Fetching project "votus-plataforma-lla"` y `Fetching logs...`. |
| 16:55:27 | `vercel logs --project votus-plataforma-lla --environment production --since 7d --limit 100 --json --cwd apps/web` | Exit 0; stdout vacío, 0 registros; mismos mensajes stderr. |
| 16:55:32 | `vercel inspect votus-plataforma-lla.vercel.app --json --cwd apps/web` | Exit 0; `readyState=READY`, `target=production`, `createdAt=1792075735246` (epoch ms). No se obtuvieron duraciones de invocación. |
| 16:55:54 | Consulta Supabase reproducida debajo | Exit 1; `Cannot find project ref. Have you run supabase link?` seguido de `Try rerunning the command with --debug to troubleshoot the error.` No se ejecutó SQL en producción. No se ejecutó `link` ni `--debug`. |
| 16:56:11 | `vercel logs --project votus-plataforma-lla --environment production --since 1h --limit 100 --json --cwd apps/web` | Exit 0; stdout vacío, 0 registros, incluso después de los GET públicos de abajo; mismos mensajes stderr. |

Consulta exclusivamente estadística intentada (sin cuerpos SQL de otras consultas, identificadores de usuarios ni filas de aplicación):

```sh
supabase db query --linked "SELECT count(*) AS statement_shapes, coalesce(sum(calls),0) AS calls, round(coalesce(sum(total_exec_time),0)::numeric,2) AS total_exec_ms, round(max(max_exec_time)::numeric,2) AS max_exec_ms, round((sum(total_exec_time)/nullif(sum(calls),0))::numeric,2) AS mean_exec_ms FROM extensions.pg_stat_statements WHERE query ILIKE '%official%facet%' AND query NOT ILIKE '%pg_stat_statements%';" --output json
```

Descubrimiento de capacidades, sin consultas de datos: `vercel logs --help`, `vercel inspect --help`, `supabase --help`, `supabase inspect --help`, `supabase projects --help`, `supabase db --help`, `supabase logs --help`, `supabase inspect db --help`, `supabase db query --help`, `supabase --version`. `supabase logs --help` mostró la ayuda raíz, no una interfaz de logs/analytics; no se obtuvo un error explícito de retención, plan o rate limit. No se infiere que estos límites existan ni que expliquen el resultado vacío de Vercel. El límite solicitado de Vercel fue 100 por consulta, no un conteo exhaustivo de tráfico. Las ventanas relativas terminan al ejecutar cada comando; no son la ventana exacta del incidente original.

### Tiempos de control público, sin autenticación

Se ejecutó tres veces consecutivas, sin cookies, tokens, seguimiento de redirecciones ni cuerpos guardados:

```sh
curl --silent --show-error --output /dev/null --max-time 30 --write-out 'status=%{http_code} ttfb_s=%{time_starttransfer} total_s=%{time_total}\n' https://votus-plataforma-lla.vercel.app/login
```

| Inicio UTC | HTTP | TTFB (s) | Total (s) |
| --- | --- | --- | --- |
| 16:56:02.237 | 200 | 1.824612 | 1.824737 |
| 16:56:04.071 | 200 | 0.569944 | 0.571444 |
| 16:56:04.653 | 200 | 0.545044 | 0.545158 |

La primera respuesta fue más lenta, pero **no demuestra un cold start**: TTFB incluye red, TLS, caché y ejecución; no se observó la duración de función ni un indicador de cold start. `/login` no ejercita el loader autorizado de `/compare` ni demuestra que sus RPC o la autenticación funcionen. Los tres HTTP 200 solo corresponden a estos controles.

### Correlación pendiente

No se observaron registros de `/compare`, 504, `FUNCTION_INVOCATION_TIMEOUT`, códigos PostgREST, `57014`, errores auth ni duraciones RPC: son datos **no disponibles**, no conteos de cero errores. Para resolver la causa hace falta una ventana UTC del fallo y evidencia de invocación/RPC de esa misma ventana, con duración y código saneados. Los tiempos públicos anteriores no sustituyen esa correlación.

## RPC timing evidence (read-only, 2026-10-15 17:1x UTC)

Run from the main checkout, which is linked to the production project (`supabase/.temp/project-ref`). Only aggregate statistics and role settings were read; no application rows, no statement bodies beyond the function name, no writes.

```sh
supabase db query --linked "select substring(query from 'results_exploration_[a-z]+') fn, sum(calls) calls, round((sum(total_exec_time)/sum(calls))::numeric,1) mean_ms, round(max(max_exec_time)::numeric,1) max_ms from extensions.pg_stat_statements where query ~ 'results_exploration_(facets|official|schools)' and query !~ 'pg_stat_statements' and query !~ 'with payload' group by 1 order by 1" -o csv
supabase db query --linked "select stats_reset from extensions.pg_stat_statements_info" -o csv
supabase db query --linked "select rolname, rolconfig from pg_roles where rolname in ('authenticated','anon','authenticator','service_role','postgres')" -o csv
```

Statistics window: since `2026-08-10 15:09:03 UTC` (last `pg_stat_statements` reset). The `with payload` filter excludes the operator verification queries (one of them took 51 s), so the rows below are the PostgREST calls the web loaders make.

Per calling role (same filters, `join pg_roles r on r.oid = s.userid`, grouped by role and function):

| Role | RPC | Calls | Mean (ms) | Max (ms) |
| --- | --- | ---: | ---: | ---: |
| `authenticated` | `results_exploration_facets` | 240 | 2,343.2 | 7,837.4 |
| `authenticated` | `results_exploration_official` | 42 | 929.0 | 6,851.6 |
| `authenticated` | `results_exploration_schools` | 6 | 2,089.1 | 6,133.9 |
| `postgres` | `results_exploration_facets` | 22 | 335.0 | 7,264.6 |
| `postgres` | `results_exploration_official` | 97 | 721.0 | 27,149.7 |
| `postgres` | `results_exploration_schools` | 10 | 752.6 | 7,471.6 |
| `service_role` | `results_exploration_official` | 16 | 1,617.9 | 6,320.8 |

Rows with one or two calls (`results_exploration_party`, `results_exploration_executor`, `workspace_query_owner`) are omitted; all were under 6 ms.

Role settings: `authenticated` has `statement_timeout=8s`; `authenticator` has `statement_timeout=8s lock_timeout=8s`; `anon` has `3s`.

### Classification

**Cause: database statement timeout on the `/compare` loader RPCs (timeout/unavailable class, not denial).**

- `/compare` calls `results_exploration_facets` before it can render its authorized options. For the `authenticated` role (the web session) its mean is 2.3 s and its recorded maximum is 7.84 s, right under the 8 s `statement_timeout` of the `authenticated` role.
- `pg_stat_statements` records only completed statements. A call cancelled at 8 s (SQLSTATE `57014`) is not in the table, so a maximum that clusters just below the cap is what a distribution truncated by the timeout looks like.
- The desktop failure took 10.7 s, which matches 8 s of statement time plus authentication, PostgREST and network round trips. The mobile load seconds later (3.6 s) matches a warm cache for the same arguments.
- `results_exploration_official` once completed in 27 s. That call ran as `postgres`, which has no `statement_timeout`; it shows the uncapped cost of the query, not a successful web request.

The page already distinguishes this class from denial and offers "Reintentar" (PR #532, `loader-errors.test.tsx`). Making the RPCs fit comfortably inside the 8 s budget is performance work, which the issue lists as a non-goal; it belongs to the ETL/query performance issues (#481 and successors).

## Regresión

`apps/web/src/app/(authenticated)/compare/loader-errors.test.tsx` inyecta respuestas RPC y excepciones de transporte, atraviesa contexto y repositorio reales y renderiza la página real. Comprueba clase visual, copia, enlace nativo y ausencia de detalles privados.
