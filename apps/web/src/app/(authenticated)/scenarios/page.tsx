import {
  type ScenarioArtifact,
  type ScenarioRefusal,
  loadScenarioArtifact,
} from "@/lib/scenarios/scenario-artifact";
import { circuitColor } from "@/components/maps/reference-colors";
import { formatCount } from "@/lib/format/number";
import "./scenarios.css";
import { Alert } from "@/components/ui/alert";

const REFUSAL_MESSAGE: Record<ScenarioRefusal, string> = {
  missing: "El archivo de escenarios no está disponible.",
  hash_mismatch: "El archivo de escenarios no coincide con la versión verificada.",
  validated_claim: "El archivo declara transferencias validadas, algo fuera del alcance de esta vista.",
  invalid_artifact: "El archivo de escenarios no tiene el formato verificado.",
  unvalidated_label_missing: "El archivo de escenarios no declara que sus supuestos no están validados.",
  seat_total_mismatch: "Las bancas del archivo no suman las 9 bancas de la renovación.",
  default_mismatch: "El archivo no declara la persistencia como escenario por defecto.",
};

/** Artifact decimals are exact strings; only the separator changes for es-AR. */
function decimal(text: string) {
  return text.replace(".", ",");
}

function PageHeader() {
  return <header className="scenarios-page__header">
    <nav aria-label="Recorrido de la página">Simulación / Escenarios</nav>
    <h1>Escenarios Rosales 2027</h1>
    <p>Escenarios hipotéticos para la renovación municipal.</p>
  </header>;
}

type Scenario = ScenarioArtifact["scenarios"][number];

function seatDelta(scenario: Scenario, baseline: Scenario, listId: string) {
  if (scenario.seat_status !== "allocated" || baseline.seat_status !== "allocated") return "No disponible";
  const current = scenario.lists.find((row) => row.list_id === listId);
  const reference = baseline.lists.find((row) => row.list_id === listId);
  if (!current || !reference) return "Sin correspondencia";
  const delta = current.seats - reference.seats;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${formatCount(Math.abs(delta))}`;
}

function ScenarioSection({ scenario, baseline }: { scenario: Scenario; baseline: Scenario }) {
  return (
    <section aria-labelledby={`scenario-${scenario.id}`} data-testid={`scenario-${scenario.id}`}>
      <h2 id={`scenario-${scenario.id}`}>
        {scenario.name}
        {scenario.default ? " (por defecto)" : null}
      </h2>
      <a href={`/simulate?scenario=${encodeURIComponent(scenario.id)}`}>Editar este escenario</a>
      {scenario.seat_status === "ambiguous_tie" ? (
        <p role="note">Empate ambiguo en la asignación Hare: no se muestran bancas.</p>
      ) : null}
      {scenario.seat_status === "allocated" ? (
        <div className="scenario-seat-bar" role="img" aria-label={`Bancas de ${scenario.name}: ${scenario.lists.map((row) => `${row.label}: ${formatCount(row.seats)}`).join("; ")}`}>
          {scenario.lists.filter((row) => row.seats > 0).map((row) => (
            <span key={row.list_id} aria-hidden="true" style={{ flex: row.seats, backgroundColor: circuitColor(row.list_id) }}>
              {formatCount(row.seats)}
            </span>
          ))}
        </div>
      ) : null}
      <p>Diferencia de bancas respecto de {baseline.name}. Sin correspondencia indica una lista ausente en el otro escenario, no cero bancas.</p>
      <div className="table-scroll" role="region" aria-label={`Listas del escenario ${scenario.name}`} tabIndex={0}>
        <table className="data-table">
          <caption>Listas del escenario {scenario.name}</caption>
          <thead>
            <tr>
              <th scope="col">Lista</th>
              <th scope="col">Votos positivos (%)</th>
              <th scope="col">Bancas</th>
              <th scope="col">Diferencia vs. {baseline.name}</th>
            </tr>
          </thead>
          <tbody>
            {scenario.lists.map((row) => (
              <tr key={row.list_id}>
                <th scope="row">{row.label}</th>
                <td>{decimal(row.share_percent)}</td>
                <td>{scenario.seat_status === "allocated" ? formatCount(row.seats) : "—"}</td>
                <td>{seatDelta(scenario, baseline, row.list_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ScenariosPage() {
  const result = await loadScenarioArtifact();
  if (!result.ok) {
    return (
      <main className="scenarios-page">
        <PageHeader />
        <Alert variant="unavailable">{REFUSAL_MESSAGE[result.reason]} No se muestran escenarios.</Alert>
      </main>
    );
  }
  const { artifact } = result;
  const scenarios = [...artifact.scenarios].sort((a, b) => Number(b.default) - Number(a.default));
  const { backtest } = artifact;
  return (
    <main className="scenarios-page">
      <PageHeader />
      <div className="scenarios-page__context" role="region" aria-label="Contexto del escenario hipotético">
      <p>
        Concejales de {artifact.territory.name}, renovación de {artifact.seats_per_renewal} bancas,
        a partir de los resultados definitivos {artifact.base_year}.
      </p>
      <Alert variant="caveat" className="scenarios-page__status">
        Transferencias: <strong>{artifact.status.label}</strong>. Son supuestos, no un pronóstico.
      </Alert>
      <section aria-labelledby="scenarios-backtest">
        <h2 id="scenarios-backtest">Por qué no están validados</h2>
        <p>
          En la prueba histórica, el modelo de transferencias tuvo un error medio (variación
          total del reparto de votos) de{" "}
          {decimal(backtest.development_mean_tv_pp.model)} pp frente a{" "}
          {decimal(backtest.development_mean_tv_pp.reference)} pp de la persistencia. En la prueba
          única 2025: {decimal(backtest.final_tv_pp.model)} pp frente a{" "}
          {decimal(backtest.final_tv_pp.reference)} pp.
        </p>
      </section>
      </div>
      {scenarios.map((scenario) => (
        <ScenarioSection key={scenario.id} scenario={scenario} baseline={scenarios.find((item) => item.default)!} />
      ))}
    </main>
  );
}
