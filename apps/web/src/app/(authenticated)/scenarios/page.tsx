import {
  type ScenarioArtifact,
  type ScenarioRefusal,
  loadScenarioArtifact,
} from "@/lib/scenarios/scenario-artifact";
import "./scenarios.css";

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

function ScenarioSection({ scenario }: { scenario: ScenarioArtifact["scenarios"][number] }) {
  return (
    <section aria-labelledby={`scenario-${scenario.id}`} data-testid={`scenario-${scenario.id}`}>
      <h2 id={`scenario-${scenario.id}`}>
        {scenario.name}
        {scenario.default ? " (por defecto)" : null}
      </h2>
      {scenario.seat_status === "ambiguous_tie" ? (
        <p role="note">Empate ambiguo en la asignación Hare: no se muestran bancas.</p>
      ) : null}
      <div className="table-scroll" role="region" aria-label={`Listas del escenario ${scenario.name}`} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Lista</th>
              <th scope="col">Votos positivos (%)</th>
              <th scope="col">Bancas</th>
            </tr>
          </thead>
          <tbody>
            {scenario.lists.map((row) => (
              <tr key={row.list_id}>
                <th scope="row">{row.label}</th>
                <td>{decimal(row.share_percent)}</td>
                <td>{scenario.seat_status === "allocated" ? row.seats : "—"}</td>
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
        <h1>Escenarios Rosales 2027</h1>
        <p role="alert">{REFUSAL_MESSAGE[result.reason]} No se muestran escenarios.</p>
      </main>
    );
  }
  const { artifact } = result;
  const scenarios = [...artifact.scenarios].sort((a, b) => Number(b.default) - Number(a.default));
  const { backtest } = artifact;
  return (
    <main className="scenarios-page">
      <h1>Escenarios Rosales 2027</h1>
      <p>
        Concejales de {artifact.territory.name}, renovación de {artifact.seats_per_renewal} bancas,
        a partir de los resultados definitivos {artifact.base_year}.
      </p>
      <p role="status" className="scenarios-page__status">
        Transferencias: <strong>{artifact.status.label}</strong>. Son supuestos, no un pronóstico.
      </p>
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
      {scenarios.map((scenario) => (
        <ScenarioSection key={scenario.id} scenario={scenario} />
      ))}
    </main>
  );
}
