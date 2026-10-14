"use client";
import { useRef, useState, type ReactNode } from "react";
import styles from "./drilldown.module.css";

export function TerritorialBreakdown({ context, children }: { context: string; children: ReactNode }) {
  const region = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  return <section className={styles.territorialBreakdown} aria-labelledby="territorial-breakdown-heading">
    <header className={styles.breakdownHeader}><div><h2 id="territorial-breakdown-heading">Desglose territorial</h2><p>{context}</p></div>
      <label>Filtrar territorios<input type="search" placeholder="Buscar por nombre" value={query} onChange={event => {
        const value = event.target.value; setQuery(value);
        region.current?.querySelectorAll("tbody tr").forEach(row => {
          (row as HTMLTableRowElement).hidden = !(row.querySelector("th, td")?.textContent ?? "").toLocaleLowerCase("es").includes(value.toLocaleLowerCase("es"));
        });
      }} /></label>
    </header><div ref={region} className={styles.childScroll}>{children}</div>
  </section>;
}
