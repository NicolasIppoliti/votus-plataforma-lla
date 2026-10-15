"use client";

import { useId, useState } from "react";
import styles from "./electoral-glossary.module.css";

const definitions = {
  seccionCode: { term: "sección", text: "División electoral dentro de un distrito. En Buenos Aires corresponde a un partido. No es la sección electoral provincial que agrupa varios partidos." },
  circuitoCode: { term: "circuito", text: "Subdivisión de una sección electoral que agrupa electores y establecimientos de votación." },
  establecimientoCode: { term: "establecimiento", text: "Lugar de votación, como una escuela, donde funcionan una o más mesas." },
  mesaCode: { term: "mesa", text: "Unidad de votación con un padrón de electores y resultados propios dentro de un establecimiento." },
} as const;

/** Help stays outside labels so existing control names remain unchanged. */
export function ElectoralGlossary({ field }: { field: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const definition = Object.hasOwn(definitions, field) ? definitions[field as keyof typeof definitions] : null;
  if (!definition) return null;
  return <span className={styles.help} onMouseEnter={() => setOpen(true)}
    onMouseLeave={event => {
      // Pointer movement must not dismiss help still owned by keyboard focus.
      if (!event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)) setOpen(false);
    }}>
    <button type="button" className={styles.trigger} aria-label={`Qué significa ${definition.term}`} aria-describedby={id}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
      <span aria-hidden="true">?</span>
    </button>
    <span id={id} role="tooltip" className={styles.tooltip} hidden={!open}>{definition.text}</span>
  </span>;
}
