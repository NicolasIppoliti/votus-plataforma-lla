# Comparación móvil — #462 y #499

## Referencia y alcance

Se usa `docs/prototypes/temporal-comparison/` como referencia sustitutiva,
por autorización explícita del usuario. No están disponibles las capturas ni
las notas originales de round 4. Esto no constituye aceptación visual 1:1.

## Cambios verificables en código

- Hasta 760 px, los seis selectores usan una columna, también dentro de los
  fieldsets A/B y del territorio compartido. Se conservan nombres accesibles,
  claves URL y comportamiento automático.
- Los dos mapas estáticos siguen visibles al cargar. Cada mapa pliega sus
  acciones opcionales, estado y enlace repetido en un disclosure nativo;
  ninguna acción ni texto se elimina. Los botones usan superficies y bordes navy.
- El contexto aplicado repetido se conserva en un disclosure. Los estados de
  rechazo, etiquetas oficiales, completitud, límites de interpretación y
  evidencia por lado permanecen fuera de ese disclosure.
- Los controles del siguiente nivel comienzan plegados cuando ese nivel no
  está disponible; la explicación de indisponibilidad permanece visible.
- Se compactan espacios móviles y se mantiene Ganadores en una línea, con
  controles de al menos 44 px de alto y texto de 14 px.
- La jerarquía funcional conserva selectores → mapas A/B → inspector → cambio
  por territorio, seguida del contexto de apoyo, cifras exactas y evidencia.

## Evidencia automatizada

Las regresiones de la página renderizada y del CSS se observaron fallar antes
de implementar. La suite Vitest verifica los disclosures, la conservación de
texto/etiquetas y las columnas móviles. El spec Playwright conserva el foco en
Resultados exactos y ahora exige que su disclosure quede abierto al seleccionar
la sección, tanto en escritorio como en móvil. También comprueba campos
apilados y espacio para el texto seleccionado a 390 y 320 px.

## Pendiente, sin afirmar aprobación

- Ejecutar Playwright y `test:e2e:gate`: se requiere 8/8, cero omitidos.
- Capturas reales a 320 y 390 px y pares a escala 1:1, con notas por elemento.
- Medir la altura resultante; no se afirma alcanzar los 3.661 px del espécimen.
- Verificador visual independiente sin hallazgos bloqueantes.
