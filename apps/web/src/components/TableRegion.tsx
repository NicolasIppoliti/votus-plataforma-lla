import type { ReactElement } from "react";
import { Table } from "@/components/ui/table";

interface TableRegionProps {
  label: string;
  /** One semantic Table, including its caption, column groups, and rows. */
  children: ReactElement<Parameters<typeof Table>[0], typeof Table>;
}

export function TableRegion({ label, children }: TableRegionProps) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
