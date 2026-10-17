export const metadata = { title: "Configurar organización" };

import Link from "next/link";
import type { ReactNode } from "react";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import { returnDestination } from "@/lib/auth/return-destination";
import { loadOnboardingScope } from "./scope";
import { formatFacetOptionLabel, type ExplorationFacetExclusion } from "@/lib/results/exploration";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NAVIGATION_GROUPS, type NavigationItem } from "../../(authenticated)/navigation";
import { chooseOrganization, finishOnboarding } from "./actions";
import { SubmitButton } from "./SubmitButton";
import styles from "./onboarding.module.css";

const steps = [
  { id: "organizacion", label: "Organización" },
  { id: "alcance", label: "Tu alcance" },
  { id: "guia", label: "Guía de Votus" },
  { id: "ingreso", label: "Ingresar" },
] as const;
const descriptions: Record<string, string> = {
  Panorama: "Leé un resumen de los resultados oficiales y ubicá el contexto electoral.",
  Exploración: "Recorré los resultados por territorio, desde la sección hasta el detalle disponible.",
  Municipal: "Consultá la elección municipal y la distribución de bancas según el régimen aplicable.",
  Comparación: "Contrastá dos elecciones o territorios sin perder sus fuentes y diferencias de cobertura.",
  Simulación: "Explorá hipótesis sobre una base explícita. Una simulación no es un resultado oficial.",
  "Escenarios Rosales 2027": "Guardá y compará hipótesis de trabajo para Coronel Rosales.",
  Evidencia: "Revisá fuentes y limitaciones antes de interpretar una cifra.",
  "Revisión de datos": "Consultá inconsistencias pendientes y sus motivos.",
  "Fiscalización (no oficial)": "Consultá evidencia interna solo de forma explícita. No se mezcla con resultados oficiales y su cobertura no es una muestra aleatoria.",
};
function Exclusions({ items = [] }: { items?: ExplorationFacetExclusion[] | undefined }) {
  return items.length ? <aside className={styles.exclusions} aria-label="Filas excluidas por motivo"><p>Filas no incluidas en este alcance:</p><ul>{items.map((item) => <li key={item.reason}>{item.reason}: {item.rows.toLocaleString("es-AR")} filas</li>)}</ul></aside> : null;
}

