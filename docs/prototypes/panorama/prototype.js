import { validateAssets } from './assets/evidence-model.js';
import { PARTIES, ancestors, geometryFor, overviewChildren, overviewResult, overviewShapes, selectionInsights } from './panorama-model.js';

const byId = id => document.getElementById(id);
const integer = new Intl.NumberFormat('es-AR');
const decimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const state = { nodeId: 'argentina', year: '2025', category: 'national-deputies', mode: 'demonstration', search: '', page: 0, phase: 'loading' };
const PAGE_SIZE = 12;
let assets = null;
let activeMapNode = null;
const stateLabels = { complete: 'Completa en la muestra', partial: 'Parcial en la muestra', missing: 'Sin datos en la muestra', unknown: 'Datos reales no consultados', loading: 'Cargando muestra', unavailable: 'Muestra local no disponible', error: 'Muestra local no válida' };
const outcomeLabels = { winner: 'Primer lugar completo', provisional: 'En cabeza · parcial', tie: 'Empate en primer lugar', zero: 'Cero votos', missing: 'Sin datos', unknown: 'No consultado' };
const overviewControls = ['evidence-mode', 'territory', 'base-year', 'category'];

function text(id, value) { byId(id).textContent = value; }
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function clearSummary() {
  for (const id of ['positive-votes', 'leader-name', 'leader-share', 'lead-margin', 'coverage-ratio', 'coverage-percent']) text(id, '—');
  text('leader-label', 'Primer lugar de la muestra');
  text('coverage-unit', 'Sin unidad confirmada');
  text('coverage-note', 'No se conoce la cobertura alojada ni un denominador oficial esperado.');
  byId('party-distribution').replaceChildren();
}

function renderUnavailable() {
  clearSummary();
  text('evidence-status', stateLabels[state.phase]);
  byId('evidence-status').dataset.state = state.phase;
  const loading = state.phase === 'loading';
  const explanation = loading ? 'Cargando y validando la muestra local. No hay cifras disponibles.'
    : state.phase === 'unavailable' ? 'No se pudo obtener la muestra local. Esto no describe la cobertura de Votus.'
      : 'Los archivos locales no cumplen el contrato de esta muestra. No se muestran resultados.';
  text('scope-notice', explanation);
  text('mobile-summary', stateLabels[state.phase] + '. ' + explanation);
  text('status-explanation', explanation);
  text('map-reading', loading ? 'Sin muestra validada' : 'No hay resultados validados');
  byId('insights-list').replaceChildren(element('li', explanation));
  byId('territory-body').replaceChildren();
  byId('map-shapes').replaceChildren();
  fitMap();
  byId('polar-reference').hidden = true;
  text('map-description', explanation);
  text('row-count', 'Sin filas disponibles');
  text('table-empty', explanation);
  byId('table-empty').hidden = false;
  text('page-number', '—');
  byId('previous-page').disabled = true;
  byId('next-page').disabled = true;
  byId('territory-search').disabled = true;
  byId('retry').hidden = loading;
  overviewControls.forEach(id => { byId(id).disabled = true; });
}

function renderContext() {
  const node = assets.fixture.nodes[state.nodeId];
  text('selected-heading', node.label);
  const roots = ['argentina', 'buenos-aires', 'rosales'];
  if (!roots.includes(state.nodeId)) roots.push(state.nodeId);
  byId('territory').replaceChildren(...roots.map(id => {
    const option = element('option', assets.fixture.nodes[id].label);
    option.value = id;
    option.selected = id === state.nodeId;
    return option;
  }));
  const crumbs = [];
  for (const id of ancestors(assets, state.nodeId)) {
    if (crumbs.length) crumbs.push(element('span', '/'));
    const button = element('button', assets.fixture.nodes[id].label);
    button.type = 'button';
    button.addEventListener('click', () => selectNode(id));
    if (id === state.nodeId) { button.className = 'current'; button.setAttribute('aria-current', 'location'); }
    crumbs.push(button);
  }
  byId('breadcrumbs').replaceChildren(...crumbs);
  text('map-title', 'Mapa de referencia de ' + node.label);
  text('map-subtitle', state.nodeId === 'argentina' ? 'Provincias de referencia · encuadre continental'
    : state.nodeId === 'buenos-aires' ? '135 partidos de referencia · no cruce electoral histórico'
      : 'Contorno de referencia · detalle inferior fuera de Panorama');
  byId('territory-map').dataset.scope = state.nodeId;
}

