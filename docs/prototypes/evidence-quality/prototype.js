import { STATE_LABELS, validateAssets, sampleEvidence, geometryFor, sampleReading, ancestors } from './evidence-model.js';

const element = id => document.getElementById(id);
const numbers = new Intl.NumberFormat('es-AR');
const percentages = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const state = {
  assets: null, loadState: 'loading', request: 0, mode: 'demonstration',
  nodeId: 'rosales', year: '2025', category: 'concejales', sourceKind: 'official',
  consultationCase: 'normal', search: '', availability: 'all'
};
const dialogOpeners = new Map();
const geometryLabels = {
  valid: 'Válida como referencia', observed: 'Observada en origen',
  ancestor: 'Sin ubicación propia · referencia de Rosales'
};
const caseExplanations = {
  empty: 'La consulta de diseño no devuelve registros. No equivale a votos cero ni a cobertura faltante en un territorio.',
  denied: 'La consulta de diseño simula falta de autorización. No se verificaron los permisos del usuario actual.',
  unavailable: 'La consulta de diseño simula evidencia no disponible. No se muestran cifras anteriores.',
  truncated: 'La consulta de diseño supera el límite de respuesta. No se presenta un subconjunto como completo.',
  error: 'La consulta de diseño no cumple el contrato. No se seleccionan ni se suman registros no válidos.'
};

