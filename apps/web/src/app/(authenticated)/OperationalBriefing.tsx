import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ReviewAttention } from "./WorkspacePresentation";
import { Panorama } from "./panorama/Panorama";
import type { PanoramaData } from "./panorama/load-panorama";
import styles from "./panorama/panorama.module.css";

function Workflow({ href, id, title, children }: { href: string; id: string; title: string; children: ReactNode }) {
  const descriptionId = `workflow-${id}-description`;
  return <li><Link href={href} aria-label={title} aria-describedby={descriptionId}><strong>{title}<ArrowUpRight size={18} aria-hidden="true" /></strong><span id={descriptionId}>{children}</span></Link></li>;
}

export function OperationalBriefing({ data = { href: "/drilldown", exclusions: [] } }: { data?: PanoramaData }): ReactNode {
  return <main className={styles.page}>
    <header className={styles.heading}><p>Espacio de trabajo / Panorama</p><h1>Panorama</h1><p>Una lectura del territorio. Un punto de partida para el análisis.</p></header>
    <Panorama data={data} />
    <section className={styles.routes} aria-labelledby="panorama-routes"><h2 id="panorama-routes">Continuar el análisis</h2><p>Exploración conserva la selección oficial verificada. Los demás módulos abren su contexto inicial.</p><ul>
      <Workflow href={data.href} id="drilldown" title="Explorar resultados">Exploración · Resultados oficiales. Tabla exacta y nivel real de la fuente.</Workflow>
      <Workflow href="/compare" id="compare" title="Comparar elecciones">Comparación · Contrastar bases y reconocer sus condiciones de comparabilidad.</Workflow>
      <Workflow href="/simulate" id="simulate" title="Simular escenario">Simulación · Hipótesis de asignación. No es una predicción ni un resultado histórico.</Workflow>
      <Workflow href="/evidencia" id="evidencia" title="Revisar evidencia">Evidencia · Disponibilidad, trazabilidad y límites de lectura de la selección oficial.</Workflow>
    </ul><div className={styles.attention}><ReviewAttention /><p>Revisión de datos abre la cola de revisión disponible en este workspace.</p></div></section>
    <section className={styles.secondary} aria-labelledby="panorama-separated"><h2 id="panorama-separated">Otros alcances · flujos separados</h2><ul>
      <Workflow href="/municipal" id="municipal" title="Resultados municipales">Coronel Rosales · Concejales 2025. Elección configurada.</Workflow>
      <Workflow href="/fiscalizacion" id="fiscalizacion" title="Cobertura y resultados">Fiscalización no oficial, por acceso explícito. La cobertura no es una muestra aleatoria.</Workflow>
    </ul></section>
  </main>;
}
