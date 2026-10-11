// The design fixture is never treated as a hosted or official coverage query.
export const PARTIES = Object.freeze(['a', 'b', 'c', 'd']);
export const STATE_LABELS = Object.freeze({
  complete: 'Completa en la muestra', partial: 'Parcial en la muestra',
  missing: 'Sin datos en la muestra', unknown: 'Cobertura desconocida',
  unavailable: 'Evidencia no disponible', empty: 'Consulta vacía',
  denied: 'Consulta no autorizada', truncated: 'Respuesta fuera de límite',
  error: 'Respuesta no válida', loading: 'Cargando evidencia'
});
const UNIT_KINDS = new Set([
  'authored_province_aggregates', 'authored_partido_aggregates', 'authored_circuits',
  'authored_mesa_reference_units', 'authored_school_reference_units', 'authored_circuit_reference_units'
]);
const FACT_IDS = ['official-denominator', 'internal-source', 'provenance', 'review', 'query-status', 'snapshot'];
const CASE_IDS = ['normal', 'empty', 'denied', 'unavailable', 'truncated', 'malformed'];
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 2400;
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const validPath = value => typeof value === 'string' && value.length > 0 && /^[MLZmlz0-9.,eE+\-\s]+$/.test(value);
const fail = () => { throw new Error('Invalid design evidence'); };

export function classifyRecord(record) {
  if (!record || !['complete', 'partial', 'missing'].includes(record.status)) fail();
  const coverage = record.coverage;
  if (!coverage || !safeInteger(coverage.reported) || !safeInteger(coverage.total)
      || coverage.total < 1 || coverage.reported > coverage.total) fail();
  if (record.status === 'missing') {
    if (record.votes !== null || coverage.reported !== 0) fail();
    return { state: 'missing', totalVotes: null, coverage };
  }
  if (!record.votes || typeof record.votes !== 'object' || Array.isArray(record.votes)
      || Object.keys(record.votes).sort().join(',') !== PARTIES.join(',')) fail();
  if (PARTIES.some(id => !safeInteger(record.votes[id]))) fail();
  const totalVotes = PARTIES.reduce((sum, id) => sum + record.votes[id], 0);
  if (!safeInteger(totalVotes) || coverage.reported === 0) fail();
  if (record.status === 'complete' && coverage.reported !== coverage.total) fail();
  if (record.status === 'partial' && coverage.reported >= coverage.total) fail();
  return { state: record.status, totalVotes, coverage };
}

export function validateAssets(policy, fixture, references, geography) {
  if (!policy || policy.version !== 1 || policy.sourceKind !== 'local-code-snapshot'
      || policy.liveDatabaseQueried !== false || policy.organizationPermissionsVerified !== false
      || policy.liveCoverage !== 'unknown' || policy.officialExpectedMesaDenominator !== null
      || !Number.isFinite(Date.parse(policy.checkedAt))) fail();
  const demo = policy.demonstration;
  if (!demo || !validText(demo.notice) || !/^[a-f0-9]{64}$/.test(demo.fingerprint)
      || !validText(demo.untypedCoverageNotice) || !validText(demo.nationalAggregateNotice)) fail();
  if (!Array.isArray(policy.facts) || policy.facts.length !== FACT_IDS.length
      || policy.facts.map(fact => fact.id).join(',') !== FACT_IDS.join(',')
      || policy.facts.some(fact => !validText(fact.title) || !validText(fact.detail))) fail();
  if (!Array.isArray(policy.consultationCases)
      || policy.consultationCases.map(item => item.id).join(',') !== CASE_IDS.join(',')
      || policy.consultationCases.some(item => !validText(item.label)
        || item.presentationState !== (item.id === 'malformed' ? 'error' : item.id))) fail();
  if (!fixture?.nodes || !fixture.results || fixture.source?.kind !== 'demonstration'
      || fixture.source.official !== false || fixture.source.personalData !== false) fail();
  const nodes = fixture.nodes;
  for (const root of ['argentina', 'buenos-aires', 'rosales']) {
    if (!nodes[root] || !validPath(references?.[root]?.path)) fail();
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (!validText(node.label) || !['country', 'province', 'partido', 'circuit', 'school', 'mesa'].includes(node.level)
        || !Array.isArray(node.childIds) || new Set(node.childIds).size !== node.childIds.length
        || node.childIds.some(child => !nodes[child] || nodes[child].parentId !== id)
        || (node.parentId !== null && !nodes[node.parentId])) fail();
    let parent = node.parentId;
    const seen = new Set([id]);
    while (parent !== null) {
      if (seen.has(parent) || !nodes[parent]) fail();
      seen.add(parent);
      parent = nodes[parent].parentId;
    }
  }
  if (!demo.coverageUnits || typeof demo.coverageUnits !== 'object') fail();
  for (const [id, unit] of Object.entries(demo.coverageUnits)) {
    if (!nodes[id] || !validText(unit.label) || !UNIT_KINDS.has(unit.kind)) fail();
  }
  for (const year of ['2023', '2025']) {
    for (const category of ['concejales', 'national-deputies']) {
      const records = fixture.results[year]?.[category];
      if (!records || Object.keys(records).length !== Object.keys(nodes).length
          || Object.keys(records).some(id => !nodes[id])) fail();
      for (const id of Object.keys(nodes)) classifyRecord(records[id]);
    }
  }
  if (!geography || !Array.isArray(geography.provinces) || !Array.isArray(geography.partidos)
      || !geography.scopePaths || geography.provinces.length !== nodes.argentina.childIds.length
      || geography.partidos.length !== nodes['buenos-aires'].childIds.length) fail();
  for (const [key, root] of [['provinces', 'argentina'], ['partidos', 'buenos-aires']]) {
    const seen = new Set();
    for (const shape of geography[key]) {
      if (!nodes[root].childIds.includes(shape.id) || seen.has(shape.id)
          || typeof shape.geometryValid !== 'boolean' || !validPath(shape.path)
          || !validPath(geography.scopePaths[shape.id])) fail();
      seen.add(shape.id);
    }
  }
  if (references.argentina.polarPath && !validPath(references.argentina.polarPath)) fail();
  return { policy, fixture, references, geography };
}