function text(id, content) { element(id).textContent = content; }
function make(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function currentPresentation() {
  if (state.loadState !== 'ready') return state.loadState;
  if (state.consultationCase !== 'normal') {
    return state.assets.policy.consultationCases.find(item => item.id === state.consultationCase).presentationState;
  }
  if (state.sourceKind === 'internal') return 'unavailable';
  if (state.mode === 'verified') return 'unknown';
  return sampleEvidence(state.assets, state.nodeId, state.year, state.category).state;
}
function isSampleVisible() {
  return state.loadState === 'ready' && state.consultationCase === 'normal'
    && state.sourceKind === 'official' && state.mode === 'demonstration';
}
function clearProvenance() {
  const dialog = element('provenance-dialog');
  if (dialog.open) dialog.close();
  element('provenance-content').replaceChildren();
}
function resetTableFilters() {
  state.search = '';
  state.availability = 'all';
  element('territory-search').value = '';
  element('availability-filter').value = 'all';
}
function selectTerritory(nodeId) {
  if (!state.assets.fixture.nodes[nodeId]) return;
  state.nodeId = nodeId;
  resetTableFilters();
  render();
  element('selected-heading').focus();
}

function renderControls() {
  const ready = state.loadState === 'ready';
  const sample = isSampleVisible();
  for (const id of ['evidence-mode', 'territory', 'source-kind', 'consultation-case']) element(id).disabled = !ready;
  for (const id of ['base-year', 'category', 'territory-search', 'availability-filter']) element(id).disabled = !sample;
  element('retry').hidden = !['unavailable', 'error'].includes(state.loadState);
  element('provenance-open').disabled = !sample;
  element('provenance-quick').disabled = !sample;
  element('evidence-mode').value = state.mode;
  element('base-year').value = state.year;
  element('category').value = state.category;
  element('source-kind').value = state.sourceKind;
  if (ready) {
    const roots = ['argentina', 'buenos-aires', 'rosales'];
    const node = state.assets.fixture.nodes[state.nodeId];
    const options = roots.map(id => {
      const option = make('option', state.assets.fixture.nodes[id].label);
      option.value = id;
      return option;
    });
    if (!roots.includes(state.nodeId)) {
      const option = make('option', node.label);
      option.value = state.nodeId;
      options.push(option);
    }
    element('territory').replaceChildren(...options);
    element('territory').value = state.nodeId;
  }
}

function renderScope(presentation) {
  const ready = state.loadState === 'ready';
  let notice = 'Cargando archivos locales. Todavía no hay cifras disponibles.';
  if (state.loadState === 'unavailable') notice = 'No se pudo cargar la evidencia local. No hay cifras disponibles; se puede reintentar la carga.';
  if (state.loadState === 'error') notice = 'Los archivos locales no cumplen el contrato de la muestra. No se muestran cifras ni trazabilidad.';
  if (ready) {
    notice = state.mode === 'demonstration' ? state.assets.policy.demonstration.notice
      : 'Revisión fechada del código local, no una consulta de la base alojada. Cobertura territorial y permisos actuales desconocidos.';
    if (state.sourceKind === 'internal') notice = 'Fiscalización interna seleccionada por opt-in. Sin muestra interna disponible; cobertura desconocida. No se combina con datos oficiales y no es una muestra aleatoria.';
  }
  text('scope-notice', notice);
  element('scope-notice').dataset.view = state.mode;
  const caseActive = ready && state.consultationCase !== 'normal';
  element('case-notice').hidden = !caseActive;
  text('case-notice', caseActive ? `Caso de diseño: ${STATE_LABELS[presentation]}. ${caseExplanations[presentation]}` : '');
}

function renderSummary(presentation) {
  text('evidence-status', STATE_LABELS[presentation]);
  element('evidence-status').dataset.state = presentation;
  for (const id of ['coverage-ratio', 'coverage-percent', 'positive-votes']) text(id, '—');
  text('coverage-unit', 'Unidad y denominador sin confirmar');
  text('coverage-reason', 'No se calcula un porcentaje sin una unidad y un denominador confirmados.');
  let explanation = caseExplanations[presentation] ?? 'No hay cifras disponibles para esta consulta.';
  if (state.loadState === 'loading') explanation = 'No se muestran cifras hasta validar los archivos locales.';
  else if (state.loadState === 'error') explanation = 'La muestra no cumple el contrato. No se omiten ni se eligen registros para continuar.';
  else if (state.loadState === 'unavailable') explanation = 'No se pudo cargar la evidencia local. Reintentar no consulta una base remota.';
  else if (state.consultationCase === 'normal' && state.sourceKind === 'internal') {
    explanation = 'La cobertura interna no está disponible en este prototipo. No implica denegación de acceso al usuario actual.';
  } else if (presentation === 'unknown') {
    explanation = 'Las capacidades están verificadas en código; la cobertura de resultados alojados no fue consultada.';
    text('coverage-unit', 'Cobertura oficial desconocida');
    text('coverage-reason', 'El contrato oficial no informa el denominador esperado de mesas. Una fuente archivada no certifica cobertura alojada.');
  } else if (isSampleVisible()) {
    const sample = sampleEvidence(state.assets, state.nodeId, state.year, state.category);
    text('coverage-ratio', `${numbers.format(sample.coverage.reported)}/${numbers.format(sample.coverage.total)}`);
    text('coverage-unit', sample.unit);
    text('coverage-percent', sample.percent === null ? '—' : `${percentages.format(sample.percent)}%`);
    text('positive-votes', sample.totalVotes === null ? '—' : numbers.format(sample.totalVotes));
    text('coverage-reason', sample.percent === null ? state.assets.policy.demonstration.untypedCoverageNotice
      : 'Relación de unidades ficticias de esta muestra. No es cobertura oficial ni porcentaje de mesas esperadas.');
    explanation = sample.state === 'missing' ? 'No hay vector de votos para esta selección en la muestra; no se reemplaza por cero.'
      : sample.totalVotes === 0 ? 'Un vector válido de votos cero. La muestra está completa; cero no significa dato faltante.'
      : sample.state === 'partial' ? 'La muestra declara unidades faltantes. Los votos presentes no describen lo que falta.'
      : 'La muestra declara todas sus unidades presentes. Esto no certifica una ingesta ni cobertura oficial.';
    if (state.nodeId === 'argentina') explanation += ` ${state.assets.policy.demonstration.nationalAggregateNotice}`;
  }
  text('status-explanation', explanation);
  text('provenance-summary', isSampleVisible()
    ? 'Muestra ficticia sin identificador de archivo, fecha ni SHA oficiales.'
    : 'Sin evidencia de resultados vinculada a esta consulta. No se conserva trazabilidad de una selección anterior.');
}

function renderReading(presentation) {
  text('reading-scope', state.assets ? state.assets.fixture.nodes[state.nodeId].label : 'Sin selección validada');
  let reading;
  if (state.loadState !== 'ready') {
    reading = {
      canInterpret: state.loadState === 'loading' ? 'El estado de carga local; todavía no hay evidencia validada.'
        : 'El estado de la carga local, sin resultados de una selección anterior.',
      cannotClaim: 'Resultados, cobertura ni condiciones para usar una base electoral.',
      originReason: state.loadState === 'loading' ? 'Validación local pendiente'
        : state.loadState === 'error' ? 'Archivo local no válido; no identifica una causa electoral'
          : 'Carga local no disponible; no identifica una causa electoral',
      impact: 'No hay evidencia validada para Comparación o Simulación.'
    };
  } else if (state.consultationCase !== 'normal') {
    reading = {
      canInterpret: `Un caso de diseño simulado: ${STATE_LABELS[presentation].toLowerCase()}.`,
      cannotClaim: 'Que este caso describa los permisos actuales, una falla real o la cobertura electoral.',
      originReason: 'Caso de diseño simulado; no informa una causa de origen real',
      impact: 'Este caso no aporta una base de resultados para Comparación o Simulación.'
    };
  } else if (state.sourceKind === 'internal') {
    reading = {
      canInterpret: 'La selección interna explícita; sin muestra de fiscalización disponible aquí.',
      cannotClaim: 'Cobertura interna, votos combinados con oficiales ni denegación de acceso al usuario actual.',
      originReason: 'Sin muestra interna; no se consultaron cobertura ni permisos',
      impact: 'Fiscalización no es una muestra aleatoria y no se combina con resultados oficiales en Comparación o Simulación.'
    };
  } else if (state.mode === 'verified') {
    reading = {
      canInterpret: 'Las capacidades verificadas en el código local, como una revisión fechada.',
      cannotClaim: 'Cobertura de la base alojada ni permisos de la organización; permanecen desconocidos.',
      originReason: 'Base alojada y permisos no consultados; no hay diagnóstico electoral',
      impact: 'El código no certifica una base oficial compatible para Comparación o Simulación.'
    };
  } else {
    reading = sampleReading(state.assets, state.nodeId, state.year, state.category);
  }
  text('can-interpret', reading.canInterpret);
  text('cannot-claim', reading.cannotClaim);
  text('reading-origin-reason', reading.originReason);
  text('reading-impact', reading.impact);
}

function appendMapPath(path, id, geometryValid, availability, selected = false) {
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('class', `reference-shape${geometryValid ? '' : ' source-observed'}${selected ? ' selected-reference' : ''}`);
  shape.dataset.node = id;
  shape.dataset.geometry = geometryValid ? 'valid' : 'observed';
  if (geometryValid && availability) shape.dataset.availability = availability;
  element('map-shapes').append(shape);
}

function renderMap() {
  element('map-shapes').replaceChildren();
  element('breadcrumbs').replaceChildren();
  element('polar-reference').hidden = true;
  element('polar-shape').removeAttribute('d');
  if (!state.assets) {
    text('geometry-status', 'Sin referencia cargada');
    text('geometry-note', 'No hay referencia geográfica disponible. No se sustituyen archivos faltantes por cartografía inventada.');
    text('map-reading', 'Sin referencia cargada');
    text('map-description', 'No hay cartografía de referencia cargada.');
    return;
  }
  const assets = state.assets;
  const node = assets.fixture.nodes[state.nodeId];
  const geometry = geometryFor(assets, state.nodeId);
  const sample = isSampleVisible();
  const map = element('territory-map');
  map.dataset.scope = state.nodeId;
  map.dataset.referenceScope = geometry.scope;
  text('selected-heading', node.label);
  text('map-title', `Referencia territorial de ${node.label}`);
  text('geometry-status', geometryLabels[geometry.state]);
  text('map-subtitle', geometry.ownLocation ? 'Referencia geográfica; no acredita equivalencia electoral histórica.'
    : 'Unidad ficticia sin ubicación propia. Se muestra Rosales como referencia neutral.');
  text('map-reading', geometry.state === 'ancestor' ? 'Sin ubicación propia; contorno neutral de Rosales'
    : sample ? `${STATE_LABELS[currentPresentation()]} · ${node.label}` : 'Referencia neutral, sin resultados de esta consulta');
  text('map-color-note', sample ? 'Color = disponibilidad declarada, no ganador ni intensidad de votos.'
    : 'Sin color de disponibilidad: no hay evidencia de resultados para esta consulta.');
  const chain = ancestors(assets, state.nodeId);
  chain.forEach((id, index) => {
    if (index) element('breadcrumbs').append(make('span', '/'));
    if (id === state.nodeId) element('breadcrumbs').append(make('span', assets.fixture.nodes[id].label, 'current'));
    else {
      const button = make('button', assets.fixture.nodes[id].label);
      button.addEventListener('click', () => selectTerritory(id));
      element('breadcrumbs').append(button);
    }
  });
  let note = 'Cartografía de referencia, no equivalencia electoral histórica. Los resultados y la geometría son ejes independientes.';
  if (geometry.scope === 'argentina') {
    for (const shape of assets.geography.provinces) {
      const availability = sample ? sampleEvidence(assets, shape.id, state.year, state.category).state : null;
      appendMapPath(shape.path, shape.id, shape.geometryValid, availability);
    }
    note = 'Encuadre continental, no territorio completo. Referencia de origen: 17 provincias/CABA sin observaciones y 7 observadas; 22 geometrías de origen observadas en total. Todas permanecen en la tabla y en el mapa neutral cuando están observadas. No acredita equivalencia electoral histórica.';
    element('polar-reference').hidden = false;
    if (assets.references.argentina.polarPath) element('polar-shape').setAttribute('d', assets.references.argentina.polarPath);
  } else if (geometry.scope === 'buenos-aires') {
    for (const shape of assets.geography.partidos) {
      const availability = sample ? sampleEvidence(assets, shape.id, state.year, state.category).state : null;
      appendMapPath(shape.path, shape.id, shape.geometryValid, availability);
    }
    note = 'Referencia PBA: 133 partidos sin observaciones y 2 observados. Las geometrías observadas se conservan neutrales y seleccionables en la tabla. No acredita equivalencia electoral histórica.';
  } else {
    appendMapPath(geometry.path, geometry.scope, geometry.state !== 'observed',
      sample && geometry.ownLocation ? currentPresentation() : null, true);
    if (!geometry.ownLocation) note = 'Sin ubicación propia documentada. Contorno de Rosales como referencia neutral; no se inventan polígonos, ubicaciones ni puntos para circuitos, establecimientos o mesas de demostración.';
    else if (geometry.state === 'observed') note = 'Geometría observada en origen: se conserva neutral y no recibe color de disponibilidad. La observación geográfica no cambia el estado de los resultados.';
  }
  text('geometry-note', note);
  text('map-description', `${node.label}. ${geometryLabels[geometry.state]}. ${note} Los datos también se consultan en la tabla.`);
}

function renderChildren() {
  const body = element('territory-body');
  body.replaceChildren();
  element('table-empty').hidden = false;
  if (!isSampleVisible()) {
    text('shown-count', 'Sin filas de resultados disponibles');
    text('table-empty', state.loadState === 'loading' ? 'La muestra se está cargando.'
      : 'No se muestran filas de una muestra anterior. La referencia del mapa no acredita datos de resultados.');
    return;
  }
  const assets = state.assets;
  const childIds = assets.fixture.nodes[state.nodeId].childIds;
  const normalizedSearch = state.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visible = childIds.filter(id => {
    const node = assets.fixture.nodes[id];
    const label = node.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const sample = sampleEvidence(assets, id, state.year, state.category);
    return label.includes(normalizedSearch) && (state.availability === 'all' || sample.state === state.availability);
  });
  text('shown-count', `${numbers.format(visible.length)} de ${numbers.format(childIds.length)} unidades visibles`);
  text('children-note', 'Filas visibles, no denominador de cobertura. La búsqueda no recalcula el mapa ni el agregado seleccionado.');
  for (const id of visible) {
    const node = assets.fixture.nodes[id];
    const sample = sampleEvidence(assets, id, state.year, state.category);
    const geometry = geometryFor(assets, id);
    const row = make('tr');
    row.dataset.node = id;
    const name = make('th');
    name.scope = 'row';
    const button = make('button', node.label);
    button.setAttribute('aria-label', `Inspeccionar ${node.label}`);
    button.addEventListener('click', () => selectTerritory(id));
    name.append(button);
    const reading = sampleReading(assets, id, state.year, state.category);
    const limits = make('div', undefined, 'unit-limits');
    limits.dataset.field = 'limits';
    const details = make('details');
    const summary = make('summary', 'Ver límites de lectura');
    summary.setAttribute('aria-label', `Ver límites de lectura de ${node.label}`);
    const reason = make('p', reading.originReason);
    reason.dataset.field = 'reason';
    const impact = make('p', reading.impact);
    impact.dataset.field = 'impact';
    details.append(summary, reason, impact);
    limits.append(details);
    name.append(limits);
    const status = make('td');
    status.dataset.field = 'status';
    const statusLabel = make('span', STATE_LABELS[sample.state], 'status-label');
    statusLabel.dataset.state = sample.state;
    status.append(statusLabel);
    const coverage = make('td');
    coverage.append(make('span', `${numbers.format(sample.coverage.reported)}/${numbers.format(sample.coverage.total)}`), make('span', sample.unit, 'coverage-unit-label'));
    coverage.dataset.field = 'coverage';
    coverage.title = sample.unit;
    const geographic = make('td', geometryLabels[geometry.state]);
    geographic.dataset.field = 'geometry';
    row.append(name, status, coverage, geographic);
    body.append(row);
  }
  element('table-empty').hidden = visible.length > 0;
  text('table-empty', childIds.length === 0 ? 'Esta unidad no tiene un desglose inferior en la muestra. No significa que sus votos estén ausentes.'
    : 'No hay unidades que coincidan con los filtros. El resultado y la cobertura del territorio no cambiaron.');
}

function renderBoundaries() {
  element('boundary-facts').replaceChildren();
  if (!state.assets) {
    text('snapshot-date', 'Revisión local no disponible; sin certificación de cobertura alojada.');
    return;
  }
  const policy = state.assets.policy;
  const checked = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(policy.checkedAt));
  text('snapshot-date', `Revisión de código local: ${checked} (Argentina). No es una fecha de ingesta.`);
  for (const fact of policy.facts) {
    const article = make('article');
    article.dataset.fact = fact.id;
    article.append(make('h3', fact.title), make('p', fact.detail));
    element('boundary-facts').append(article);
  }
}