function renderSummary() {
  clearSummary();
  if (state.mode === 'unknown') {
    byId('evidence-status').dataset.state = 'unknown';
    text('evidence-status', stateLabels.unknown);
    text('status-explanation', 'No se consultaron resultados, cobertura ni permisos de la base alojada. Desconocido no significa vacío.');
    byId('insights-list').replaceChildren(element('li', 'No se consultaron datos reales. No hay cifras, ganadores ni cobertura oficial que puedan afirmarse aquí.'), element('li', 'Los contornos son referencias geográficas; su equivalencia electoral histórica no está verificada.'));
    return;
  }
  const result = overviewResult(assets, state.nodeId, state.year, state.category);
  byId('evidence-status').dataset.state = result.state;
  text('evidence-status', stateLabels[result.state]);
  text('status-explanation', result.state === 'partial' ? 'Solo representa los votos presentes. El primer lugar es provisional.'
    : result.state === 'missing' ? 'No hay un vector de votos para esta selección. No equivale a cero votos.'
      : 'Registro completo dentro de la muestra ficticia, no cobertura oficial certificada.');
  text('positive-votes', result.totalVotes === null ? '—' : integer.format(result.totalVotes));
  text('coverage-ratio', `${result.coverage.reported}/${result.coverage.total}`);
  text('coverage-percent', result.percent === null ? '—' : decimal.format(result.percent) + ' %');
  text('coverage-unit', result.unit);
  text('coverage-note', result.percent === null ? 'Tipo de unidad no documentado; no se calcula un porcentaje. No describe la cobertura oficial.' : 'Cobertura de la muestra; no equivale a cobertura de mesas oficiales.');
  text('leader-label', result.outcome === 'provisional' ? 'En cabeza de la muestra parcial' : 'Primer lugar de la muestra');
  text('leader-name', result.leader?.name ?? outcomeLabels[result.outcome]);
  text('leader-share', result.share === null ? '—' : decimal.format(result.share) + ' %');
  text('lead-margin', result.margin === null ? '—' : decimal.format(result.margin) + ' pp');
  for (const party of result.distribution) {
    const item = element('li');
    const meter = element('meter');
    meter.min = 0; meter.max = 100; meter.value = party.share;
    meter.dataset.party = party.id;
    meter.style.setProperty('--party-color', party.color);
    meter.setAttribute('aria-label', party.name + ': ' + integer.format(party.votes) + ' votos ficticios');
    item.append(element('span', party.name), element('span', decimal.format(party.share) + ' %', 'party-share'), meter);
    byId('party-distribution').append(item);
  }
  byId('insights-list').replaceChildren(...selectionInsights(assets, state.nodeId, result).map(insight => element('li', insight)));
}

function fitMap() {
  const svg = byId('territory-map');
  const group = byId('map-shapes');
  let frame = [0, 0, 900, 650];
  if (group.children.length) {
    const box = group.getBBox();
    if (box.width > 0 && box.height > 0) {
      const paddingX = box.width * .055;
      const paddingY = box.height * .055;
      frame = [box.x - paddingX, box.y - paddingY, box.width + 2 * paddingX, box.height + 2 * paddingY];
    }
  }
  svg.setAttribute('viewBox', frame.join(' '));
  ['x', 'y', 'width', 'height'].forEach((name, index) => byId('map-grid-background').setAttribute(name, frame[index]));
}

function roveMap(path, focus = false) {
  activeMapNode = path.dataset.node;
  for (const candidate of byId('map-shapes').children) candidate.setAttribute('tabindex', candidate === path ? '0' : '-1');
  if (focus) path.focus();
}

function moveMapFocus(path, key) {
  const paths = [...byId('map-shapes').children];
  let target;
  if (key === 'Home') target = paths[0];
  else if (key === 'End') target = paths.at(-1);
  else {
    const origin = path.getBBox();
    const x = origin.x + origin.width / 2;
    const y = origin.y + origin.height / 2;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    // Directional neighbors come from the rendered reference geometry, not a fabricated hierarchy.
    const candidates = paths.filter(candidate => candidate !== path).map(candidate => {
      const box = candidate.getBBox();
      const dx = box.x + box.width / 2 - x;
      const dy = box.y + box.height / 2 - y;
      return { path: candidate, forward: sign * (horizontal ? dx : dy), score: Math.hypot(dx, dy) + 2 * Math.abs(horizontal ? dy : dx) };
    }).filter(candidate => candidate.forward > .01).sort((a, b) => a.score - b.score);
    target = candidates[0]?.path;
  }
  if (target) roveMap(target, true);
}

