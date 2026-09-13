import type { ReactNode } from "react";
import Link from "next/link";
import { SourceDisclaimer } from "@/components/SourceDisclaimer";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function SituationSidebar({ footer }: { footer: ReactNode }): ReactNode {
  return (
    <aside className="situation-sidebar">
      <Link className="site-brand" href="/" aria-label="Panel de Votus">
        <span className="site-brand__name">Votus</span>
        <span className="site-brand__descriptor">espacio de evidencia</span>
      </Link>
      <PrimaryNavigation />
      <div className="source-disclaimer">
        <SourceDisclaimer />
      </div>
      {footer}
    </aside>
  );
}