function renderMobileReading(presentation) {
  const label = state.assets?.fixture.nodes[state.nodeId].label ?? 'Contexto pendiente';
  text('mobile-evidence-context', `${label} · ${STATE_LABELS[presentation]}`);
  text('mobile-evidence-reading', isSampleVisible()
    ? `${element('coverage-ratio').textContent} ${element('coverage-unit').textContent}. Cobertura ficticia, no oficial.`
    : element('status-explanation').textContent);
}

function render() {
  clearProvenance();
  const presentation = currentPresentation();
  renderControls();
  renderScope(presentation);
  renderSummary(presentation);
  renderReading(presentation);
  renderMap();
  renderChildren();
  renderBoundaries();
  renderMobileReading(presentation);
}

async function loadAssets(restoreFocus = false) {
  const request = ++state.request;
  state.assets = null;
  state.loadState = 'loading';
  state.consultationCase = 'normal';
  resetTableFilters();
  render();
  try {
    const values = await Promise.all(['evidence-policy.json', 'demo-results.json', 'reference-paths.json', 'winner-reference-paths.json'].map(async name => {
      const response = await fetch(`./assets/${name}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Local assets unavailable');
      return response.json();
    }));
    const assets = validateAssets(...values);
    if (request !== state.request) return;
    state.assets = assets;
    state.loadState = 'ready';
    const options = assets.policy.consultationCases.map(item => {
      const option = make('option', item.label);
      option.value = item.id;
      return option;
    });
    element('consultation-case').replaceChildren(...options);
    element('consultation-case').value = 'normal';
  } catch (error) {
    if (request !== state.request) return;
    state.assets = null;
    state.loadState = error.message === 'Local assets unavailable' ? 'unavailable' : 'error';
  }
  render();
  if (restoreFocus) element(state.loadState === 'ready' ? 'selected-heading' : 'retry').focus();
}

function openDialog(id, opener) {
  dialogOpeners.set(id, opener);
  element(id).showModal();
}
function populateProvenance() {
  const content = element('provenance-content');
  content.replaceChildren();
  if (!isSampleVisible()) return;
  content.append(make('p', 'Muestra ficticia de diseño. No hay evidencia oficial vinculada a los resultados seleccionados.'));
  const fields = make('dl', undefined, 'provenance-fields');
  for (const [label, value] of [
    ['Identificador de archivo oficial', 'Desconocido · sin vínculo a un archivo oficial'],
    ['Fecha de obtención oficial', 'Desconocida'],
    ['SHA de archivo oficial', 'Desconocido · no se verificaron bytes oficiales'],
    ['Huella de la muestra de diseño', state.assets.policy.demonstration.fingerprint]
  ]) {
    const wrapper = make('div');
    const valueNode = make('dd', value);
    if (label === 'Huella de la muestra de diseño') valueNode.id = 'design-fingerprint';
    wrapper.append(make('dt', label), valueNode);
    fields.append(wrapper);
  }
  content.append(fields, make('p', 'La huella identifica la muestra local de diseño; no verifica un archivo oficial, una ingesta ni la cobertura de la base alojada. No se muestran rutas, URL de origen, notas libres ni datos personales.'));
}

for (const [id, key] of [['base-year', 'year'], ['category', 'category']]) {
  element(id).addEventListener('change', event => { state[key] = event.target.value; render(); });
}
element('territory').addEventListener('change', event => selectTerritory(event.target.value));
for (const [id, key] of [['evidence-mode', 'mode'], ['source-kind', 'sourceKind']]) {
  element(id).addEventListener('change', event => {
    state[key] = event.target.value;
    state.consultationCase = 'normal';
    element('consultation-case').value = 'normal';
    resetTableFilters();
    render();
  });
}
element('consultation-case').addEventListener('change', event => {
  state.consultationCase = event.target.value;
  resetTableFilters();
  render();
});
element('territory-search').addEventListener('input', event => { state.search = event.target.value; renderChildren(); });
element('availability-filter').addEventListener('change', event => { state.availability = event.target.value; renderChildren(); });
element('retry').addEventListener('click', () => loadAssets(true));
element('provenance-open').addEventListener('click', event => { populateProvenance(); openDialog('provenance-dialog', event.currentTarget); });
element('provenance-quick').addEventListener('click', event => { populateProvenance(); openDialog('provenance-dialog', event.currentTarget); });
element('method-open').addEventListener('click', event => openDialog('method-dialog', event.currentTarget));
element('navigation-open').addEventListener('click', event => openDialog('navigation-dialog', event.currentTarget));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => element(button.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  const opener = dialogOpeners.get(dialog.id);
  if (opener?.isConnected && !opener.disabled) opener.focus();
});
loadAssets();
