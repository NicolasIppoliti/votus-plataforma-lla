import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const repo = '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/';
const original = new URL('../territorial-exploration-prototype/assets/', root);
const fixtureBytes = await readFile(new URL('demo-results.json', original));
const fixture = JSON.parse(fixtureBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(fixtureBytes), 'cf2c1db19469ddf04a12e3ab7cd2eaec954c0290421ada254b8f81eace84040f');
const coverageUnits = {
  argentina: { label: 'provincias/CABA de demostración', kind: 'authored_province_aggregates' },
  'buenos-aires': { label: 'partidos de demostración', kind: 'authored_partido_aggregates' },
  rosales: { label: 'circuitos de demostración', kind: 'authored_circuits' },
};
for (const [id, node] of Object.entries(fixture.nodes)) {
  if (!node.fictional) continue;
  const label = node.level === 'circuit' ? 'establecimientos de demostración'
    : node.level === 'school' ? 'mesas de demostración' : 'registros de demostración';
  coverageUnits[id] = { label, kind: 'authored_' + node.level + '_reference_units' };
}
for (const [id] of Object.entries(coverageUnits)) {
  for (const year of ['2023', '2025']) for (const category of ['concejales', 'national-deputies']) {
    const record = fixture.results[year][category][id];
    assert.ok(record && Number.isSafeInteger(record.coverage.reported) && Number.isSafeInteger(record.coverage.total));
  }
}
const facts = [
  { id: 'official-denominator', title: 'Resultados oficiales: falta el denominador esperado',
    detail: 'El contrato oficial informa mesas presentes y filas/votos de origen, pero no cuántas mesas deberían existir para esta selección. Eso no permite calcular un porcentaje de cobertura oficial.',
    sources: ['apps/web/src/lib/results/exploration-contract.ts'] },
  { id: 'internal-source', title: 'Fiscalización separada y opt-in',
    detail: 'La cobertura interna tiene unidades observadas y un denominador, pero no es una muestra aleatoria. No debe combinarse con resultados oficiales; la cobertura y los votos son datos distintos.',
    sources: ['apps/web/src/lib/workspace/context.ts', 'apps/web/src/app/(authenticated)/fiscalizacion/page.tsx'] },
  { id: 'provenance', title: 'Trazabilidad autorizada, sin rutas ni notas libres',
    detail: 'La evidencia oficial permite identificador de archivo, capacidad, MIME, tamaño, fecha, estado y SHA. Un SHA registrado no prueba que el archivo haya sido verificado. No se exponen rutas, URL de origen, notas ni datos personales.',
    sources: ['apps/web/src/lib/workspace/official-drilldown-evidence.ts'] },
  { id: 'review', title: 'Revisión de lectura, no resolución',
    detail: 'La cola existente es paginada y de solo lectura: tipo, severidad y fecha. Su contrato no ofrece descripción territorial ni una acción para resolver observaciones.',
    sources: ['apps/web/src/app/(authenticated)/review/page.tsx', 'apps/web/src/lib/workspace/review-items.ts'] },
  { id: 'query-status', title: 'Desconocido no significa vacío',
    detail: 'Consulta vacía, acceso no autorizado, evidencia no disponible y respuesta no válida son estados diferentes. En esta maqueta no se consultó la base alojada ni se verificaron los permisos de la organización.',
    sources: ['apps/web/src/components/EvidenceState.tsx', 'apps/web/src/lib/workspace/official-drilldown-evidence.ts'] },
  { id: 'snapshot', title: 'Fuentes y archivos no certifican cobertura alojada',
    detail: 'La revisión local anterior comprobó fuentes nacionales archivadas y un registro HTML PBA 2025 acotado a Rosales/Tigre, no la cobertura completa de la base alojada. La identidad provincial y el padrón existen en origen, pero no son insumos históricos conectados a Simulación.',
    sources: ['etl/sources.yaml', 'etl/etl/ingest/national.py', 'etl/etl/ingest/pba.py', 'etl/etl/jurisdiction.py', 'etl/etl/db.py'] },
];
const paths = [...new Set(facts.flatMap(fact => fact.sources))];
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(repo + path))])));
const priorPolicy = JSON.parse(await readFile(new URL('../seat-simulation-prototype/assets/capability-policy.json', root)));
const policy = {
  version: 1, checkedAt: new Date().toISOString(), sourceKind: 'local-code-snapshot',
  liveDatabaseQueried: false, organizationPermissionsVerified: false,
  liveCoverage: 'unknown', officialExpectedMesaDenominator: null,
  defaultSelection: { mode: 'demonstration', nodeId: 'rosales', year: '2025', category: 'concejales', sourceKind: 'official' },
  demonstration: {
    notice: 'Muestra de diseño: resultados y cobertura ficticios. No describe la ingesta ni la cobertura oficial.',
    fingerprint: digest(fixtureBytes), coverageUnits,
    untypedCoverageNotice: 'Tipo de unidad no documentado en esta muestra; no se calcula un porcentaje.',
    nationalAggregateNotice: 'El agregado nacional es una muestra independiente, no la suma de los resultados visibles por provincia.',
  },
  consultationCases: [
    { id: 'normal', label: 'Muestra cargada', presentationState: 'normal' },
    { id: 'empty', label: 'Consulta vacía · caso de diseño', presentationState: 'empty' },
    { id: 'denied', label: 'Acceso no autorizado · caso de diseño', presentationState: 'denied' },
    { id: 'unavailable', label: 'No disponible · caso de diseño', presentationState: 'unavailable' },
    { id: 'truncated', label: 'Respuesta fuera de límite · caso de diseño', presentationState: 'truncated' },
    { id: 'malformed', label: 'Respuesta no válida · caso de diseño', presentationState: 'error' },
  ],
  safeProvenanceFields: ['archiveEntryId', 'capability', 'mime', 'bytes', 'fetchedAt', 'status', 'sha256'],
  forbiddenProvenanceFields: ['source', 'source_url', 'sourceUrl', 'archived_path', 'archivedPath', 'notes', 'url', 'path'],
  facts, sourceHashes, priorArchiveSnapshotAt: priorPolicy.checkedAt,
  prototypeLimits: [
    'No live database/API, authentication or official territorial-coverage query.',
    'No official archive reference bound to the fictional result fixture.',
    'Deep fictional units lack their own locations; use neutral Rosales ancestor.',
    'Geometry validity is a source diagnostic, not a historical electoral crosswalk.',
    'Displayed child rows/filter counts are not a coverage denominator.',
  ],
};
await writeFile(new URL('assets/evidence-policy.json', root), JSON.stringify(policy, null, 2) + '\n');
const immutable = JSON.parse(await readFile(new URL('../seat-simulation-prototype/checks/frozen-inputs.json', root)));
const finalSimulation = JSON.parse(await readFile(new URL('../seat-simulation-prototype/checks/scales-final-frozen-candidate.json', root)));
for (const [path, hash] of Object.entries(finalSimulation)) {
  immutable[new URL('../seat-simulation-prototype/' + path, root).pathname] = hash;
}
for (const [path, hash] of Object.entries(sourceHashes)) immutable[repo + path] = hash;
immutable[new URL('assets/evidence-policy.json', root).pathname] = digest(await readFile(new URL('assets/evidence-policy.json', root)));
for (const sibling of ['territorial-exploration-prototype', 'temporal-comparison-prototype']) {
  for (const file of ['index.html', 'prototype.js', 'prototype.css']) {
    const path = new URL('../' + sibling + '/' + file, root).pathname;
    try { immutable[path] = digest(await readFile(path)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
await writeFile(new URL('checks/immutable-inputs.json', root), JSON.stringify(immutable, null, 2) + '\n');
console.log('PASS: authored explicit denominator units,6 verified-code facts, no fictitious official provenance; pinned ' + Object.keys(immutable).length + ' inputs/source files');
