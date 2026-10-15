# Selección de locales en Municipal

En la referencia CNE 2025 de Coronel Rosales, cada punto del mapa es un enlace al local correspondiente en la tabla. Se puede seleccionar con clic o con Tab y Enter. La navegación nativa desplaza y enfoca la fila; un contorno resalta el destino mientras su fragmento está seleccionado. Funciona también sin JavaScript.

Se conserva la tabla completa: los 31 locales, incluidos los tres sin coordenadas. Estos últimos no tienen punto en el mapa. La selección no modifica consultas, resultados oficiales ni fiscalización, ni atribuye resultados históricos a esta geografía de referencia.

La lectura conservadora de #448 sigue su resultado esperado (desplazar y resaltar), no un filtro que oculte las demás filas. El identificador local usa el inicio del rango de mesas del artefacto CNE, cuyos rangos completos y contiguos se validan en la carga. No es una identidad global de mesa ni de establecimiento electoral.

Cobertura: prueba de renderizado de todos los enlaces y destinos; especificación Playwright de la página real a 390 y 1440 px para clic, teclado, foco, desplazamiento, contorno y conservación de filas.
