// Isolated Comparison study. Reference geography and synthetic correspondence are independent.
const byId = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('es-AR').format(value);
const decimal = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const percent = value => decimal(value) + ' %';
const signed = value => (value > 0 ? '+' : '') + decimal(value) + ' pp';
const signedVotes = value => (value > 0 ? '+' : '') + number(value) + ' votos';
const parties = { a: 'Alianza A', b: 'Alianza B', c: 'Lista C', d: 'Lista D' };
const winnerColors = { a: '#65e5f2', b: '#aac0f1', c: '#efc58c', d: '#769598' };
const categories = { 'national-deputies': 'Diputados nacionales', concejales: 'Concejales' };
const levels = { country: 'País', province: 'Provincia', partido: 'Partido', circuit: 'Circuito ficticio', school: 'Establecimiento ficticio', mesa: 'Mesa ficticia' };
const state = {
  nodeId: 'buenos-aires', party: 'a', a: { year: '2023', category: 'national-deputies' },
  b: { year: '2025', category: 'national-deputies' }, view: 'share', zoom: 1, panX: 0, panY: 0, frame: null,
  navigatorSearch: '', tableSearch: '', tableOrder: 'delta-desc',
};
const labels = { matched: 'Par comparable de demostración', missing: 'Sin muestra completa', partial: 'Cobertura parcial', zero: 'Total incluido igual a cero', unmapped: 'Correspondencia sin resolver', discontinuous: 'Unidad discontinua', 'category-mismatch': 'Categorías distintas', 'same-year': 'La misma elección en ambos lados' };
const reasons = {
  matched: 'Par ficticio completo. La identidad sintética no valida límites históricos ni equivalencias electorales reales.',
  missing: 'Al menos un lado carece de muestra. No se reemplazan ausencias con cero; puedes seguir navegando.',
  partial: 'Al menos un lado es parcial. No se muestran cambios como si la cobertura fuera completa.',
  zero: 'No se puede calcular participación ni cambio cuando el total incluido de un lado es cero.',
  unmapped: 'Escenario de diseño: la Lista D ficticia no tiene correspondencia. El denominador incluye cuatro grupos; no se compara el par.',
  discontinuous: 'Escenario de diseño: esta unidad ficticia es discontinua. No es un hallazgo sobre límites históricos reales.',
  'category-mismatch': 'Selecciona la misma categoría en A y B. No se mezclan categorías para calcular una diferencia.',
  'same-year': 'Selecciona dos elecciones distintas. El mismo año no representa un cambio temporal.',
};
let fixture, policy, geography, references;
const currentNode = () => fixture.nodes[state.nodeId];
const entryFor = (id, side) => fixture.results[state[side].year]?.[state[side].category]?.[id];
const sum = votes => Object.values(votes).reduce((total, votes) => total + votes, 0);
function comparisonFor(id) {
  if (state.a.category !== state.b.category) return { status: 'category-mismatch' };
  if (state.a.year === state.b.year) return { status: 'same-year' };
  const override = policy.overrides[id];
  if (override) return { status: override.status };
  const a = entryFor(id, 'a'), b = entryFor(id, 'b');
  if (!a || !b || a.status === 'missing' || b.status === 'missing' || !a.votes || !b.votes) return { status: 'missing' };
  if (a.status !== 'complete' || b.status !== 'complete') return { status: 'partial' };
  const denominatorA = sum(a.votes), denominatorB = sum(b.votes);
  if (denominatorA === 0 || denominatorB === 0) return { status: 'zero' };
  return { status: 'matched', a, b, denominatorA, denominatorB };
}
function groupMetrics(pair, party = state.party) {
  const ratioA = pair.a.votes[party] / pair.denominatorA;
  const ratioB = pair.b.votes[party] / pair.denominatorB;
  return { votesA: pair.a.votes[party], votesB: pair.b.votes[party], votesDelta: pair.b.votes[party] - pair.a.votes[party], shareA: ratioA * 100, shareB: ratioB * 100, delta: (ratioB - ratioA) * 100 };
}
function uniqueLeader(votes) {
  const maximum = Math.max(...Object.values(votes));
  const leaders = Object.keys(votes).filter(id => votes[id] === maximum);
  return maximum > 0 && leaders.length === 1 ? leaders[0] : null;
}
function renderWinnerSummary(pair) {
  for (const side of ['a', 'b']) {
    const leader = pair.status === 'matched' ? uniqueLeader(pair[side].votes) : null;
    byId('winner-side-' + side).textContent = side.toUpperCase() + ' · ' + state[side].year;
    byId('winner-' + side).textContent = pair.status === 'matched' ? leader ? parties[leader] : 'Empate' : labels[pair.status];
  }
}
function blend(low, high, fraction) {
  const t = Math.max(0, Math.min(1, fraction));
  return 'rgb(' + low.map((value, index) => Math.round(value + (high[index] - value) * t)).join(',') + ')';
}
const shareColor = share => blend([16, 40, 56], [101, 229, 242], share / 100);
const changeColor = delta => blend([32, 51, 63], delta < 0 ? [189, 137, 89] : [101, 229, 242], Math.abs(delta) / 100);
const referenceFor = id => [...geography.provinces, ...geography.partidos].find(item => item.id === id);
function ancestorsOf(id) {
  const ancestors = [];
  while (id) { ancestors.unshift(id); id = fixture.nodes[id].parentId; }
  return ancestors;
}
function renderTrail(container, navigatorFocus) {
  container.replaceChildren(...ancestorsOf(state.nodeId).map(id => {
    const item = document.createElement(id === state.nodeId ? 'span' : 'button');
    item.textContent = fixture.nodes[id].label;
    if (id === state.nodeId) item.setAttribute('aria-current', 'location');
    else {
      item.setAttribute('aria-label', 'Ir a ' + fixture.nodes[id].label);
      item.addEventListener('click', () => changeNode(id, navigatorFocus));
    }
    return item;
  }));
}
function renderNavigatorChildren() {
  const node = currentNode();
  const children = node.childIds.filter(id => fixture.nodes[id].label.toLocaleLowerCase('es').includes(state.navigatorSearch));
  byId('navigator-children').replaceChildren(...children.map(id => {
    const button = document.createElement('button');
    button.className = 'navigator-child';
    button.setAttribute('aria-label', 'Abrir ' + fixture.nodes[id].label);
    const label = document.createElement('span');
    label.textContent = fixture.nodes[id].label;
    const arrow = document.createElement('span');
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(label, arrow);
    button.addEventListener('click', () => changeNode(id, true));
    return button;
  }));
  byId('navigator-empty').hidden = children.length > 0;
  byId('navigator-empty').textContent = node.childIds.length ? 'No hay coincidencias' : node.level === 'mesa' ? 'Fin del recorrido. Mesa ficticia sin ubicación territorial propia.' : 'No hay un siguiente nivel disponible en esta maqueta.';
}
function renderNavigator() {
  const node = currentNode();
  const titles = { country: 'Provincias de referencia', province: 'Partidos de Buenos Aires', partido: 'Circuitos de Coronel Rosales', circuit: 'Establecimientos del circuito', school: 'Mesas del establecimiento', mesa: 'Mesa seleccionada' };
  byId('navigator-title').textContent = node.childIds.length || node.level === 'mesa' ? titles[node.level] : 'Territorio seleccionado';
  renderTrail(byId('navigator-route'), true);
  const parent = byId('navigator-parent');
  parent.hidden = node.parentId === null;
  parent.textContent = node.parentId ? 'Volver a ' + fixture.nodes[node.parentId].label : '';
  parent.onclick = node.parentId ? () => changeNode(node.parentId, true) : null;
  byId('navigator-search-wrap').hidden = node.childIds.length < 10;
  byId('navigator-search').value = state.navigatorSearch;
  renderNavigatorChildren();
}
function renderFigures(pair) {
  const matched = pair.status === 'matched';
  const metrics = matched ? groupMetrics(pair) : null;
  byId('comparison-status').dataset.status = pair.status;
  byId('status-title').textContent = labels[pair.status];
  byId('status-reason').textContent = reasons[pair.status];
  byId('paired-figures').hidden = !matched;
  const readingTitle = document.createElement('strong');
  readingTitle.textContent = `${currentNode().label} · ${parties[state.party]}`;
  const readingStatus = document.createElement('p');
  readingStatus.textContent = `${labels[pair.status]} · A ${state.a.year} / B ${state.b.year}`;
  const readingValues = document.createElement('p');
  readingValues.textContent = matched ? `Votos positivos: A ${percent(metrics.shareA)}, B ${percent(metrics.shareB)} · B − A ${signed(metrics.delta)}` : reasons[pair.status];
  const readingLimit = document.createElement('p');
  readingLimit.className = 'reading-limit';
  readingLimit.textContent = matched ? `Categoría A: ${categories[state.a.category]}. Categoría B: ${categories[state.b.category]}. Sobre positivos incluidos de cada lado. Par ficticio; límites históricos sin verificar.` : `Categoría A: ${categories[state.a.category]}. Categoría B: ${categories[state.b.category]}. Sin métricas comparadas. Muestras ficticias.`;
  byId('mobile-reading').replaceChildren(readingTitle, readingStatus, readingValues, readingLimit);
  byId('selected-party-title').textContent = parties[state.party];
  for (const side of ['a', 'b']) byId('side-label-' + side).textContent = side.toUpperCase() + ' · ' + state[side].year;
  const values = {
    'denominator-a': matched ? number(pair.denominatorA) : '', 'denominator-b': matched ? number(pair.denominatorB) : '',
    'votes-a': matched ? number(metrics.votesA) : '', 'votes-b': matched ? number(metrics.votesB) : '',
    'share-a': matched ? percent(metrics.shareA) : '', 'share-b': matched ? percent(metrics.shareB) : '', 'delta-pp': matched ? signed(metrics.delta) : '', 'delta-votes': matched ? signedVotes(metrics.votesDelta) : '',
  };
  for (const [id, value] of Object.entries(values)) byId(id).textContent = value;
}
function renderPartyTable(pair) {
  const matched = pair.status === 'matched';
  byId('party-comparison-body').replaceChildren(...(matched ? Object.entries(parties).map(([id, name]) => {
    const metrics = groupMetrics(pair, id);
    const row = document.createElement('tr');
    row.dataset.party = id;
    row.classList.toggle('is-selected', id === state.party);
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = name;
    row.append(heading);
    for (const [field, value] of [['votes-a', number(metrics.votesA)], ['share-a', percent(metrics.shareA)], ['votes-b', number(metrics.votesB)], ['share-b', percent(metrics.shareB)], ['delta', signed(metrics.delta)], ['votes-delta', signedVotes(metrics.votesDelta)]]) {
      const cell = document.createElement('td');
      cell.dataset.field = field;
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }) : []));
  byId('party-table-wrap').hidden = !matched;
  byId('party-table-unavailable').hidden = matched;
  byId('party-table-unavailable').textContent = matched ? '' : reasons[pair.status];
  byId('party-table-context').textContent = `${currentNode().label} · A ${state.a.year} / B ${state.b.year} · cifras ficticias`;
  for (const side of ['a', 'b']) {
    byId('votes-' + side + '-heading').textContent = 'Votos ' + side.toUpperCase() + ' · ' + state[side].year;
    byId('share-' + side + '-heading').textContent = '% de votos positivos ' + side.toUpperCase();
  }
}
function renderChildCoverage() {
  const children = currentNode().childIds;
  const counts = {};
  for (const id of children) {
    const status = comparisonFor(id).status;
    counts[status] = (counts[status] || 0) + 1;
  }
  const summary = byId('child-coverage');
  summary.dataset.total = children.length;
  summary.dataset.comparable = counts.matched || 0;
  summary.textContent = children.length
    ? `${counts.matched || 0} de ${children.length} pares comparables`
    : 'Sin siguiente nivel. No hay pares hijos para comparar.';
  byId('coverage-reasons').replaceChildren(...Object.entries(counts).filter(([status]) => status !== 'matched').map(([status, count]) => {
    const item = document.createElement('li');
    item.dataset.status = status;
    item.dataset.count = count;
    item.textContent = `${labels[status]}: ${count}`;
    return item;
  }));
}
function renderChildTable() {
  const node = currentNode();
  let shown = 0;
  const children = node.childIds.map(id => {
    const pair = comparisonFor(id);
    return { id, pair, metrics: pair.status === 'matched' ? groupMetrics(pair) : null };
  }).sort((a, b) => {
    if (Boolean(a.metrics) !== Boolean(b.metrics)) return a.metrics ? -1 : 1;
    const deltaOrder = a.metrics ? state.tableOrder === 'delta-desc' ? b.metrics.delta - a.metrics.delta : a.metrics.delta - b.metrics.delta : 0;
    return deltaOrder || fixture.nodes[a.id].label.localeCompare(fixture.nodes[b.id].label, 'es') || a.id.localeCompare(b.id);
  });
  byId('child-comparison-body').replaceChildren(...children.map(({ id, pair, metrics }) => {
    const child = fixture.nodes[id], reference = referenceFor(id);
    const row = document.createElement('tr');
    row.dataset.nodeId = id;
    row.dataset.status = pair.status;
    row.hidden = !child.label.toLocaleLowerCase('es').includes(state.tableSearch);
    if (!row.hidden) shown++;
    const heading = document.createElement('th');
    heading.scope = 'row';
    const button = document.createElement('button');
    button.textContent = child.label;
    button.setAttribute('aria-label', 'Explorar ' + child.label);
    button.addEventListener('click', () => changeNode(id, true));
    heading.append(button);
    const status = document.createElement('td');
    status.className = 'state-cell';
    status.textContent = pair.status === 'matched' ? 'Par ficticio completo' : labels[pair.status];
    const cells = [['share-a', metrics ? percent(metrics.shareA) : ''], ['share-b', metrics ? percent(metrics.shareB) : ''], ['delta', metrics ? signed(metrics.delta) : ''], ['votes-delta', metrics ? signedVotes(metrics.votesDelta) : '']].map(([field, value]) => {
      const cell = document.createElement('td');
      cell.dataset.field = field;
      cell.textContent = value;
      return cell;
    });
    const quality = document.createElement('td');
    quality.className = 'reference-cell';
    quality.textContent = reference ? reference.geometryValid ? 'Referencia CNE' : 'Cartografía observada' : 'Unidad ficticia · sin geometría';
    if (reference?.geometryValid === false) quality.classList.add('observed-cell');
    row.append(heading, status, ...cells, quality);
    return row;
  }));
  byId('child-table-context').textContent = `${parties[state.party]} · A ${state.a.year} / B ${state.b.year} · ${shown} de ${node.childIds.length} territorios`;
  byId('child-empty').hidden = shown > 0;
  byId('child-empty').textContent = node.childIds.length ? 'No hay nombres que coincidan con el filtro.' : node.level === 'mesa' ? 'Fin del recorrido: no hay hijos de esta mesa ficticia.' : 'No se inventa un desglose para este agregado.';
  byId('child-search').disabled = node.childIds.length === 0;
  byId('child-order').disabled = node.childIds.length === 0;
}
function svgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
  return element;
}
function paintMap(mapId, cameraId, mode, path, referenceScope, children) {
  const node = currentNode(), map = byId(mapId), camera = byId(cameraId);
  const ownReference = referenceFor(referenceScope);
  const pair = comparisonFor(state.nodeId);
  const categorical = state.view === 'winners' && mode !== 'change';
  const ownMetrics = pair.status === 'matched' && !node.fictional && ownReference?.geometryValid !== false && !children.length ? groupMetrics(pair) : null;
  const ownLeader = categorical && ownMetrics && ownReference?.geometryValid === true ? uniqueLeader(pair[mode].votes) : null;
  const fill = categorical ? ownLeader ? winnerColors[ownLeader] : '#112b3a' : ownMetrics ? mode === 'change' ? changeColor(ownMetrics.delta) : shareColor(mode === 'a' ? ownMetrics.shareA : ownMetrics.shareB) : '#112b3a';
  const grid = svgElement('path', { d: Array.from({ length: 15 }, (_, i) => `M${i * 60} 0V600`).join('') + Array.from({ length: 11 }, (_, i) => `M0 ${i * 60}H860`).join(''), class: 'map-grid', 'aria-hidden': 'true' });
  const glow = svgElement('path', { d: path, class: 'reference-glow', 'aria-hidden': 'true' });
  const outline = svgElement('path', { d: path, class: 'reference-outline', fill, 'aria-hidden': 'true' });
  // A presentation attribute avoids the CSS base fill overriding the fixed scale's exact color.
  outline.style.fill = fill;
  if (ownLeader) outline.dataset.winner = ownLeader;
  if (ownReference?.geometryValid === false && !references[referenceScope]) outline.classList.add('source-observed');
  camera.replaceChildren(grid, glow, outline, ...children.map((reference, index) => {
    const pair = comparisonFor(reference.id), valid = reference.geometryValid && pair.status === 'matched';
    const leader = categorical && valid ? uniqueLeader(pair[mode].votes) : null;
    const metrics = !categorical && valid ? groupMetrics(pair) : null;
    const value = metrics ? mode === 'change' ? metrics.delta : mode === 'a' ? metrics.shareA : metrics.shareB : null;
    const shape = svgElement('path', { d: reference.path, class: 'child-shape', role: 'button', tabindex: index === 0 ? '0' : '-1' });
    shape.dataset.nodeId = reference.id;
    shape.dataset.status = pair.status;
    shape.style.fill = categorical ? leader ? winnerColors[leader] : '#182b36' : value === null ? '#182b36' : mode === 'change' ? changeColor(value) : shareColor(value);
    if (leader) shape.dataset.winner = leader;
    if (value !== null) shape.dataset.value = value;
    if (!reference.geometryValid) shape.classList.add('source-observed');
    const reading = categorical
      ? !reference.geometryValid ? 'Cartografía observada' : pair.status !== 'matched' ? labels[pair.status] : leader ? parties[leader] : 'Empate'
      : value === null ? reference.geometryValid ? labels[pair.status] : 'Cartografía observada' : mode === 'change' ? signed(value) : percent(value);
    shape.setAttribute('aria-label', `Explorar ${reference.label} en el mapa ${mode.toUpperCase()}. ${reading}. Muestra ficticia.`);
    shape.addEventListener('click', () => changeNode(reference.id, true));
    shape.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changeNode(reference.id, true); }
      else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        const next = camera.querySelectorAll('[data-node-id]')[(index + delta + children.length) % children.length];
        shape.setAttribute('tabindex', '-1');
        next.setAttribute('tabindex', '0');
        next.focus();
      }
    });
    return shape;
  }));
  map.dataset.referenceScope = referenceScope;
  // All matching reference paths have rendered before committing the current scope marker.
  map.dataset.scope = state.nodeId;
}
function renderMaps() {
  const node = currentNode(), referenceScope = node.fictional ? 'rosales' : state.nodeId;
  const path = references[referenceScope]?.path ?? referenceFor(referenceScope)?.scopePath;
  if (!path) throw new Error('No geographic reference for selected prototype node');
  const children = state.nodeId === 'argentina' ? geography.provinces : state.nodeId === 'buenos-aires' ? geography.partidos : [];
  paintMap('map-a', 'camera-a', 'a', path, referenceScope, children);
  paintMap('map-b', 'camera-b', 'b', path, referenceScope, children);
  paintMap('change-map', 'camera-change', 'change', path, referenceScope, children);
  byId('polar-reference').setAttribute('d', references.argentina.polarPath);
  byId('national-reference').hidden = state.nodeId !== 'argentina';
  const selectedReference = referenceFor(referenceScope);
  const observedSelected = selectedReference?.geometryValid === false && !references[referenceScope];
  byId('reference-note').textContent = node.fictional
    ? 'Sin ubicación territorial propia. Ambas vistas conservan únicamente la referencia ancestro de Coronel Rosales; no se dibujan zonas, escuelas ni mesas.'
    : observedSelected
      ? 'Cartografía observada: geometría de origen no válida, sin color de comparación. Las referencias y coberturas ficticias no establecen un cruce electoral oficial.'
      : 'Referencia geográfica independiente. ' + (children.some(reference => !reference.geometryValid) ? 'Las entidades con cartografía observada se mantienen neutrales. ' : '') + 'Las referencias y coberturas ficticias no establecen un cruce electoral oficial.';
  byId('map-subtitle').textContent = node.fictional ? 'Referencia ancestro: Coronel Rosales · sin geometría propia' : node.label + ' · referencia independiente';
  fitReference();
}
function fitReference() {
  // Geometry measurements require a rendered SVG, not the hidden paired view.
  const camera = byId(state.view === 'change' ? 'camera-change' : 'camera-a');
  const shapes = [...camera.querySelectorAll('.reference-outline,.child-shape')];
  const bounds = shapes.map(shape => shape.getBBox()).filter(box => box.width > 0 && box.height > 0);
  if (!bounds.length) return;
  const left = Math.min(...bounds.map(box => box.x)), top = Math.min(...bounds.map(box => box.y));
  const right = Math.max(...bounds.map(box => box.x + box.width)), bottom = Math.max(...bounds.map(box => box.y + box.height));
  const padding = Math.max(right - left, bottom - top) * .055;
  state.frame = { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
  const { x, y, width, height } = state.frame;
  for (const id of ['map-a', 'map-b', 'change-map']) byId(id).setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
}
function renderCamera() {
  if (!state.frame) return;
  const { x, y, width, height } = state.frame;
  const cx = x + width / 2, cy = y + height / 2;
  const limitX = width * (state.zoom - 1) / 2, limitY = height * (state.zoom - 1) / 2;
  state.panX = Math.max(-limitX, Math.min(limitX, state.panX));
  state.panY = Math.max(-limitY, Math.min(limitY, state.panY));
  const transform = `translate(${cx + state.panX} ${cy + state.panY}) scale(${state.zoom}) translate(${-cx} ${-cy})`;
  for (const id of ['camera-a', 'camera-b', 'camera-change']) byId(id).setAttribute('transform', transform);
  for (const id of ['map-a', 'map-b', 'change-map']) {
    const map = byId(id);
    map.classList.toggle('is-pannable', state.zoom > 1);
    map.style.touchAction = state.zoom > 1 ? 'none' : 'pan-y';
  }
  for (const button of document.querySelectorAll('.pan-control')) button.disabled = state.zoom === 1 || !fixture;
}
function resetCamera() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  renderCamera();
}
function panCamera(dx, dy) {
  if (!state.frame) return;
  state.panX += dx;
  state.panY += dy;
  renderCamera();
}
function bindPointerPan(map) {
  let drag = null, suppressClick = false;
  map.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || state.zoom === 1 || !fixture) return;
    const matrix = map.getScreenCTM();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, scale: matrix.a, moved: false };
  });
  map.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) map.setPointerCapture(event.pointerId);
    drag.moved = true;
    map.classList.add('is-dragging');
    panCamera(dx / drag.scale, dy / drag.scale);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    drag = null;
    map.classList.remove('is-dragging');
    if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  };
  map.addEventListener('pointerup', finish);
  map.addEventListener('pointercancel', finish);
  map.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
