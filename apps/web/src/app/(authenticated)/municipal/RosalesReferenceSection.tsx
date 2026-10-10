import type { ReactNode } from "react";
import { TableRegion } from "@/components/TableRegion";
import { Table } from "@/components/ui/table";
import styles from "./municipal.module.css";
import type { RosalesReference, RosalesReferenceRefusal, RosalesReferenceResult } from "@/lib/geography/cne-rosales-reference";

const HEADING_ID = "rosales-reference-heading";

const REFUSALS: Record<RosalesReferenceRefusal, string> = {
  missing: "el archivo de referencia no está disponible.",
  hash_mismatch: "el archivo no coincide con su SHA-256 fijado.",
  invalid_artifact: "el archivo tiene un formato inválido.",
  count_mismatch: "los conteos declarados no coinciden con los circuitos y locales.",
  unknown_circuit: "un local refiere a un circuito que el archivo no contiene.",
  mesa_range_mismatch: "los rangos de mesas no son completos y contiguos.",
};

/**
 * Slice 11 (#399): read-only CNE 2025 reference geography — circuit outlines and
 * voting locations — rendered server-side as an SVG plus a table that carries
 * every locale, including those without coordinates. No votes are shown here.
 */
export function RosalesReferenceSection({ result }: { result: RosalesReferenceResult }): ReactNode {
  return <section className={styles.reference} aria-labelledby={HEADING_ID}>
    <h2 id={HEADING_ID}>Circuitos y locales de votación (referencia CNE 2025)</h2>
    {result.ok ? <RosalesReference reference={result.reference} /> : <p role="alert">No se muestra la referencia CNE: {REFUSALS[result.reason]}</p>}
  </section>;
}

function RosalesReference({ reference }: { reference: RosalesReference }): ReactNode {
  const unplotted = reference.locales.filter((locale) => locale.coordinates === null);
  return <>
    <p role="note">Geografía de referencia CNE; no son resultados oficiales. No válida para elecciones históricas.</p>
    <ul>
      <li>Los circuitos 0248B y 0248C se superponen en el archivo CNE; no se corrige la superposición.</li>
      <li>El archivo CNE ubica locales en el circuito 0248 sin sufijo; no se asignan a subcircuitos.</li>
    </ul>
    <ReferenceMap reference={reference} />
    {unplotted.length > 0 ? <p>Locales sin coordenadas en el archivo CNE (listados, no dibujados): {unplotted.map((locale) => locale.name).join("; ")}.</p> : null}
    <TableRegion label="Tabla de locales de votación CNE 2025">
      <Table className="data-table">
        <caption>Locales de votación CNE 2025 por circuito, con mesas y ubicación</caption>
        <thead>
          <tr>
            <th scope="col">Circuito</th>
            <th scope="col">Local</th>
            <th scope="col">Dirección</th>
            <th scope="col">Localidad</th>
            <th scope="col" className="table-cell--number">Mesas</th>
            <th scope="col">Rango de mesas</th>
            <th scope="col">Ubicación</th>
          </tr>
        </thead>
        <tbody>
          {reference.locales.map((locale) => <tr key={locale.mesa_from}>
            <td>{locale.circuit}</td>
            <th scope="row">{locale.name}</th>
            <td>{locale.address}</td>
            <td>{locale.locality}</td>
            <td className="table-cell--number">{locale.mesa_count}</td>
            <td>{locale.mesa_from}–{locale.mesa_to}</td>
            <td>{locale.coordinates ? "En el mapa" : "Sin coordenadas: no se dibuja"}</td>
          </tr>)}
        </tbody>
      </Table>
    </TableRegion>
    <p>Fuentes archivadas · sha256: {Object.entries(reference.sources).map(([id, source]) => <span key={id}>{id} <code>{source.sha256}</code> </span>)}</p>
  </>;
}

function ReferenceMap({ reference }: { reference: RosalesReference }): ReactNode {
  const points = reference.circuits.flatMap((circuit) => circuit.coordinates.flat(2));
  const west = Math.min(...points.map(([longitude]) => longitude));
  const east = Math.max(...points.map(([longitude]) => longitude));
  const south = Math.min(...points.map(([, latitude]) => latitude));
  const north = Math.max(...points.map(([, latitude]) => latitude));
  // Equirectangular with the mid-latitude scale so shapes are not stretched.
  const xScale = Math.cos(((south + north) / 2) * Math.PI / 180);
  const width = 600;
  const height = Math.round(width * (north - south) / ((east - west) * xScale));
  const x = (longitude: number) => ((longitude - west) / (east - west) * width).toFixed(1);
  const y = (latitude: number) => ((north - latitude) / (north - south) * height).toFixed(1);
  const plotted = reference.locales.filter((locale) => locale.coordinates !== null);
  return <svg viewBox={`-8 -8 ${width + 16} ${height + 16}`} role="img" style={{ maxWidth: "100%", height: "auto" }}
    aria-label={`Mapa de referencia CNE de Coronel Rosales: ${reference.circuits.length} circuitos y ${plotted.length} locales con coordenadas; el detalle completo está en la tabla`}>
    {reference.circuits.map((circuit) => <path key={circuit.code} data-circuit={circuit.code} fill="none" stroke="currentColor" strokeWidth="1" fillRule="evenodd"
      d={circuit.coordinates.flat().map((ring) => ring.map(([longitude, latitude], index) => `${index === 0 ? "M" : "L"}${x(longitude)} ${y(latitude)}`).join(" ") + " Z").join(" ")} />)}
    {plotted.map((locale) => <circle key={locale.mesa_from} cx={x(locale.coordinates![0])} cy={y(locale.coordinates![1])} r="4" fill="var(--official, currentColor)" />)}
  </svg>;
}
