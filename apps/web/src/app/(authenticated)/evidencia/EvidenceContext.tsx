"use client";

import { useState, type ReactNode } from "react";
import styles from "./evidence.module.css";

export interface EvidenceField {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}
/** Native GET navigation replaces the entire served selection; pending data is never shown. */
export function EvidenceContext({ fields, children }: { fields: EvidenceField[]; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  return <>
    <form action="/evidencia" method="get" className={styles.context} aria-label="Contexto de la evidencia" onChange={event => {
      const form = event.currentTarget;
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const changed = target.name;
      const index = fields.findIndex(field => field.name === changed);
      for (const field of fields.slice(index + 1)) {
        const control = form.elements.namedItem(field.name);
        if (control instanceof HTMLSelectElement) control.value = "";
      }
      setPending(true);
      form.requestSubmit();
    }}>
      {fields.map(field => <div key={field.name} className={styles.field}>
        <label htmlFor={`evidence-${field.name}`}>{field.label}</label>
        <select id={`evidence-${field.name}`} name={field.name} defaultValue={field.value}>
          <option value="">Seleccionar</option>
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {field.value && <span className="selected-value" aria-hidden="true">{field.options.find(option => option.value === field.value)?.label}</span>}
      </div>)}
      <div className={styles.field}><span>Origen</span><strong>Oficial · autorizado</strong></div>
      <noscript><button type="submit">Consultar evidencia</button></noscript>
    </form>
    {pending ? <section className={styles.notice} role="status">Consultando la nueva selección. No se muestran cifras ni trazabilidad anteriores.</section> : children}
  </>;
}
