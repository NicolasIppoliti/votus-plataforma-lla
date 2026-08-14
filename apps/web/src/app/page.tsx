import type { ReactNode } from "react";
import Link from "next/link";

export default function HomePage(): ReactNode {
  return (
    <main id="main-content" className="public-shell" tabIndex={-1}>
      <div className="shell-container">
        <header className="page-header">
          <p className="eyebrow">Internal electoral analysis</p>
          <h1>Votus</h1>
          <p className="page-header__lede">
            A civic evidence room for examining electoral results, review items,
            and declared assumptions without turning uncertainty into a claim.
          </p>
          <p className="page-header__supporting">
            Votus helps operators work from official and public evidence, keep
            provenance visible, and distinguish a prepared analysis from an
            unresolved one through explicit source status.
          </p>
        </header>

        <section className="panel panel--quiet" aria-labelledby="workspace-heading">
          <div className="panel__heading">
            <p className="eyebrow">Operator workspace</p>
            <h2 id="workspace-heading">Start with the analysis dashboard</h2>
            <p>
              Review the available workflows from one place. Context-dependent
              analysis stays explicit instead of being presented as a cold-start
              selector.
            </p>
          </div>
          <Link className="button button--primary" href="/dashboard">
            Open dashboard
          </Link>
        </section>
      </div>
    </main>
  );
}
