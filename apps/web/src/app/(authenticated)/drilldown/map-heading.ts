/**
 * Neutral outline or source-backed results: the heading must say which (#487).
 * Kept out of the "use client" stage module: a server component importing a plain
 * value from a client module receives a client reference, not the value.
 */
export const MAP_HEADING = { REFERENCE: "Referencia territorial", CIRCUIT_LEADERS: "Primer lugar observado por circuito" } as const;
