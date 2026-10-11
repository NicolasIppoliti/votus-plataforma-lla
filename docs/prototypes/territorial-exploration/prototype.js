// Isolated design study: fictional vote fixtures, source-backed geographic references, no production access.
const parties = [
  { id: 'a', name: 'Alianza A', color: '#65e5f2' },
  { id: 'b', name: 'Alianza B', color: '#aac0f1' },
  { id: 'c', name: 'Lista C', color: '#efc58c' },
  { id: 'd', name: 'Lista D', color: '#769598' },
];
const categoryLabels = { 'national-deputies': 'Diputados nacionales · demostración', concejales: 'Concejales · demostración' };
const levelLabels = { country: 'País', province: 'Provincia', partido: 'Partido', circuit: 'Circuito ficticio', school: 'Establecimiento ficticio', mesa: 'Mesa ficticia' };
const state = { nodeId: 'argentina', election: '2025', category: 'national-deputies', party: 'all', zoom: 1, resultsExpanded: false, search: '', navigatorSearch: '' };
const byId = id => document.getElementById(id);
const integer = value => new Intl.NumberFormat('es-AR').format(value);
const decimal = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const partyName = id => parties.find(party => party.id === id)?.name ?? '—';
let fixture, geography, baseReferences;
const missingResult = { status: 'missing', votes: null, coverage: { reported: 0, total: 0 }, aggregation: 'aggregate' };
const currentNode = () => fixture.nodes[state.nodeId];
const resultFor = (id, year = state.election) => fixture.results[year]?.[state.category]?.[id] ?? missingResult;
const totalVotes = entry => entry.votes ? Object.values(entry.votes).reduce((sum, value) => sum + value, 0) : null;
const referenceFor = id => [...geography.provinces, ...geography.partidos].find(item => item.id === id);
function computeOutcome(entry) {
  const total = totalVotes(entry);
  if (entry.status === 'missing' || total === null) return { state: 'missing', total: null };
  if (total === 0) return { state: 'zero', total };
  const ordered = Object.entries(entry.votes).sort((left, right) => right[1] - left[1]);
  const outcome = { total, leader: ordered[0][0], share: ordered[0][1] / total * 100, margin: (ordered[0][1] - ordered[1][1]) / total * 100 };
  if (entry.status === 'partial') return { ...outcome, state: 'partial' };
  if (ordered[0][1] === ordered[1][1]) return { ...outcome, state: 'tie' };
  return { ...outcome, state: 'complete', winner: ordered[0][0] };
}
function outcomeLabel(outcome) {
  return { missing: 'Sin muestra', zero: 'Sin votos', tie: 'Empate', partial: 'Parcial · sin ganador definitivo', complete: partyName(outcome.winner) }[outcome.state];
}
function coverageLabel(entry) {
  return `${integer(entry.coverage?.reported ?? 0)} / ${integer(entry.coverage?.total ?? 0)}`;
}
function makeDot(color) {
  const dot = document.createElement('span');
  dot.className = 'party-dot';
  dot.style.background = color;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
function renderBreakdown(entry) {
  const total = totalVotes(entry);
  byId('party-breakdown').replaceChildren(...parties.map(party => {
    const row = document.createElement('div');
    row.className = 'party-row';
    if (state.party === party.id) row.classList.add('is-emphasized');
    if (state.party !== 'all' && state.party !== party.id) row.classList.add('is-muted');
    const label = document.createElement('span');
    label.textContent = party.name;
    const share = document.createElement('strong');
    share.textContent = total > 0 ? `${decimal(entry.votes[party.id] / total * 100)} %` : '—';
    row.append(makeDot(party.color), label, share);
    return row;
  }));
  for (const party of parties) {
    const strip = document.querySelector(`[data-strip="${party.id}"]`);
    strip.style.flex = `${entry.votes[party.id]} 1 0`;
    strip.style.opacity = state.party === 'all' || state.party === party.id ? '1' : '.4';
  }
  document.querySelector('.composition-strip').hidden = total === 0;
}
function renderExactResults() {
  const entry = resultFor(state.nodeId), total = totalVotes(entry);
  const available = entry.status !== 'missing' && total !== null;
  const base = resultFor(state.nodeId, '2023'), baseTotal = totalVotes(base);
  byId('result-rows').replaceChildren(...(available ? parties.map(party => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    const label = document.createElement('span');
    label.className = 'table-party';
    label.append(makeDot(party.color), document.createTextNode(party.name));
    nameCell.append(label);
    const votesCell = document.createElement('td');
    votesCell.textContent = integer(entry.votes[party.id]);
    const shareCell = document.createElement('td');
    shareCell.textContent = total > 0 ? `${decimal(entry.votes[party.id] / total * 100)} %` : '—';
    const deltaCell = document.createElement('td');
    const difference = total > 0 && baseTotal > 0 ? (entry.votes[party.id] / total - base.votes[party.id] / baseTotal) * 100 : null;
    deltaCell.textContent = state.election === '2023' ? 'Base de comparación' : difference === null ? '—' : `${difference > 0 ? '+' : ''}${decimal(difference)} pp`;
    row.append(nameCell, votesCell, shareCell, deltaCell);
    return row;
  }) : []));
  byId('results-caption').textContent = `${currentNode().label} · ${state.election} · ${categoryLabels[state.category]} · cifras ficticias`;
  byId('table-total').textContent = available ? integer(total) : '';
  byId('table-total').nextElementSibling.textContent = total > 0 ? '100,00 %' : '—';
  byId('table-delta').textContent = '—';
  byId('results-content').hidden = !state.resultsExpanded || !available;
  byId('results-unavailable').hidden = available;
  const toggle = byId('results-toggle');
  toggle.disabled = !available;
  toggle.setAttribute('aria-expanded', String(state.resultsExpanded && available));
  toggle.firstChild.textContent = state.resultsExpanded && available ? 'Ocultar resultados exactos' : 'Mostrar resultados exactos';
}
function renderTrail() {
  const ancestors = [];
  let id = state.nodeId;
  while (id) { ancestors.unshift(id); id = fixture.nodes[id].parentId; }
  const trail = byId('territorial-trail');
  trail.replaceChildren();
  for (const [index, id] of ancestors.entries()) {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'trail-separator';
      separator.textContent = '/';
      separator.setAttribute('aria-hidden', 'true');
      trail.append(separator);
    }
    const label = fixture.nodes[id].label;
    if (id === state.nodeId) {
      const current = document.createElement('span');
      current.textContent = label;
      current.setAttribute('aria-current', 'location');
      trail.append(current);
    } else {
      const parent = document.createElement('button');
      parent.textContent = label;
      parent.setAttribute('aria-label', `Ir a ${label}`);
      parent.addEventListener('click', () => changeNode(id));
      trail.append(parent);
    }
  }
}
function renderNavigatorChildren() {
  const node = currentNode();
  const children = node.childIds.filter(id => fixture.nodes[id].label.toLocaleLowerCase('es').includes(state.navigatorSearch));
  byId('navigator-children').replaceChildren(...children.map(id => {
    const button = document.createElement('button');
    button.className = 'navigator-child';
    button.setAttribute('aria-label', `Abrir ${fixture.nodes[id].label}`);
    const label = document.createElement('span');
    label.textContent = fixture.nodes[id].label;
    const arrow = document.createElement('span');
    arrow.className = 'navigator-arrow';
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(label, arrow);
    button.addEventListener('click', () => changeNode(id, true));
    return button;
  }));
  byId('navigator-empty').hidden = children.length > 0;
  byId('navigator-empty').textContent = node.childIds.length ? 'No hay coincidencias' : node.level === 'mesa' ? 'Fin del recorrido. Mesa de demostración sin ubicación territorial propia.' : 'No hay un siguiente nivel disponible en esta maqueta. Puedes volver por la ruta de exploración.';
}
function renderNavigator() {
  const node = currentNode();
  const titles = { country: 'Provincias de referencia', province: 'Partidos de Buenos Aires', partido: 'Circuitos de Coronel Rosales', circuit: 'Establecimientos del circuito', school: 'Mesas del establecimiento', mesa: 'Mesa seleccionada' };
  byId('navigator-title').textContent = node.childIds.length || node.level === 'mesa' ? titles[node.level] : 'Territorio seleccionado';
  const ancestors = [];
  let id = state.nodeId;
  while (id) { ancestors.unshift(id); id = fixture.nodes[id].parentId; }
  const route = byId('navigator-route');
  route.replaceChildren(...ancestors.map(id => {
    const item = document.createElement(id === state.nodeId ? 'span' : 'button');
    item.textContent = fixture.nodes[id].label;
    if (id === state.nodeId) item.setAttribute('aria-current', 'location');
    else {
      item.setAttribute('aria-label', `Ir a ${fixture.nodes[id].label}`);
      item.addEventListener('click', () => changeNode(id, true));
    }
    return item;
  }));
  const parent = byId('navigator-parent');
  parent.hidden = node.parentId === null;
  parent.textContent = node.parentId ? `Volver a ${fixture.nodes[node.parentId].label}` : '';
  parent.onclick = node.parentId ? () => changeNode(node.parentId, true) : null;
  byId('navigator-search-wrap').hidden = node.childIds.length < 10;
  byId('navigator-search').value = state.navigatorSearch;
  renderNavigatorChildren();
}
function renderChildResults() {
  const node = currentNode();
  const children = node.childIds;
  const rows = children.map(id => {
    const child = fixture.nodes[id], entry = resultFor(id), outcome = computeOutcome(entry), reference = referenceFor(id);
    const row = document.createElement('tr');
    row.dataset.nodeId = id;
    row.dataset.resultState = outcome.state;
    row.hidden = state.search !== '' && !child.label.toLocaleLowerCase('es').includes(state.search);
    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    const explore = document.createElement('button');
    explore.textContent = child.label;
    explore.setAttribute('aria-label', `Explorar ${child.label}`);
    explore.addEventListener('click', () => changeNode(id));
    nameCell.append(explore);
    const outcomeCell = document.createElement('td');
    outcomeCell.className = `child-outcome outcome-${outcome.state}`;
    if (outcome.winner) outcomeCell.append(makeDot(parties.find(party => party.id === outcome.winner).color));
    outcomeCell.append(document.createTextNode(outcomeLabel(outcome)));
    const shareCell = document.createElement('td');
    shareCell.textContent = outcome.state === 'complete' ? `${decimal(outcome.share)} %` : '—';
    const marginCell = document.createElement('td');
    marginCell.textContent = outcome.state === 'complete' ? `${decimal(outcome.margin)} pp` : '—';
    const coverageCell = document.createElement('td');
    coverageCell.textContent = outcome.state === 'missing' ? 'Sin muestra' : coverageLabel(entry);
    const referenceCell = document.createElement('td');
    referenceCell.className = 'child-reference';
    referenceCell.textContent = reference ? reference.geometryValid ? 'Referencia CNE' : 'Cartografía observada' : 'Unidad ficticia · sin geometría';
    if (reference && !reference.geometryValid) referenceCell.classList.add('source-observed');
    row.append(nameCell, outcomeCell, shareCell, marginCell, coverageCell, referenceCell);
    return row;
  });
  byId('child-results-rows').replaceChildren(...rows);
  byId('child-results-title').textContent = node.level === 'country' ? 'Ganadores por provincia' : node.level === 'province' && state.nodeId === 'buenos-aires' ? 'Ganadores por partido' : 'Desglose territorial';
  byId('child-results-context').textContent = `${categoryLabels[state.category]} · ${state.election} · ${children.length} referencias de demostración`;
  byId('child-table-caption').textContent = `${node.label}: resultados ficticios por territorio`;
  const complete = children.filter(id => resultFor(id).status === 'complete').length;
  const reported = children.filter(id => resultFor(id).status !== 'missing').length;
  const shown = rows.filter(row => !row.hidden).length;
  byId('child-results-summary').textContent = children.length ? `${shown} de ${children.length} territorios visibles · muestras completas ${complete}/${children.length}, con algún dato ${reported}/${children.length}. Calidad cartográfica y cobertura de votos son independientes.` : 'No se ha inventado un desglose a partir del agregado.';
  byId('child-results-empty').hidden = children.length > 0 && shown > 0;
  byId('child-results-empty').textContent = children.length === 0 ? node.level === 'mesa' ? 'Fin del recorrido: mesa de demostración, sin ubicación territorial propia.' : 'Agregado de muestra sin detalle de hijos disponible en esta maqueta.' : 'No hay nombres que coincidan con el filtro.';
  byId('child-search').disabled = children.length === 0;
}
function renderEvidence() {
  const node = currentNode(), entry = resultFor(state.nodeId), deep = node.fictional === true;
  byId('evidence-intro').textContent = `${node.label}: resultados ficticios y referencias geográficas independientes. La cartografía nacional base es IGN; los grupos de provincias y partidos son referencias CNE.`;
  byId('evidence-geography').textContent = deep ? 'Unidad de demostración sin geometría ni ubicación propia. El mapa conserva únicamente el contorno ancestro de Coronel Rosales.' : state.nodeId === 'argentina' ? 'Referencia completa IGN: 1.980 componentes. Capa CNE: 24 grupos por nombre, con las 538 entidades originales conservadas.' : state.nodeId === 'buenos-aires' ? 'Referencia IGN de Buenos Aires y 135 referencias de nombres de sección CNE; dos geometrías de origen observadas.' : `Nombre de referencia: ${node.sourceName ?? node.label}. ID interno ${state.nodeId}, no código electoral canónico.`;
  byId('evidence-scope').textContent = 'Los 22 casos CNE de geometría no válida permanecen, con contornos neutrales y advertencias. No se ha reparado, disuelto ni eliminado ninguna entidad. Aplicabilidad electoral por año desconocida. El encuadre continental no reemplaza la referencia polar completa.';
  byId('evidence-context').textContent = `${categoryLabels[state.category]}, ${state.election}. ${entry.status === 'missing' ? 'Sin muestra para este nodo; no se cambia de categoría automáticamente.' : entry.aggregation === 'children' ? 'Suma exacta de una partición completa de hijos ficticios, dentro del mismo contexto.' : entry.note ?? 'Agregado ficticio sin desglose completo de hijos.'}`;
  byId('evidence-source').textContent = 'CNE sha256: 964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673. IGN nacional sha256: ae076881944abd36b79b0a68d14912ca475af95a2c2a9211910ffab81f6ca1e6.';
}
function renderMap() {
  const node = currentNode(), deep = node.fictional === true;
  const referenceScope = deep ? 'rosales' : state.nodeId;
  const base = baseReferences[referenceScope];
  const reference = referenceFor(referenceScope);
  const path = base?.path ?? reference?.scopePath;
  if (!path) {
    byId('map-subtitle').textContent = 'Sin referencia geográfica disponible para este nodo';
    byId('child-geographies').replaceChildren();
    byId('territory-map').removeAttribute('data-scope');
    return;
  }
  for (const id of ['clip-outline', 'outline-depth', 'outline-glow', 'outline-main']) byId(id).setAttribute('d', path);
  byId('outline-main').classList.toggle('observed-reference', reference?.geometryValid === false);
  byId('outline-glow').hidden = reference?.geometryValid === false;
  const geographicChildren = state.nodeId === 'argentina' ? geography.provinces : state.nodeId === 'buenos-aires' ? geography.partidos : [];
  byId('child-geographies').replaceChildren(...geographicChildren.map((item, index) => {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const outcome = computeOutcome(resultFor(item.id));
    shape.setAttribute('d', item.path);
    shape.dataset.nodeId = item.id;
    shape.dataset.resultState = outcome.state;
    shape.classList.add('child-geography');
    shape.setAttribute('role', 'button');
    shape.setAttribute('tabindex', index === 0 ? '0' : '-1');
    shape.setAttribute('aria-label', `Explorar ${item.label} en el mapa. ${outcomeLabel(outcome)}.${item.geometryValid ? '' : ' Cartografía observada.'}`);
    if (item.geometryValid && outcome.state === 'complete') {
      shape.dataset.winner = outcome.winner;
      shape.style.setProperty('--winner-color', parties.find(party => party.id === outcome.winner).color);
    }
    if (!item.geometryValid) shape.classList.add('cartography-observed');
    if (state.party !== 'all' && outcome.winner !== state.party) shape.classList.add('map-muted');
    shape.addEventListener('click', () => changeNode(item.id));
    shape.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changeNode(item.id); }
      else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        const nextIndex = (index + delta + geographicChildren.length) % geographicChildren.length;
        shape.setAttribute('tabindex', '-1');
        const next = byId('child-geographies').children[nextIndex];
        next.setAttribute('tabindex', '0');
        next.focus();
      }
    });
    return shape;
  }));
  byId('polar-reference-path').setAttribute('d', baseReferences.argentina.polarPath);
  byId('national-reference-inset').hidden = state.nodeId !== 'argentina';
  byId('territory-map').dataset.referenceScope = referenceScope;
  // Matching map and child paths are ready before the latest-node readiness marker is committed.
  byId('territory-map').dataset.scope = state.nodeId;
}
function renderData() {
  const node = currentNode(), entry = resultFor(state.nodeId), outcome = computeOutcome(entry);
  const available = outcome.state !== 'missing';
  byId('detail-title').textContent = node.label;
  document.querySelector('.detail-subtitle').textContent = node.fictional ? 'Unidad ficticia de diseño · ancestro Coronel Rosales' : 'Referencia territorial · muestra ficticia';
  document.querySelector('.detail-scope').textContent = levelLabels[node.level];
  byId('detail-category').textContent = categoryLabels[state.category];
  renderNavigator();
  byId('detail-supported').hidden = !available;
  byId('detail-unsupported').hidden = available;
  byId('total-votes').textContent = available ? integer(outcome.total) : '';
  byId('total-caption').textContent = entry.aggregation === 'children' ? 'Partición completa de hijos de demostración' : entry.note ? 'Agregado ficticio · sin desglose completo' : 'Agregado de demostración';
  const overall = byId('overall-outcome');
  overall.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = outcomeLabel(outcome);
  const detail = document.createElement('span');
  detail.textContent = outcome.state === 'complete' ? `Votos positivos ${decimal(outcome.share)} % · margen ${decimal(outcome.margin)} pp` : outcome.state === 'partial' ? `Liderazgo provisional: ${partyName(outcome.leader)} · ${decimal(outcome.share)} %` : outcome.state === 'tie' ? 'No se asigna un ganador en empate.' : outcome.state === 'zero' ? 'No se calcula porcentaje sobre cero votos.' : 'La ausencia de muestra no equivale a cero.';
  const coverage = document.createElement('small');
  coverage.textContent = `${available ? `Cobertura ficticia ${coverageLabel(entry)}` : 'Cobertura de muestra indisponible'}${entry.aggregation === 'aggregate' ? ' · sin desglose completo' : ''}`;
  overall.append(title, detail, coverage);
  const readingTitle = document.createElement('strong');
  readingTitle.textContent = `${node.label} · ${state.election}`;
  const readingResult = document.createElement('p');
  readingResult.textContent = `${outcomeLabel(outcome)}${available ? ` · ${integer(outcome.total)} votos positivos de muestra` : ''}`;
  const readingContext = document.createElement('p');
  readingContext.className = 'reading-limit';
  readingContext.textContent = `${categoryLabels[state.category]} · ${detail.textContent} ${coverage.textContent}. Cifras ficticias.`;
  byId('mobile-reading').replaceChildren(readingTitle, readingResult, readingContext);

  if (available) renderBreakdown(entry);
  else { byId('party-breakdown').replaceChildren(); document.querySelector('.composition-strip').hidden = true; }
  byId('map-subtitle').textContent = node.fictional ? 'Referencia ancestro: Coronel Rosales · sin geometría propia' : state.nodeId === 'argentina' ? 'Provincias de referencia CNE · encuadre continental' : state.nodeId === 'buenos-aires' ? '135 referencias CNE · no cruce electoral oficial' : `Contorno de referencia: ${node.label}`;
  byId('map-selection-name').textContent = node.fictional ? 'Referencia de Coronel Rosales' : node.label;
  byId('map-selection-context').textContent = node.fictional ? 'Sin ubicación territorial propia' : 'Seleccionado · no cobertura electoral';
  byId('select-current-territory').setAttribute('aria-label', `Seleccionar ${node.label}`);
  byId('reference-location-note').hidden = !node.fictional;
  byId('reference-location-note').textContent = node.fictional ? 'Sin ubicación territorial propia. Las unidades profundas son ficticias; el mapa solo muestra la referencia ancestro.' : '';
  document.querySelector('.map-stage').dataset.scope = state.nodeId;
  document.querySelector('.coordinate-north').textContent = state.nodeId === 'argentina' ? 'Encuadre continental' : 'Referencia geográfica';
  document.querySelector('.coordinate-south').textContent = '';
  byId('selection-copy').textContent = `${node.label} · ${state.party === 'all' ? 'todas las agrupaciones' : partyName(state.party)} · ${state.election}${available ? '' : ' · sin muestra'}`;
  for (const option of [...byId('territory').options]) if (option.dataset.current) option.remove();
  if (!['argentina', 'buenos-aires', 'rosales'].includes(state.nodeId)) {
    const option = new Option(node.label, state.nodeId);
    option.dataset.current = 'true';
    byId('territory').add(option);
  }
  byId('territory').value = state.nodeId;
  renderTrail();
  renderChildResults();
  renderExactResults();
  renderEvidence();
  renderMap();
}
function renderCamera() {
  byId('map-camera').style.transform = `scale(${state.zoom})`;
  byId('camera-label').textContent = `Vista de referencia · ${Math.round(state.zoom * 100)} %`;
}
function changeNode(id, focusNavigator = false) {
  if (!fixture) {
    if (['argentina', 'buenos-aires', 'rosales'].includes(id)) state.nodeId = id;
    return;
  }
  if (!fixture.nodes[id]) return;
  state.nodeId = id;
  state.zoom = 1;
  state.search = '';
  state.navigatorSearch = '';
  byId('child-search').value = '';
  // Geography changes only geography; election/category/group selections remain stable.
  renderData();
  byId('navigator-children').scrollTop = 0;
  renderCamera();
  if (focusNavigator) {
    byId('navigator-title').focus();
    byId('navigator-title').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
}
byId('territory').addEventListener('change', event => changeNode(event.target.value));
for (const [input, key] of [['election', 'election'], ['category', 'category'], ['party', 'party']]) byId(input).addEventListener('change', event => {
  state[key] = event.target.value;
  if (fixture) renderData();
});
byId('child-search').addEventListener('input', event => {
  state.search = event.target.value.trim().toLocaleLowerCase('es');
  if (fixture) renderChildResults();
});
byId('navigator-search').addEventListener('input', event => {
  state.navigatorSearch = event.target.value.trim().toLocaleLowerCase('es');
  if (fixture) {
    renderNavigatorChildren();
    byId('navigator-children').scrollTop = 0;
  }
});
byId('results-toggle').addEventListener('click', () => { if (!fixture) return; state.resultsExpanded = !state.resultsExpanded; renderExactResults(); });
byId('select-current-territory').addEventListener('click', () => { if (fixture) renderData(); });
document.querySelector('[aria-label="Acercar mapa"]').addEventListener('click', () => { state.zoom = Math.min(1.8, state.zoom + .2); renderCamera(); });
document.querySelector('[aria-label="Alejar mapa"]').addEventListener('click', () => { state.zoom = Math.max(.8, state.zoom - .2); renderCamera(); });
document.querySelector('[aria-label="Restablecer vista"]').addEventListener('click', () => { state.zoom = 1; renderCamera(); });
const evidenceDialog = byId('evidence-dialog'), navigationDialog = byId('navigation-dialog');
document.querySelector('.evidence-trigger').addEventListener('click', () => evidenceDialog.showModal());
document.querySelector('[aria-label="Cerrar evidencia"]').addEventListener('click', () => evidenceDialog.close());
document.querySelector('[aria-label="Abrir navegación"]').addEventListener('click', () => navigationDialog.showModal());
document.querySelector('[aria-label="Cerrar navegación"]').addEventListener('click', () => navigationDialog.close());
navigationDialog.querySelector('.nav-active').addEventListener('click', () => navigationDialog.close());
async function loadLocalJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Local prototype asset unavailable');
  return response.json();
}
async function initialize() {
  try {
    const loaded = await Promise.all(['./assets/demo-results.json', './assets/winner-reference-paths.json', './assets/reference-paths.json'].map(loadLocalJson));
    [fixture, geography, baseReferences] = loaded;
    if (fixture.source.kind !== 'demonstration' || geography.provinces.length !== 24 || geography.partidos.length !== 135) throw new Error('Prototype asset contract mismatch');
    renderData();
    renderCamera();
  } catch {
    fixture = null; geography = null; baseReferences = null;
    byId('map-subtitle').textContent = 'No se pudieron cargar las referencias o muestras locales.';
    byId('detail-title').textContent = 'Vista no disponible';
    byId('mobile-reading').textContent = 'Vista no disponible. No se pudieron cargar las muestras o referencias locales. Recarga para volver a intentar.';
    byId('navigator-title').textContent = 'Recorrido no disponible';
    byId('navigator-empty').textContent = 'No se pudo cargar el árbol territorial. Recarga la maqueta para volver a intentar.';
    byId('total-votes').textContent = '';
    byId('detail-supported').hidden = true;
    byId('detail-unsupported').hidden = false;
    byId('child-results-empty').hidden = false;
    byId('child-results-empty').textContent = 'Recarga la maqueta para volver a intentar. No se muestra un mapa o resultado sustituto.';
    byId('results-toggle').disabled = true;
    byId('selection-copy').textContent = 'Sin muestra cargada · referencias locales indisponibles';
    byId('national-reference-inset').hidden = true;
  }
}
initialize();