export function sampleEvidence(assets, nodeId, year, category) {
  const result = classifyRecord(assets.fixture.results[year]?.[category]?.[nodeId]);
  const node = assets.fixture.nodes[nodeId];
  const declaredUnit = assets.policy.demonstration.coverageUnits[nodeId];
  const expectedKinds = {
    country: 'authored_province_aggregates', province: 'authored_partido_aggregates',
    partido: 'authored_circuits', circuit: 'authored_circuit_reference_units',
    school: 'authored_school_reference_units', mesa: 'authored_mesa_reference_units'
  };
  const structuralTotal = node.level === 'mesa' ? 1 : node.childIds.length;
  // A typed territory cannot confer its unit on a generic missing-record 0/1.
  const unit = declaredUnit?.kind === expectedKinds[node.level]
    && result.coverage.total === structuralTotal ? declaredUnit : null;
  const percent = unit && result.coverage.total > 0
    ? 100 * result.coverage.reported / result.coverage.total : null;
  return { ...result, unit: unit?.label ?? 'Unidades no tipificadas de demostración', percent };
}

export function geometryFor(assets, nodeId) {
  const node = assets.fixture.nodes[nodeId];
  const referenceScope = node.ownLocation === false ? node.referenceScope : nodeId;
  const shape = [...assets.geography.provinces, ...assets.geography.partidos]
    .find(item => item.id === referenceScope);
  const path = referenceScope === 'argentina' ? assets.references.argentina.path
    : assets.geography.scopePaths[referenceScope];
  if (!validPath(path)) fail();
  return {
    scope: referenceScope, path,
    state: node.ownLocation === false ? 'ancestor' : shape?.geometryValid === false ? 'observed' : 'valid',
    ownLocation: node.ownLocation !== false
  };
}

export function sampleReading(assets, nodeId, year, category) {
  const sample = sampleEvidence(assets, nodeId, year, category);
  const geometry = geometryFor(assets, nodeId);
  let canInterpret = 'La distribución de votos ficticios de esta selección.';
  let impact = 'Comparación y Simulación requieren bases compatibles y verificadas; esas condiciones no están acreditadas aquí.';
  if (sample.state === 'missing') {
    canInterpret = 'La ausencia de un vector de votos en la muestra, no un resultado de cero votos.';
    impact = 'Sin vector de votos, no hay base electoral para Comparación o Simulación.';
  } else if (sample.state === 'partial') {
    canInterpret = 'Solo los votos presentes en la muestra parcial, no los de las unidades faltantes.';
    impact = 'El alcance parcial limita Comparación y Simulación; las bases compatibles y oficiales no están verificadas.';
  } else if (sample.totalVotes === 0) {
    canInterpret = 'Un vector válido de cero votos ficticios; cero no significa ausencia de datos.';
  }
  if (nodeId === 'argentina') impact += ' El agregado nacional es independiente, no la suma de las provincias visibles.';
  if (geometry.state === 'ancestor') impact += ' Sin ubicación propia: solo hay una referencia neutral de Rosales.';
  else if (geometry.state === 'observed') impact += ' La geometría observada queda como referencia neutral; no cambia el estado de los votos.';
  return {
    canInterpret,
    cannotClaim: 'Resultados oficiales, cobertura alojada ni equivalencia electoral histórica.'
      + (sample.percent === null ? ' Tampoco un porcentaje sin unidad tipificada.' : ''),
    originReason: sample.state === 'complete' ? 'Sin faltantes electorales declarados en esta muestra'
      : 'Motivo de origen no informado',
    impact
  };
}

export function ancestors(assets, nodeId) {
  const chain = [];
  let current = nodeId;
  while (current !== null) {
    chain.unshift(current);
    current = assets.fixture.nodes[current].parentId;
  }
  return chain;
}
