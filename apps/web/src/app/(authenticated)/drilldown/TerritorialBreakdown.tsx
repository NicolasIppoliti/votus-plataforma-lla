"use client";
import { useRef, useState, type ReactNode } from "react";
import styles from "./drilldown.module.css";
import { TerritorialFilterStatus } from "@/components/TerritorialFilterStatus";

export function TerritorialBreakdown({ context, children, total }: { context: string; children: ReactNode; total: number }) {
  const region = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(total);
  return <section className={styles.territorialBreakdown} aria-labelledby="territorial-breakdown-heading">
    <header className={styles.breakdownHeader}><div><h2 id="territorial-breakdown-heading">Desglose territorial</h2><p>{context}</p></div>
      <label>Filtrar territorios<input type="search" placeholder="Buscar por nombre" value={query} onChange={event => {
        const value = event.target.value; setQuery(value);
        let count = 0;
        region.current?.querySelectorAll("tbody tr").forEach(row => {
          const matches = (row.querySelector("th, td")?.textContent ?? "").toLocaleLowerCase("es").includes(value.toLocaleLowerCase("es"));
          (row as HTMLTableRowElement).hidden = !matches;
          if (matches) count++;
        });
        setVisible(count);
      }} /></label>
    </header><TerritorialFilterStatus visible={visible} total={total} noMatches={visible === 0 && query.length > 0} /><div ref={region} className={styles.childScroll}>{children}</div>
  </section>;
}
