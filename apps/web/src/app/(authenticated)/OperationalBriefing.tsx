import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ReviewAttention } from "./WorkspacePresentation";

function Workflow({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  const descriptionId = `workflow-${href.slice(1)}-description`;
  return (
    <li className="briefing-workflow">
      <Link href={href} aria-label={title} aria-describedby={descriptionId}>
        <span className="briefing-workflow__copy">
          <span className="briefing-workflow__title">{title}</span>
          <span id={descriptionId} className="briefing-workflow__description">{children}</span>
        </span>
        <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </li>
  );
}

export function OperationalBriefing(): ReactNode {
  return (
    <main className="operational-briefing">
      <header className="briefing-heading">
        <h1>Panel operativo</h1>
        <p>Consulte resultados, contraste elecciones y explore escenarios.</p>
      </header>
      <div className="briefing-grid">
        <section className="briefing-panel briefing-work" aria-labelledby="briefing-official-heading">
          <h2 id="briefing-official-heading">Resultados oficiales</h2>
          <ul>
            <Workflow href="/drilldown" title="Explorar resultados">Elección, categoría y territorio. Tabla exacta y nivel real de la fuente.</Workflow>
            <Workflow href="/compare" title="Comparar elecciones">Elecciones nacionales de 2023 y 2025. Sección compartida y evidencia independiente.</Workflow>
            <Workflow href="/municipal" title="Resultados municipales">Coronel Rosales · Concejales 2025. Elección configurada.</Workflow>
          </ul>
        </section>
        <ReviewAttention />
        <section className="briefing-panel briefing-separate" aria-labelledby="briefing-separate-heading">
          <h2 id="briefing-separate-heading">Flujos separados</h2>
          <ul>
            <Workflow href="/fiscalizacion" title="Cobertura y resultados">Fiscalización no oficial, por acceso explícito. La cobertura no es una muestra aleatoria.</Workflow>
            <Workflow href="/simulate" title="Simular escenario">Hipótesis de asignación. No es una predicción ni un resultado histórico.</Workflow>
          </ul>
        </section>
      </div>
      <p className="briefing-scope">Las consultas conservan el alcance de cada fuente. La disponibilidad depende del territorio y del acceso autorizado.</p>
    </main>
  );
}
