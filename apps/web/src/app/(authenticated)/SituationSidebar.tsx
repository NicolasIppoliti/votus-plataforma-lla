import type { ReactNode } from "react";
import Link from "next/link";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function SituationSidebar({ children }: { children?: ReactNode }): ReactNode {
  return (
    <aside className="situation-sidebar">
      <Link className="site-brand" href="/" aria-label="Panel de Votus">
        <svg className="site-brand__glyph" viewBox="0 0 42 42" aria-hidden="true"><path d="M6 7 21 35 36 7M14 7l7 14 7-14" /></svg>
        <span className="site-brand__name">votus<span className="site-brand__dot">.</span></span>
      </Link>
      <p className="workspace-label">Espacio de análisis</p>
      <PrimaryNavigation />
      {children ? <div className="situation-sidebar__footer">{children}</div> : null}
    </aside>
  );
}