function renderMobileReading() {
  const node = assets.fixture.nodes[state.nodeId];
  const category = byId('category').selectedOptions[0].textContent;
  const result = state.mode === 'demonstration' ? overviewResult(assets, state.nodeId, state.year, state.category) : null;
  const reading = result ? stateLabels[result.state] + '. ' + outcomeLabels[result.outcome] + '. Resultados ficticios.'
    : 'Datos reales no consultados. No hay resultado ni cobertura oficial confirmada.';
  text('mobile-summary', `${node.label} · ${state.year} · ${category}. ${reading}`);
}

function renderMap() {
  const shapes = overviewShapes(assets, state.nodeId, state.year, state.category, state.mode);
  if (!shapes.some(shape => shape.id === activeMapNode)) activeMapNode = shapes[0]?.id ?? null;
  byId('map-shapes').replaceChildren(...shapes.map(shape => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shape.path);
    path.setAttribute('class', 'reference-shape' + (!shape.geometryValid ? ' source-observed' : '') + (shape.id === state.nodeId ? ' selected-reference' : ''));
    path.dataset.node = shape.id;
    path.dataset.state = shape.state;
    path.dataset.outcome = shape.outcome;
    if (shape.winner) path.dataset.winner = shape.winner.id;
    const label = assets.fixture.nodes[shape.id].label;
    const reading = shape.winner?.name ?? outcomeLabels[shape.outcome];
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', shape.id === activeMapNode ? '0' : '-1');
    path.setAttribute('aria-label', `Inspeccionar ${label}. ${reading}. ${shape.geometryValid ? 'Referencia válida' : 'Referencia observada, sin color de ganador'}.`);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label + ' · ' + reading;
    path.append(title);
    path.addEventListener('focus', () => roveMap(path));
    path.addEventListener('click', () => selectNode(shape.id));
    path.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(shape.id); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); moveMapFocus(path, event.key); }
    });
    return path;
  }));
  fitMap();
  const observed = shapes.filter(shape => !shape.geometryValid).length;
  text('map-reading', state.mode === 'unknown' ? 'Referencias neutrales · datos reales no consultados'
    : `${shapes.length} referencias · ${shapes.filter(shape => shape.winner).length} con primer lugar coloreado`);
  text('map-description', 'Referencias territoriales conservadas. Solo resultados completos, positivos y únicos con geometría válida reciben color de agrupación. Use las flechas, Inicio y Fin para recorrer el mapa; Enter o Espacio inspecciona. Todas las unidades se pueden elegir también en la lista.');
  text('geometry-note', `${observed} ${observed === 1 ? 'referencia observada conservada' : 'referencias observadas conservadas'} sin color de ganador. Una referencia válida no acredita equivalencia electoral histórica.`);
  const national = state.nodeId === 'argentina';
  byId('polar-reference').hidden = !national;
  if (national) byId('polar-shape').setAttribute('d', assets.references.argentina.polarPath);
}

function renderRows() {
  const children = overviewChildren(assets, state.nodeId);
  const term = state.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = children.filter(id => assets.fixture.nodes[id].label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(term));
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  state.page = Math.max(0, Math.min(state.page, pageCount - 1));
  const visible = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  byId('territory-body').replaceChildren(...visible.map(id => {
    const node = assets.fixture.nodes[id];
    const result = state.mode === 'demonstration' ? overviewResult(assets, id, state.year, state.category) : null;
    const row = element('tr'); row.dataset.node = id;
    const heading = element('th'); heading.scope = 'row';
    const inspect = element('button', node.label); inspect.type = 'button';
    inspect.setAttribute('aria-label', 'Inspeccionar ' + node.label);
    inspect.addEventListener('click', () => selectNode(id)); heading.append(inspect);
    const outcome = element('td', result?.leader ? result.leader.name + (result.outcome === 'provisional' ? ' · en cabeza, parcial' : '') : outcomeLabels[result?.outcome ?? 'unknown']);
    outcome.dataset.field = 'outcome';
    const availability = element('td', stateLabels[result?.state ?? 'unknown']); availability.dataset.state = result?.state ?? 'unknown';
    const geometry = element('td', geometryFor(assets, id).state === 'observed' ? 'Observada · contorno neutral' : 'Válida · referencia'); geometry.dataset.field = 'geometry';
    row.append(heading, outcome, availability, geometry); return row;
  }));
  text('row-count', `${visible.length} visibles · ${filtered.length} coinciden · ${children.length} unidades totales`);
  text('children-note', state.nodeId === 'argentina' ? '24 provincias/CABA. Todas las referencias permanecen disponibles, incluso las observadas.'
    : state.nodeId === 'buenos-aires' ? '135 partidos. El resultado provincial no se recalcula desde esta lista.'
      : assets.fixture.nodes[state.nodeId].level === 'partido' ? 'Panorama termina en el partido. Continúe en Exploración para recorrer circuitos, establecimientos y mesas.'
        : 'No hay desglose inferior para esta provincia en la muestra de Panorama.');
  byId('table-empty').hidden = visible.length > 0;
  text('table-empty', children.length === 0 ? 'Sin unidades inferiores en Panorama. Puede volver con el recorrido territorial o continuar en Exploración.' : 'Ningún territorio coincide con la búsqueda.');
  byId('territory-search').disabled = children.length === 0;
  byId('previous-page').disabled = state.page === 0 || pageCount === 0;
  byId('next-page').disabled = state.page + 1 >= pageCount;
  text('page-number', pageCount ? `${state.page + 1} / ${pageCount}` : 'Sin páginas');
}

