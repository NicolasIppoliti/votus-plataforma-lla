import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ReviewAttention, WorkspaceIdentity } from "./WorkspacePresentation";

function Workflow({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return <li className="briefing-workflow">
    <Link href={href}>{title}</Link>
    <p>{children}</p>
  </li>;
}

export function OperationalBriefing(): ReactNode {
  return (
    <main className="operational-briefing">
      <header className="briefing-heading">
        <h1>Panel operativo</h1>
        <p>Contexto de trabajo y acceso a las consultas. Cada resultado conserva su alcance y su evidencia.</p>
      </header>
      <div className="briefing-grid">
        <section className="briefing-panel briefing-intro" aria-labelledby="briefing-next-heading">
          <h2 id="briefing-next-heading">Elegir la próxima consulta</h2>
          <p>Definir una selección oficial o contrastar dos elecciones en una misma sección. Las cifras aparecen en su flujo, no en este panel.</p>
          <div className="briefing-actions">
            <Button asChild variant="solid">
              <Link href="/drilldown">Explorar resultados</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/compare">Comparar elecciones</Link>
            </Button>
          </div>
        </section>
        <ReviewAttention />
        <section className="briefing-panel briefing-work" aria-labelledby="briefing-official-heading">
          <h2 id="briefing-official-heading">Resultados oficiales</h2>
          <ul>
            <Workflow href="/drilldown" title="Explorar resultados">Elección, categoría y territorio. Tabla exacta y nivel real de la fuente.</Workflow>
            <Workflow href="/compare" title="Comparar elecciones">Elecciones nacionales de 2023 y 2025. Sección compartida y evidencia independiente.</Workflow>
            <Workflow href="/municipal" title="Resultados municipales">Coronel Rosales · Concejales 2025. Elección configurada.</Workflow>
          </ul>
        </section>
        <section className="briefing-panel briefing-separate" aria-labelledby="briefing-separate-heading">
          <h2 id="briefing-separate-heading">Flujos separados</h2>
          <ul>
            <Workflow href="/fiscalizacion" title="Cobertura y resultados">Fiscalización no oficial, por acceso explícito. La cobertura no es una muestra aleatoria.</Workflow>
            <Workflow href="/simulate" title="Simular escenario">Hipótesis de asignación. No es una predicción ni un resultado histórico.</Workflow>
          </ul>
        </section>
        <aside className="briefing-context" aria-labelledby="briefing-context-heading">
          <h2 id="briefing-context-heading">Contexto del workspace</h2>
          <WorkspaceIdentity />
          <dl>
            <dt>Alcance</dt>
            <dd>Consultas según las fuentes disponibles y el acceso autorizado.</dd>
            <dt>Disponibilidad</dt>
            <dd>Cada ruta muestra sus propias limitaciones. No se presume cobertura nacional.</dd>
          </dl>
          <p>Este panel no suma votos oficiales y de fiscalización ni presenta indicadores electorales.</p>
        </aside>
      </div>
    </main>
  );
}
