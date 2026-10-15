import type { ReactNode } from "react";
import { EvidenceState } from "@/components/EvidenceState";
import styles from "./RouteLoading.module.css";

const BLOCKS = { filters: styles.filters, map: styles.map, table: styles.table } as const;

/**
 * Route skeleton shown while a slow server page loads (#431). Shapes only:
 * it never renders a figure, so nothing can be read as a result.
 */
export function RouteLoading({ title, blocks }: { title: string; blocks: readonly (keyof typeof BLOCKS)[] }): ReactNode {
  return (
    <main className={`page-shell ${styles.root}`} aria-busy="true">
      <div className="shell-container">
        <EvidenceState state="loading" title={title} titleId="route-loading-heading" />
      </div>
      <div className={`shell-container ${styles.root}`} aria-hidden="true">
        <div className={`${styles.block} ${styles.header}`} />
        {blocks.map((block) => <div key={block} className={`${styles.block} ${BLOCKS[block]}`} />)}
      </div>
    </main>
  );
}