function render() {
  if (state.phase !== 'ready') { renderUnavailable(); return; }
  overviewControls.forEach(id => { byId(id).disabled = false; });
  byId('retry').hidden = true;
  byId('scope-notice').dataset.mode = state.mode;
  text('scope-notice', state.mode === 'unknown' ? 'Datos reales no consultados. No se verificaron la cobertura ni los permisos de la base alojada.' : assets.policy.demonstration.notice);
  renderContext(); renderSummary(); renderMap(); renderRows(); renderMobileReading();
}

function selectNode(id) {
  if (!assets || !['country', 'province', 'partido'].includes(assets.fixture.nodes[id]?.level)) return;
  state.nodeId = id; state.search = ''; state.page = 0;
  byId('territory-search').value = '';
  render(); byId('selected-heading').focus();
}

async function loadAssets(retrying = false) {
  state.phase = 'loading'; renderUnavailable();
  try {
    const responses = await Promise.all(['evidence-policy.json', 'demo-results.json', 'reference-paths.json', 'winner-reference-paths.json'].map(name => fetch('./assets/' + name, { cache: 'no-store' })));
    if (responses.some(response => !response.ok)) { state.phase = 'unavailable'; throw new Error('Local asset unavailable'); }
    const values = await Promise.all(responses.map(response => response.json()));
    assets = validateAssets(...values); state.phase = 'ready'; render();
    if (retrying) byId('selected-heading').focus();
  } catch {
    if (state.phase !== 'unavailable') state.phase = 'error';
    renderUnavailable();
    if (retrying) byId('retry').focus();
  }
}

byId('evidence-mode').addEventListener('change', event => { state.mode = event.target.value; render(); });
byId('territory').addEventListener('change', event => selectNode(event.target.value));
byId('base-year').addEventListener('change', event => { state.year = event.target.value; render(); });
byId('category').addEventListener('change', event => { state.category = event.target.value; render(); });
byId('territory-search').addEventListener('input', event => { state.search = event.target.value; state.page = 0; renderRows(); });
byId('previous-page').addEventListener('click', () => { state.page--; renderRows(); byId('territory-search').focus(); });
byId('next-page').addEventListener('click', () => { state.page++; renderRows(); byId('territory-search').focus(); });
byId('retry').addEventListener('click', () => loadAssets(true));
const drawer = byId('navigation-dialog');
byId('navigation-open').addEventListener('click', () => drawer.showModal());
byId('navigation-close').addEventListener('click', () => drawer.close());
drawer.addEventListener('close', () => byId('navigation-open').focus());
drawer.querySelectorAll('a').forEach(link => link.addEventListener('click', () => drawer.close()));
const mobileQuery = window.matchMedia('(max-width: 650px)');
mobileQuery.addEventListener('change', event => { if (!event.matches && drawer.open) { drawer.close(); byId('selected-heading').focus(); } });
byId('map-legend').replaceChildren(...[
  ...PARTIES.map(party => [party.id, party.name]), ['partial', 'Parcial · neutral'], ['missing', 'Sin datos'],
  ['tie', 'Empate'], ['zero', 'Cero votos'], ['observed', 'Referencia observada']
].map(([key, label]) => { const item = element('span'); const swatch = element('i', undefined, 'legend-' + key); swatch.setAttribute('aria-hidden', 'true'); item.append(swatch, document.createTextNode(label)); return item; }));
loadAssets();
