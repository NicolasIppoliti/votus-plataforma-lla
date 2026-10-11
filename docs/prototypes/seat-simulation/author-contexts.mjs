import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { allocateSeats } from './kernel.js';

const artifact = new URL('.', import.meta.url);
const repo = '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/';
const references = JSON.parse(await readFile(new URL('../territorial-exploration-prototype/assets/winner-reference-paths.json', artifact)));
const ids = ['a', 'b', 'c', 'd'];
function sample(index, year, category, level) {
  const offset = (year === '2023' ? 1 : 0) + (category === 'senadores-provinciales' ? 2 : 0);
  const weights = [21487 + index * 103, 18491 + index * 71, 6817 + index * 43, 1207 + index * 17];
  const votes = Object.fromEntries(ids.map((id, party) => [id, weights[(party + index + offset) % 4]]));
  const total = Object.values(votes).reduce((sum, n) => sum + n, 0);
  const seatsToFill = (category === 'senadores-provinciales' ? [5, 7, 3, 9] : [9, 7, 11, 5])[index % 4];
  const padron = total + 14891 + index * 241;
  const input = {
    level, isProjection: true, seatsToFill, unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    lists: ids.map(id => ({ listId: id, listName: 'Demonstration ' + id, votes: votes[id] })),
    ...(level === 'national' ? { totalVotes: total, padron, threshold: { value: 3, basis: 'padron' } } : { voteTotals: { kind: 'valid_votes_only', validVotes: total } }),
  };
  const output = allocateSeats(input);
  assert.equal(output.seatAwards.length, seatsToFill);
  assert.equal(output.coverage.complete, true);
  assert.ok(!JSON.stringify(output.seatAwards).includes('simulation_convention'));
  return { status: 'complete', coverage: { reported: 1, total: 1 }, votes, seatsToFill, ...(level === 'national' ? { padron, thresholdPercent: 3 } : {}) };
}
function unit(id, label, index, categories, level, extra = {}) {
  return { id, label, ...extra, samples: Object.fromEntries(['2023', '2025'].map(year => [
    year, Object.fromEntries(categories.map(category => [category, sample(index, year, category, level)])),
  ])) };
}
const nationalCategory = 'diputados-nacionales';
const provincialCategories = ['diputados-provinciales', 'senadores-provinciales'];
const counts = [24, 15, 19, 19, 27, 22, 8, 1];
const fixture = {
  version: 1, sourceKind: 'demonstration', official: false,
  notice: 'Votos, padrón y bancas ficticios. Los años son etiquetas de demostración, no calendarios electorales. No describe una convocatoria real.',
  contexts: {
    argentina: {
      label: 'Argentina', level: 'national',
      categories: [{ id: nationalCategory, label: 'Diputados nacionales' }],
      units: references.provinces.map((ref, index) => unit(ref.id, ref.label, index, [nationalCategory], 'national', { referenceId: ref.id })),
    },
    'buenos-aires': {
      label: 'Buenos Aires', level: 'pba_provincial',
      categories: [{ id: provincialCategories[0], label: 'Diputados provinciales' }, { id: provincialCategories[1], label: 'Senadores provinciales' }],
      units: counts.map((count, index) => unit('legislative-section-' + (index + 1), 'Sección ' + (index + 1), index, provincialCategories, 'pba_provincial', {
        sectionId: String(index + 1), referencePartidoCount: count,
        membershipEvidence: 'Archived national Ambitos metadata 2023/2025; consistent 135 partido memberships. No validated polygon binding.',
      })),
    },
  },
};
assert.equal(fixture.contexts.argentina.units.length, 24);
assert.equal(fixture.contexts['buenos-aires'].units.reduce((sum, u) => sum + u.referencePartidoCount, 0), 135);
await writeFile(new URL('assets/scenario-contexts.json', artifact), JSON.stringify(fixture, null, 2) + '\n');
const facts = [
  { id: 'motor', status: 'available', title: 'Cálculo hipotético disponible',
    detail: 'Votus ya permite escenarios nacionales y provinciales con votos y parámetros ingresados por el usuario. No valida por sí solo la identidad de la elección, categoría y unidad electoral.',
    sources: ['apps/web/src/app/(authenticated)/simulate/simulation-form.tsx', 'apps/web/src/app/(authenticated)/simulate/simulation-form-adapter.ts', 'apps/web/src/app/(authenticated)/simulate/projection-input.ts'] },
  { id: 'historical', status: 'pending', title: 'Base histórica de Simulación pendiente',
    detail: 'La pantalla de Simulación no conecta una carga histórica oficial confiable. Esto no demuestra que falten datos en otras partes de Votus.',
    sources: ['apps/web/src/app/(authenticated)/simulate/page.tsx'] },
  { id: 'source-fields', status: 'pending', title: 'Padrón y sección: existen en origen',
    detail: 'Las fuentes nacionales archivadas incluyen electores y sección provincial. Los modelos normalizados inspeccionados no transportan esos campos como insumos históricos de Simulación. Integración pendiente, no fuente inexistente.',
    sources: ['etl/etl/ingest/national.py', 'etl/etl/jurisdiction.py', 'etl/etl/db.py'] },
  { id: 'pba-coverage', status: 'limited', title: 'Registro PBA acotado a 2 partidos',
    detail: 'El registro y parser PBA 2025 admiten Rosales y Tigre; no representan cobertura provincial completa. Los cuatro PDF de Rosales son referencias archivadas, no resultados ingeridos.',
    sources: ['etl/sources.yaml', 'etl/etl/ingest/pba.py', 'curated/crosswalk.yaml'] },
  { id: 'archive', status: 'snapshot', title: 'Archivo local, no estado de la base alojada',
    detail: 'Se verificaron cuatro ZIP nacionales y las referencias de Rosales. El HTML de Tigre falta en la ruta local registrada pese a un manifiesto ok. No se consultó la base alojada; su cobertura es desconocida.',
    sources: ['archive-manifest.json'] },
  { id: 'parameters', status: 'unverified', title: 'Convocatoria y composición no verificadas',
    detail: 'El padrón, las bancas y los votos de esta ampliación son supuestos ficticios. No validan una renovación de 2027 ni la composición completa de una cámara.',
    sources: ['apps/web/src/app/(authenticated)/simulate/page.tsx'] },
  { id: 'guards', status: 'limited', title: 'Límites de cálculo y visualización',
    detail: 'Sensibilidad: hasta 21 muestras y 600 posiciones (muestras × bancas × listas). Dibujo: hasta 60 bancas y 600 posiciones (bancas × listas); un límite de dibujo no anula un resultado exacto. Empates por convención y mayoría especial no resuelta bloquean esta demostración.',
    sources: ['apps/web/src/app/(authenticated)/simulate/simulation-form-adapter.ts', 'apps/web/src/app/(authenticated)/simulate/page.tsx', 'apps/web/src/domain/seat-allocation/allocate.ts'] },
  { id: 'geography', status: 'prototype', title: 'Límite cartográfico del prototipo',
    detail: 'La referencia real contiene ocho secciones PBA, pero este prototipo no tiene una vinculación validada de polígonos por sección. Muestra el contorno provincial neutral y una selección textual; no inventa geometría. Las referencias nacionales observadas permanecen neutrales.',
    sources: [] },
];
const files = [...new Set(facts.flatMap(f => f.sources))];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(repo + path)).digest('hex')])));
const policy = {
  version: 1, checkedAt: new Date().toISOString(), scope: 'Local code/archive audit; no database/API coverage query',
  officialScenarioVerified: false, liveDatabaseCoverage: 'unknown', facts, sourceHashes,
  legislativeReference: { sections: 8, partidos: 135, counts, years: ['2023', '2025'], conflicts: 0, rosalesSection: '6', tigreSection: '1' },
  citations: [
    { title: 'Código Electoral Nacional', url: 'https://www.argentina.gob.ar/normativa/nacional/ley-19945-19442/actualizacion' },
    { title: 'Ley 5109', url: 'https://normas.gba.gob.ar/documentos/VGW7pIWV.html' },
  ],
};
await writeFile(new URL('assets/capability-policy.json', artifact), JSON.stringify(policy, null, 2) + '\n');
console.log('Validated and authored 80 complete fictional unit/category/year samples; no decisive convention ties. Capability source snapshot: ' + files.length + ' files.');
