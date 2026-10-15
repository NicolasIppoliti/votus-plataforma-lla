# Ayudas del vocabulario electoral

En `/drilldown` y `/fiscalizacion`, el botón **«Qué significa sección»** está junto a la etiqueta Sección. En Exploración, dentro del selector Territorio, aparece al desplegarlo. Las otras definiciones acompañan el título del nivel que permite elegir el navegador territorial: Circuitos, Establecimientos o Mesas (también Mesa seleccionada al final del recorrido).

- **Sección:** división electoral dentro de un distrito. En Buenos Aires corresponde a un partido; no es la sección electoral provincial que agrupa varios partidos.
- **Circuito:** subdivisión de una sección electoral que agrupa electores y establecimientos de votación.
- **Establecimiento:** lugar de votación, como una escuela, donde funcionan una o más mesas.
- **Mesa:** unidad de votación con un padrón de electores y resultados propios dentro de un establecimiento.

Las ayudas se abren con foco de teclado, al pasar el puntero o al pulsar el botón. Escape las cierra sin mover el foco; también se cierran al salir de la ayuda. Cada botón tiene nombre accesible y su definición asociada mediante `aria-describedby`. Los nombres de los selectores y las acciones territoriales no cambian; pulsar una ayuda no envía formularios ni cambia el alcance.

Las definiciones se mantienen en `apps/web/src/components/ElectoralGlossary.tsx`, compartidas por ambos formularios y el navegador. No modifican códigos, normalización, consultas ni la separación entre resultados oficiales y fiscalización.

## Verificación

Los tests de Vitest renderizan los formularios y el navegador reales, verifican la asociación descriptiva y ejercitan foco, Escape, puntero, pulsación y campos sin definición. Las especificaciones Playwright de exploración y fiscalización incluyen la apertura y el cierre con Escape en las páginas reales. La ejecución de estas últimas queda pendiente del entorno e2e autorizado.
