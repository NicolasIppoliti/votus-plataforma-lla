import { useId, type ReactElement } from "react";
import { Table } from "@/components/ui/table";

interface TableRegionProps {
  label: string;
  mobileHint?: boolean;
  /** One semantic Table, including its caption, column groups, and rows. */
  children: ReactElement<Parameters<typeof Table>[0], typeof Table>;
}

export function TableRegion({ label, children, mobileHint = false }: TableRegionProps) {
  const hintId = useId();
  return (
    <>
      {mobileHint && <p id={hintId} className="table-scroll-hint">Desplazá horizontalmente para ver todas las columnas.</p>}
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0} aria-describedby={mobileHint ? hintId : undefined}>
        {children}
      </div>
    </>
  );
}
