// Deterministic fictional examples. Geographic IDs identify prototype references, not official electoral joins.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = fileURLToPath(new URL('./assets/', import.meta.url));
const geography = JSON.parse(await readFile(assets + 'winner-reference-paths.json', 'utf8'));
if (geography.provinces.length !== 24 || geography.partidos.length !== 135) throw new Error('Expected complete prototype reference inventory');
const nodes = {};
function node(id, label, level, parentId, childIds = [], extra = {}) {
  nodes[id] = { label, level, parentId, childIds, childrenCoverage: { kind: 'demonstration', reported: childIds.length, total: childIds.length }, ...extra };
}
node('argentina', 'Argentina', 'country', null, geography.provinces.map(item => item.id));
for (const item of geography.provinces) node(item.id, item.label, 'province', 'argentina', item.id === 'buenos-aires' ? geography.partidos.map(child => child.id) : [], { referenceId: item.id, referenceOnly: true, sourceName: item.sourceName });
for (const item of geography.partidos) node(item.id, item.label, 'partido', 'buenos-aires', [], { referenceId: item.id, referenceOnly: true, sourceName: item.sourceName });
const tableIds = [];
for (let circuit = 1; circuit <= 2; circuit++) {
  const circuitId = `demo-circuit-${String(circuit).padStart(2, '0')}`;
  const circuitLetter = String.fromCharCode(64 + circuit);
  const schoolIds = [];
  for (let school = 1; school <= 2; school++) {
    const schoolId = `demo-school-${String(circuit).padStart(2, '0')}-${String(school).padStart(2, '0')}`;
    const children = [];
    for (let table = 1; table <= 2; table++) {
      const id = `demo-table-${String(circuit).padStart(2, '0')}-${String(school).padStart(2, '0')}-${String(table).padStart(2, '0')}`;
      node(id, `Mesa de demostración ${circuitLetter}${school}-${table}`, 'mesa', schoolId, [], { fictional: true, referenceScope: 'rosales', ownLocation: false });
      children.push(id);
      tableIds.push(id);
    }
    node(schoolId, `Establecimiento de demostración ${circuitLetter}${school}`, 'school', circuitId, children, { fictional: true, referenceScope: 'rosales', ownLocation: false });
    schoolIds.push(schoolId);
  }
  node(circuitId, `Circuito de demostración ${circuitLetter}`, 'circuit', 'rosales', schoolIds, { fictional: true, referenceScope: 'rosales', ownLocation: false });
  nodes.rosales.childIds.push(circuitId);
}
nodes.rosales.childrenCoverage = { kind: 'demonstration', reported: 2, total: 2 };
nodes.argentina.childrenCoverage = { kind: 'demonstration', reported: 23, complete: 22, total: 24 };
const parties = ['a', 'b', 'c', 'd'];
// Authored design samples in tableIds order, not an allocation inferred from an official source.
const councilTableVotes = {
  '2025': [
    [3100, 2100, 700, 200], [2600, 2450, 900, 260],
    [2800, 2300, 850, 230], [2350, 2600, 1000, 300],
    [3000, 2000, 800, 240], [2200, 2700, 1000, 300],
    [2600, 2300, 900, 280], [2832, 2286, 774, 348],
  ],
  '2023': [
    [2400, 2700, 600, 300], [2600, 2500, 750, 330],
    [2300, 2800, 650, 290], [2500, 2600, 800, 350],
    [2200, 2900, 700, 310], [2700, 2300, 800, 380],
    [2400, 2700, 650, 330], [2440, 2430, 740, 350],
  ],
};
const missing = () => ({ status: 'missing', votes: null, coverage: { reported: 0, total: 1 }, aggregation: 'aggregate' });
function aggregate(votes, status = 'complete', reported = 1, total = 1) {
  return { status, votes, coverage: { reported, total }, aggregation: 'aggregate' };
}
function rotatedVotes(index, year, factor = 1) {
  const base = [90 + index * 2, 70 + index, 25 + index, 8 + index * 2].map(value => value * factor);
  const rotation = (index + (year === '2023' ? 1 : 0)) % 4;
  return Object.fromEntries(parties.map((id, position) => [id, base[(position + rotation) % 4]]));
}
function fromChildren(id, entries) {
  const childIds = nodes[id].childIds;
  if (!childIds.length || childIds.some(child => entries[child]?.status !== 'complete')) throw new Error('Incomplete partition cannot be declared complete');
  const votes = Object.fromEntries(parties.map(party => [party, childIds.reduce((sum, child) => sum + entries[child].votes[party], 0)]));
  return { status: 'complete', votes, coverage: { reported: childIds.length, total: childIds.length }, aggregation: 'children' };
}
const results = {};
for (const year of ['2025', '2023']) {
  const national = {};
  tableIds.forEach((id, index) => { national[id] = aggregate(rotatedVotes(index, year)); });
  for (const level of ['school', 'circuit']) for (const [id, item] of Object.entries(nodes)) if (item.level === level) national[id] = fromChildren(id, national);
  national.rosales = fromChildren('rosales', national);
  geography.partidos.forEach((item, index) => { if (item.id !== 'rosales') national[item.id] = aggregate(rotatedVotes(index + 2, year, 70)); });
  national['buenos-aires'] = fromChildren('buenos-aires', national);
  geography.provinces.forEach((item, index) => { if (item.id !== 'buenos-aires') national[item.id] = aggregate(rotatedVotes(index + 6, year, 1200)); });
  national['province-catamarca'] = aggregate({ a: 45000, b: 45000, c: 12000, d: 4000 });
  national['province-chaco'] = missing();
  national['province-chubut'] = aggregate({ a: year === '2025' ? 64000 : 60000, b: 48000, c: 18000, d: 9000 }, 'partial', 7, 10);
  national['province-ciudad-autonoma-de-buenos-aires'] = aggregate({ a: 0, b: 0, c: 0, d: 0 });
  national.argentina = aggregate(year === '2025' ? { a: 9000000, b: 7600000, c: 5800000, d: 5000000 } : { a: 8700000, b: 8100000, c: 6100000, d: 5100000 }, 'partial', 23, 24);
  national.argentina.note = 'Agregado ficticio con desglose incompleto; no es la suma de las provincias mostradas.';
  const council = Object.fromEntries(Object.keys(nodes).map(id => [id, missing()]));
  tableIds.forEach((id, index) => {
    council[id] = aggregate(Object.fromEntries(parties.map((party, position) => [party, councilTableVotes[year][index][position]])));
  });
  for (const level of ['school', 'circuit']) for (const [id, item] of Object.entries(nodes)) if (item.level === level) council[id] = fromChildren(id, council);
  council.rosales = fromChildren('rosales', council);
  council.rosales.note = 'Partición de ocho mesas ficticias creada para revisar el diseño; no procede de una distribución oficial.';
  results[year] = { 'national-deputies': national, concejales: council };
}
// Independent aggregate examples must contain their known child contributions; missing detail stays missing.
for (const [year, categories] of Object.entries(results)) {
  for (const [category, entries] of Object.entries(categories)) {
    for (const [id, entry] of Object.entries(entries)) {
      if (!entry.votes || entry.aggregation !== 'aggregate' || !nodes[id].childIds.length) continue;
      for (const party of parties) {
        const known = nodes[id].childIds.reduce((sum, child) => sum + (entries[child]?.votes?.[party] ?? 0), 0);
        if (known > entry.votes[party]) throw new Error('Known child votes exceed independent aggregate: ' + year + '/' + category + '/' + id + '/' + party);
      }
    }
  }
}
const fixture = {
  source: { kind: 'demonstration', official: false, personalData: false, seed: 'territorial-winner-v1', notes: 'All results, coverage and deep units are fictional. Council mesa vectors are authored design samples, not a source-derived allocation. Source geography is not an official electoral crosswalk.' },
  nodes, results,
};
await writeFile(assets + 'demo-results.json', JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ nodes: Object.keys(nodes).length, provinces: nodes.argentina.childIds.length, partidos: nodes['buenos-aires'].childIds.length, fictionalTables: tableIds.length, councilAggregation: results['2025'].concejales.rosales.aggregation }, null, 2));