function renderView() {
  const change = state.view === 'change', winners = state.view === 'winners';
  byId('paired-maps').hidden = change;
  byId('difference-view').hidden = !change;
  byId('share-legend').hidden = change || winners;
  byId('change-legend').hidden = !change;
  byId('winner-legend').hidden = !winners;
  byId('winner-details').hidden = !winners || !fixture;
  byId('share-view').setAttribute('aria-pressed', String(!change && !winners));
  byId('change-view').setAttribute('aria-pressed', String(change));
  byId('winner-view').setAttribute('aria-pressed', String(winners));
  for (const side of ['a', 'b']) {
    byId('map-' + side).dataset.scale = winners ? 'categorical' : '0-100';
    byId('map-' + side).setAttribute('aria-label', (winners ? 'Mapa de ganadores ficticios ' : 'Mapa del porcentaje de votos positivos ') + side.toUpperCase());
    byId('map-' + side + '-caption').textContent = winners ? 'Líder único · muestra ficticia' : 'Escala fija · 0 a 100 %';
  }
  byId('map-heading').textContent = winners ? 'Ganadores de muestras ficticias' : (change ? 'Cambio de ' : 'Porcentaje de votos positivos de ') + parties[state.party];
  byId('map-view-note').textContent = winners ? 'Líder único ficticio · sin equivalencia electoral oficial' : 'Sin ganador implícito · solo participación';
}
function render() {
  const node = currentNode(), pair = comparisonFor(state.nodeId);
  byId('detail-title').textContent = node.label;
  byId('level-label').textContent = levels[node.level];
  byId('detail-reference').textContent = node.fictional ? 'Unidad ficticia · referencia ancestro de Coronel Rosales' : 'Referencia territorial · muestras ficticias';
  for (const option of [...byId('territory').options]) if (option.dataset.current) option.remove();
  if (!['argentina', 'buenos-aires', 'rosales'].includes(state.nodeId)) {
    const option = new Option(node.label, state.nodeId);
    option.dataset.current = 'true';
    byId('territory').add(option);
  }
  byId('territory').value = state.nodeId;
  for (const side of ['a', 'b']) {
    byId('map-' + side + '-title').textContent = state[side].year + ' · muestra ' + side.toUpperCase();
    byId('map-' + side + '-context').textContent = categories[state[side].category];
  }
  byId('change-context').textContent = `B ${state.b.year} menos A ${state.a.year} · puntos porcentuales`;
  renderTrail(byId('top-trail'), false);
  renderNavigator();
  renderFigures(pair);
  renderWinnerSummary(pair);
  renderPartyTable(pair);
  renderChildCoverage();
  renderChildTable();
  renderMaps();
  renderCamera();
  renderView();
  byId('evidence-context').textContent = `${node.label}: A ${state.a.year} / ${categories[state.a.category]}, B ${state.b.year} / ${categories[state.b.category]}. ${reasons[pair.status]}`;
  byId('evidence-geography').textContent = node.fictional ? 'Unidad de demostración sin ubicación propia. Únicamente contorno ancestro de Coronel Rosales.' : 'Referencias IGN y CNE preservadas: 538 entidades CNE, 22 geometrías observadas, sin reparación ni eliminación. Argentina conserva los 1.980 componentes en su referencia polar independiente. Aplicabilidad electoral por año desconocida.';
}
function changeNode(id, focusNavigator = false) {
  if (!fixture) { if (['argentina', 'buenos-aires', 'rosales'].includes(id)) state.nodeId = id; return; }
  if (!fixture.nodes[id]) return;
  state.nodeId = id;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  state.navigatorSearch = '';
  state.tableSearch = '';
  byId('child-search').value = '';
  render();
  byId('navigator-children').scrollTop = 0;
  if (focusNavigator) {
    byId('navigator-title').focus();
    byId('navigator-title').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
}
byId('territory').addEventListener('change', event => changeNode(event.target.value));
byId('party').addEventListener('change', event => { state.party = event.target.value; if (fixture) render(); });
for (const side of ['a', 'b']) for (const [input, key] of [['year', 'year'], ['category', 'category']]) byId(input + '-' + side).addEventListener('change', event => {
  state[side][key] = event.target.value;
  if (fixture) render();
});
byId('swap-contexts').addEventListener('click', () => {
  [state.a, state.b] = [state.b, state.a];
  for (const side of ['a', 'b']) { byId('year-' + side).value = state[side].year; byId('category-' + side).value = state[side].category; }
  if (fixture) render();
});
byId('navigator-search').addEventListener('input', event => {
  state.navigatorSearch = event.target.value.trim().toLocaleLowerCase('es');
  if (fixture) { renderNavigatorChildren(); byId('navigator-children').scrollTop = 0; }
});
byId('child-search').addEventListener('input', event => { state.tableSearch = event.target.value.trim().toLocaleLowerCase('es'); if (fixture) renderChildTable(); });
byId('child-order').addEventListener('change', event => { state.tableOrder = event.target.value; if (fixture) renderChildTable(); });
for (const [id, view] of [['share-view', 'share'], ['change-view', 'change'], ['winner-view', 'winners']]) byId(id).addEventListener('click', () => {
  state.view = view;
  renderView();
  if (fixture) { renderMaps(); renderCamera(); renderWinnerSummary(comparisonFor(state.nodeId)); }
});
for (const [name, delta] of [['Acercar mapas', .2], ['Alejar mapas', -.2]]) document.querySelector(`[aria-label="${name}"]`).addEventListener('click', () => { state.zoom = Math.max(1, Math.min(3, state.zoom + delta)); renderCamera(); });
document.querySelector('[aria-label="Restablecer vista"]').addEventListener('click', resetCamera);
for (const [name, dx, dy] of [['Desplazar mapas a la izquierda', -.12, 0], ['Desplazar mapas a la derecha', .12, 0], ['Desplazar mapas hacia arriba', 0, -.12], ['Desplazar mapas hacia abajo', 0, .12]]) {
  document.querySelector(`[aria-label="${name}"]`).addEventListener('click', () => {
    if (state.frame) panCamera(dx * state.frame.width, dy * state.frame.height);
  });
}
for (const id of ['map-a', 'map-b', 'change-map']) bindPointerPan(byId(id));
const evidence = byId('evidence-dialog'), navigation = byId('navigation-dialog');
byId('evidence-trigger').addEventListener('click', () => evidence.showModal());
byId('evidence-close').addEventListener('click', () => evidence.close());
document.querySelector('[aria-label="Abrir navegación"]').addEventListener('click', () => navigation.showModal());
byId('navigation-close').addEventListener('click', () => navigation.close());
navigation.querySelector('.active').addEventListener('click', () => navigation.close());
async function localJson(path) {
  const response = await fetch('./assets/' + path);
  if (!response.ok) throw new Error('Local prototype asset unavailable');
  return response.json();
}
async function initialize() {
  try {
    [fixture, policy, geography, references] = await Promise.all(['demo-results.json', 'comparison-policy.json', 'winner-reference-paths.json', 'reference-paths.json'].map(localJson));
    if (fixture.source.kind !== 'demonstration' || policy.source.kind !== 'demonstration' || policy.correspondence.kind !== 'synthetic-only' || Object.keys(fixture.nodes).length !== 174 || geography.provinces.length !== 24 || geography.partidos.length !== 135) throw new Error('Prototype input contract mismatch');
    render();
  } catch {
    fixture = null; policy = null; geography = null; references = null;
    for (const [map, camera] of [['map-a', 'camera-a'], ['map-b', 'camera-b'], ['change-map', 'camera-change']]) {
      byId(camera).replaceChildren();
      byId(map).removeAttribute('data-scope');
      byId(map).removeAttribute('data-reference-scope');
    }
    byId('comparison-status').dataset.status = 'unavailable';
    byId('status-title').textContent = 'Comparación no disponible';
    byId('status-reason').textContent = 'No se pudieron cargar las muestras, referencias o política locales. Recarga la maqueta para volver a intentar; no se muestra un sustituto.';
    for (const id of ['denominator-a', 'denominator-b', 'votes-a', 'votes-b', 'share-a', 'share-b', 'delta-pp', 'delta-votes']) byId(id).textContent = '';
    byId('paired-figures').hidden = true;
    byId('winner-details').hidden = true;
    for (const side of ['a', 'b']) byId('winner-' + side).textContent = '';
    byId('party-comparison-body').replaceChildren();
    byId('child-comparison-body').replaceChildren();
    byId('child-coverage').removeAttribute('data-total');
    byId('child-coverage').removeAttribute('data-comparable');
    byId('child-coverage').textContent = 'Comparabilidad del siguiente nivel no disponible. El árbol local no está cargado.';
    byId('coverage-reasons').replaceChildren();
    byId('child-order').disabled = true;
    byId('navigator-route').replaceChildren();
    byId('navigator-children').replaceChildren();
    byId('navigator-parent').hidden = true;
    byId('navigator-search-wrap').hidden = true;
    byId('navigator-title').textContent = 'Recorrido no disponible';
    byId('navigator-empty').hidden = false;
    byId('navigator-empty').textContent = 'El árbol local no está cargado; no se inventa una navegación alternativa.';
    byId('national-reference').hidden = true;
    byId('map-subtitle').textContent = 'Referencias locales indisponibles';
    byId('detail-title').textContent = 'Vista no disponible';
    byId('mobile-reading').textContent = 'Comparación no disponible. No se pudieron cargar las muestras, referencias o política locales. Recarga para volver a intentar.';
    for (const button of document.querySelectorAll('.pan-control')) button.disabled = true;
  }
}
initialize();