async function Scope(): Promise<ReactNode> {
  let scope: Awaited<ReturnType<typeof loadOnboardingScope>> | null = null;
  try { scope = await loadOnboardingScope(); } catch { /* Unknown is not empty. */ }
  if (!scope) return (
    <Alert variant="caveat">
      <strong>No se pudo cargar el alcance.</strong> No podemos confirmar qué datos están disponibles.{" "}
      <Link href="/onboarding?paso=alcance">Reintentar</Link>
    </Alert>
  );
  return <>
    {scope.elections.length ? scope.elections.map(({ election, categories, exclusions }) => (
      <article key={election.id} className={styles.election}>
        <h3>{election.label}</h3>
        {categories.map(({ category, territories, exclusions: categoryExclusions }) => (
          <section key={category.id} className={styles.category}>
            <h4>{category.name}</h4>
            {territories.length ? <ul>{territories.map(({ district, sections, exclusions: sectionExclusions }) => (
              <li key={district.code}>
                <strong>{formatFacetOptionLabel(district)}</strong>
                <ul>{sections.map((section) => <li key={section.code}>{formatFacetOptionLabel(section)}</li>)}</ul>
                <Exclusions items={sectionExclusions} />
              </li>
            ))}</ul> : <p>No hay territorios disponibles para esta categoría.</p>}
            <Exclusions items={categoryExclusions} />
          </section>
        ))}
        <Exclusions items={exclusions} />
      </article>
    )) : <Alert variant="empty">No hay resultados oficiales disponibles para esta organización.</Alert>}
    <Exclusions items={scope.exclusions} />
  </>;
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selection = await loadWorkspaceSelection();
  const destination = returnDestination(params.returnTo);
  const active = selection.status === "active";
  const requested = typeof params.paso === "string" ? params.paso : "";
  const step = !active ? "organizacion" : steps.some(({ id }) => id === requested) ? requested : "alcance";
  const organization = selection.organizations.find(({ id }) => id === selection.activeOrganizationId);
  const url = (paso: string) => `/onboarding?${new URLSearchParams({ paso, returnTo: destination })}`;
  return <main className={styles.onboarding}>
    <header className={styles.header}><p className="eyebrow">Guía de Votus</p><h1>Tu espacio de análisis,<br />paso a paso.</h1><p>Conocé tu organización, revisá los datos disponibles y elegí cómo empezar.</p>{organization ? <p className={styles.organization}>{organization.name}</p> : null}</header>
    <nav aria-label="Pasos del onboarding" className={styles.steps}><ol>{steps.map(({ id, label }, index) => <li key={id} aria-current={step === id ? "step" : undefined}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>{active ? <Link href={url(id)}>{label}</Link> : <span>{label}</span>}</li>)}</ol></nav>
    <section className={styles.content} aria-labelledby="onboarding-step-title">
      {step === "organizacion" ? <><p className="eyebrow">01 / Organización</p><h2 id="onboarding-step-title">Elegí tu organización</h2><p>Tu organización define los territorios y datos a los que tenés acceso. Elegirla no cambia los permisos de tu cuenta.</p>
        {params.error === "organizacion" ? <Alert variant="caveat">No se pudo activar la organización. Revisá tu acceso e intentá de nuevo.</Alert> : null}
        {selection.total === 0 ? <Alert variant="empty">No hay organizaciones disponibles. Pedile acceso a quien administra tu organización.</Alert> : ["active", "selection_required", "stale"].includes(selection.status) && selection.revision !== null && selection.organizations.length > 0 ? <form action={chooseOrganization} className={styles.form}><input type="hidden" name="revision" value={selection.revision} /><input type="hidden" name="returnTo" value={destination} /><label htmlFor="onboarding-organization">Organización</label><select id="onboarding-organization" name="organizationId" required defaultValue={selection.activeOrganizationId ?? ""}><option value="" disabled>Seleccionar organización</option>{selection.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{selection.truncated ? <p>Se muestran las primeras 100 de {selection.total} organizaciones; la activa puede aparecer adicionalmente.</p> : null}<SubmitButton label="Continuar con esta organización" pendingLabel="Activando organización…" /></form> : <Alert variant="caveat">No se pudo verificar la organización. Intentá de nuevo o volvé a iniciar sesión.</Alert>}
      </> : step === "alcance" ? <><p className="eyebrow">02 / Alcance autorizado</p><h2 id="onboarding-step-title">Tu alcance de trabajo</h2><p>Estos son los resultados oficiales disponibles para tu organización, agrupados por elección, categoría y territorio. Disponibilidad no significa cobertura completa de todas las mesas.</p>{await Scope()}<footer className={styles.actions}><Button asChild><Link href={url("guia")}>Continuar a la guía</Link></Button></footer></> : step === "guia" ? <><p className="eyebrow">03 / Guía por módulo</p><h2 id="onboarding-step-title">Una guía para cada tarea</h2><p>Volvé a esta guía cuando lo necesites. Consultarla no cambia tu organización activa.</p><div className={styles.modules}>{Object.values(NAVIGATION_GROUPS).flatMap<NavigationItem>((group) => group.items).map((item) => <article key={item.href}><h3>{item.label}</h3><p>{descriptions[item.label]}</p><Link href={item.href}>Abrir {item.label}</Link></article>)}</div><footer className={styles.actions}><Link href={url("alcance")}>Volver al alcance</Link><Button asChild><Link href={url("ingreso")}>Continuar</Link></Button></footer></> : <><p className="eyebrow">04 / Todo listo</p><h2 id="onboarding-step-title">Empezá con tu contexto claro</h2><p>Vas a ingresar con {organization?.name}. Podés volver a consultar la Guía de Votus sin repetir la configuración.</p>{params.error === "finalizacion" ? <Alert variant="caveat">No se pudo guardar la finalización. Intentá de nuevo; tu organización no cambió.</Alert> : null}<form action={finishOnboarding} className={styles.actions}><input type="hidden" name="returnTo" value={destination} /><Link href={url("guia")}>Volver a la guía</Link><SubmitButton label="Ingresar a Votus" pendingLabel="Guardando…" /></form></>}
    </section>
  </main>;
}
