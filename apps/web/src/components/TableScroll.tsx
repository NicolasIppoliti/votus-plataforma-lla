import type { ReactNode } from "react";

interface TableScrollProps {
  label: string;
  children: ReactNode;
}

export function TableScroll({ label, children }: TableScrollProps): ReactNode {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
