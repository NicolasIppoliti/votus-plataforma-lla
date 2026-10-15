# Primer ingreso: resultados de Rosales en tres clics

El recorrido de #467 verifica que una persona nueva, con una sola organización
activa, pueda ver resultados oficiales en Panorama, Exploración y Municipal sin
usar el selector de organización ni completar filtros electorales.

## Recorrido verificado

En escritorio (1440 × 1000), partiendo de `/login` con las credenciales completas:

1. **Iniciar sesión** abre Panorama con el resumen de Coronel Rosales.
2. **Explorar resultados** sigue el enlace real de Panorama y abre los resultados
   de la sección nacional `02 / 027`, con nivel `seccion`.
3. **Municipal**, en la navegación principal, abre la elección municipal configurada
   y su tabla de resultados oficiales exactos.

Los tres clics cuentan acciones de navegación, incluido el envío del login; no
cuentan la escritura de credenciales. No se afirma un presupuesto de tres clics
para el drawer móvil. Fiscalización conserva su acceso explícito y separado.

## Cobertura y release gate

El caso `first-run: a fresh sole-organization user reaches Rosales results in three
clicks` está en `apps/web/e2e/municipal.spec.ts`, ya incluido en el inventario
obligatorio del release gate. Reutiliza el servidor y los resultados aislados del
escenario municipal; crea una cuenta sintética y una única membresía antes del
login real, abre un contexto de navegador sin cookies ni storage y limpia los
recursos propios al terminar. No cambia la organización por API ni inyecta una
sesión autenticada. La fixture incluye votos de fiscalización como control
negativo, pero las cifras verificadas son exclusivamente oficiales.

`apps/web/e2e/first-run-gate.test.ts` protege la inclusión del caso sin skip y sus
tres clics. Las pruebas de páginas renderizadas comprueban además:

- La página raíz real resuelve el contexto desde facetas autorizadas, muestra la
  cifra y produce el enlace que la página real de Exploración consume sin filtros
  adicionales (`drilldown/page.test.tsx`).
- La página real de Municipal muestra resultados al recibir parámetros vacíos
  (`municipal/page.test.tsx`).
- Los títulos compartidos del mapa viven en un módulo sin directivas, evitando
  importar valores ordinarios de un componente cliente desde la página servidor.

Las pruebas unitarias no sustituyen la ejecución de navegador, Auth/RLS ni la
verificación del bootstrap en base de datos. En esta implementación no se ejecutó
Playwright.

## Dependencias y límites

**#425 / PR #518 debe integrarse antes:** el primer bootstrap de una sesión con
una sola membresía activa selecciona esa organización. Este cambio no implementa
un fallback web, no modifica contextos existentes y no altera el comportamiento
para cero o varias organizaciones.

Para el recorrido de #437 se usa el enlace contextual **Explorar resultados** de
Panorama; no se amplía aquí el comportamiento de la ruta `/drilldown` sin parámetros.
La repetición de la auditoría visual de producción corresponde a #468.
