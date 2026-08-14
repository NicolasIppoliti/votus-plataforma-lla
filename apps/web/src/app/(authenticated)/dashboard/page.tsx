import type { ReactNode } from "react";
import Link from "next/link";

export default function DashboardPage(): ReactNode {
  return (
    <main className="page-shell">
      <div className="shell-container">
        <header className="page-header">
          <p className="eyebrow">Evidence room / workspace index</p>
          <h1>Votus dashboard</h1>
          <p className="page-header__lede">
            Move from official and public evidence to review, analysis, and
            bounded simulation with the source status of each workflow in view.
          </p>
        </header>

        <section className="workflow-section" aria-labelledby="evidence-workflows">
          <div className="workflow-section__heading">
            <h2 id="evidence-workflows">Evidence and review</h2>
            <p>
              Start with workflows that inspect results, record source status, or
              surface unresolved material before an interpretation is shared.
            </p>
          </div>
          <ul className="workflow-grid">
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Official results</p>
                <h3>Explore the result record</h3>
                <p>
                  Inspect official result rows with their granularity and
                  provenance rather than collapsing the evidence into a single
                  headline number.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/drilldown">
                  Explore results
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Opt-in source</p>
                <h3>Inspect fiscalización records</h3>
                <p>
                  Review unofficial fiscalización material separately from
                  official figures, with its source status kept visible.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/fiscalizacion">
                  Fiscalización (unofficial)
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Needs attention</p>
                <h3>Resolve review items</h3>
                <p>
                  See unresolved questions and evidence gaps before relying on
                  a result or carrying an interpretation forward.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/review">
                  Review
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Model assumptions</p>
                <h3>Test seat projections</h3>
                <p>
                  Run a bounded seat simulation while keeping assumptions and
                  non-official projections distinct from observed results.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/simulate">
                  Seat simulation
                </Link>
              </div>
            </li>
          </ul>
        </section>

        <section className="workflow-section" aria-labelledby="prepared-workflows">
          <div className="workflow-section__heading">
            <h2 id="prepared-workflows">Prepared analysis paths</h2>
            <p>
              These routes are discoverable here, but they require a prepared
              or deep-linked context to be meaningful.
            </p>
          </div>
          <ul className="workflow-grid">
            <li className="workflow-card workflow-card--prepared">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Prepared context required</p>
                <h3>Compare election outcomes</h3>
                <p>
                  Compare two prepared elections when their jurisdiction,
                  category, and party mapping context is known. This card does
                  not start a data-selection workflow from a cold click.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/compare">
                  Compare election outcomes
                </Link>
              </div>
            </li>
            <li className="workflow-card workflow-card--prepared">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Prepared context required</p>
                <h3>Analyze municipal councils</h3>
                <p>
                  Open municipal analysis from a prepared or deep-linked
                  jurisdiction context. This card does not start a
                  data-selection workflow from a cold click.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/municipal">
                  Municipal council analysis
                </Link>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
