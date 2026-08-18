import type { ReactNode } from "react";
import Link from "next/link";

export default function DashboardPage(): ReactNode {
  return (
    <main className="page-shell">
      <div className="shell-container">
        <header className="page-header">
          <p className="eyebrow">Espacio de evidencia / índice de trabajo</p>
          <h1>Panel de Votus</h1>
          <p className="page-header__lede">
            Pase de la evidencia oficial y pública a la revisión, el análisis y
            la simulación acotada sin perder de vista el estado de las fuentes
            de cada flujo de trabajo.
          </p>
        </header>

        <section
          className="workflow-section"
          aria-labelledby="evidence-workflows"
        >
          <div className="workflow-section__heading">
            <h2 id="evidence-workflows">Evidencia y revisión</h2>
            <p>
              Comience por los flujos que examinan resultados, registran el
              estado de las fuentes o muestran material pendiente antes de
              compartir una interpretación.
            </p>
          </div>
          <ul className="workflow-grid">
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Resultados oficiales</p>
                <h3>Explorar el registro de resultados</h3>
                <p>
                  Examine las filas de resultados oficiales con su granularidad
                  y procedencia, sin reducir la evidencia a una sola cifra
                  destacada.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/drilldown">
                  Explorar resultados
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">
                  Fuente de acceso voluntario
                </p>
                <h3>Examinar registros de fiscalización</h3>
                <p>
                  Revise el material de fiscalización no oficial por separado de
                  las cifras oficiales y mantenga visible el estado de su
                  fuente.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/fiscalizacion">
                  Fiscalización (no oficial)
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">
                  Pendientes para consulta
                </p>
                <h3>Consultar elementos de revisión</h3>
                <p>
                  Inspeccione los elementos pendientes y la evidencia registrada
                  antes de confiar en un resultado o avanzar con una
                  interpretación.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/review">
                  Revisión
                </Link>
              </div>
            </li>
            <li className="workflow-card">
              <div className="workflow-card__body">
                <p className="workflow-card__status">Supuestos del modelo</p>
                <h3>Probar proyecciones de bancas</h3>
                <p>
                  Ejecute una simulación acotada de bancas y mantenga los
                  supuestos y las proyecciones no oficiales separados de los
                  resultados observados.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/simulate">
                  Simulación de bancas
                </Link>
              </div>
            </li>
          </ul>
        </section>

        <section
          className="workflow-section"
          aria-labelledby="prepared-workflows"
        >
          <div className="workflow-section__heading">
            <h2 id="prepared-workflows">Rutas de análisis especializadas</h2>
            <p>
              Inicie una comparación nacional desde sus selectores o abra los
              análisis que requieren un contexto jurisdiccional preparado.
            </p>
          </div>
          <ul className="workflow-grid">
            <li className="workflow-card workflow-card--prepared">
              <div className="workflow-card__body">
                <p className="workflow-card__status">
                  Selección nacional disponible
                </p>
                <h3>Comparar resultados electorales</h3>
                <p>
                  Elija elecciones nacionales de 2023 y 2025 y compare una
                  categoría publicada en ambas mediante un enlace reutilizable.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/compare">
                  Comparar resultados electorales
                </Link>
              </div>
            </li>
            <li className="workflow-card workflow-card--prepared">
              <div className="workflow-card__body">
                <p className="workflow-card__status">
                  Se requiere un contexto preparado
                </p>
                <h3>Analizar concejos municipales</h3>
                <p>
                  Abra el análisis municipal desde un contexto jurisdiccional
                  preparado o mediante un enlace directo. Esta tarjeta no inicia
                  un flujo de selección de datos sin contexto previo.
                </p>
              </div>
              <div className="workflow-card__footer">
                <Link className="text-link" href="/municipal">
                  Análisis de concejos municipales
                </Link>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
