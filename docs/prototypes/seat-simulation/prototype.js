import { PARTIES, MAX_DRAW_SEATS, MAX_DRAW_WORK, MUNICIPAL_CONTEXT, baselineVotes, unitBaseline, transferVotes, allocateScenario, sensitivityPlan } from './simulation-model.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('es-AR').format(value);
const percent = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' %';
const decimal = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(value);
const state = { fixture: null, contexts: null, capabilities: null, references: null, geography: null, scope: 'rosales', nodeId: 'rosales', unitId: '', category: 'concejales', year: '2025', mapView: 'scenario', base: null, context: null, baseAllocation: null, scenario: null, allocation: null, status: 'loading', reason: '', amount: 0, samples: null };
const svgNS = 'http://www.w3.org/2000/svg';
let parentHypothesis = null;

function text(id, value) { $(id).textContent = value; }
function element(tag, content, attributes = {}) {
  const node = document.createElement(tag);
  if (content !== null) node.textContent = content;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
function isBroadScope() { return state.scope !== 'rosales'; }
function selectedUnit() { return state.contexts?.contexts[state.scope]?.units.find(unit => unit.id === state.unitId); }
function isScenarioContext() { return isBroadScope() ? Boolean(selectedUnit()) : state.nodeId === 'rosales'; }
function isEditable() { return Boolean(state.fixture && state.base && state.context && isScenarioContext()); }

function clearSamples() {
  state.samples = null;
  $('sweep-body').replaceChildren();
  $('sweep-status').dataset.status = 'idle';
  text('sweep-status', 'Sin muestras calculadas.');
  text('sweep-note', `Hasta 21 muestras y 600 posiciones de cálculo (muestras × ${state.context?.seatsToFill ?? 'bancas de la unidad'} × 4 agrupaciones).`);
}

function resetInputs() {
  $('donor').value = 'b';
  $('target').value = 'a';
  $('amount').value = '0';
  state.amount = 0;
  state.reason = '';
  text('transfer-error', '');
  clearSamples();
}

function useBaseline(preserveHypothesis = false) {
  if (!preserveHypothesis) parentHypothesis = null;
  state.base = null;
  state.context = null;
  state.baseAllocation = null;
  state.scenario = null;
  state.allocation = null;
  resetInputs();
  if (!state.fixture) return;
  if (!isScenarioContext()) {
    state.status = !isBroadScope() && state.nodeId !== 'rosales' ? 'inspection-only' : 'context-only';
    render();
    return;
  }
  try {
    if (isBroadScope()) {
      const sample = unitBaseline(state.contexts, state.scope, state.unitId, state.year, state.category);
      state.base = sample;
      state.context = sample.context;
    } else {
      state.base = baselineVotes(state.fixture, state.year);
      state.context = MUNICIPAL_CONTEXT;
    }
    state.scenario = { ...state.base.votes };
    state.baseAllocation = allocateScenario(state.base.votes, state.context);
    state.allocation = state.baseAllocation;
    state.status = 'ready';
  } catch (error) {
    state.scenario = null;
    state.allocation = null;
    state.status = 'blocked';
    state.reason = error.message;
  }
  render();
}

function inspectTerritory(childId) {
  if (state.nodeId === 'rosales') {
    const { scope, year, category, base, context, baseAllocation, scenario, allocation, status, reason, amount, mapView } = state;
    parentHypothesis = { scope, year, category, base, context, baseAllocation, scenario, allocation, status, reason, amount, mapView,
      donor: $('donor').value, target: $('target').value, amountText: $('amount').value };
  }
  state.nodeId = childId;
  useBaseline(true);
  $('inspection-heading').setAttribute('tabindex', '-1');
  $('inspection-heading').focus({ preventScroll: true });
}

function returnToParent() {
  const saved = parentHypothesis;
  parentHypothesis = null;
  state.scope = 'rosales';
  state.nodeId = 'rosales';
  $('territory').value = 'rosales';
  if (!saved || saved.year !== state.year || saved.category !== state.category) {
    useBaseline();
    return;
  }
  const { donor, target, amountText, ...hypothesis } = saved;
  Object.assign(state, hypothesis);
  $('donor').value = donor;
  $('target').value = target;
  $('amount').value = amountText;
  text('transfer-error', ['invalid', 'blocked'].includes(state.status) ? state.reason : '');
  clearSamples();
  render();
  $('scenario-heading').focus({ preventScroll: true });
}

function winner(votes) {
  if (!votes) return null;
  const maximum = Math.max(...Object.values(votes));
  const ids = Object.keys(votes).filter(id => votes[id] === maximum);
  return maximum > 0 && ids.length === 1 ? PARTIES.find(p => p.id === ids[0]) : null;
}

function renderMap() {
  const deep = !isBroadScope() && state.nodeId !== 'rosales';
  const scope = deep ? 'rosales' : state.scope;
  const unit = selectedUnit();
  const label = unit?.label ?? state.fixture?.nodes?.[state.nodeId]?.label ?? 'Coronel Rosales';
  $('territory-map').dataset.scope = deep ? state.nodeId : state.scope;
  if (deep) $('territory-map').dataset.referenceScope = 'rosales';
  else if (scope === 'buenos-aires') $('territory-map').dataset.referenceScope = 'buenos-aires';
  else delete $('territory-map').dataset.referenceScope;
  text('map-heading', label);
  text('map-subtitle', deep ? 'Contorno ancestral de Rosales · sin ubicación propia' : scope === 'rosales' ? 'Referencia geográfica del partido' : scope === 'buenos-aires' && unit ? 'Contorno provincial ancestral · sección sin polígono validado' : 'Distritos independientes · sin reparto agregado');
  text('map-title', deep ? `Contorno de Coronel Rosales, referencia ancestral de ${label}` : `Referencia territorial de ${label}`);
  $('map-shapes').replaceChildren();
  const reference = state.references?.[scope];
  if (!reference) return;
  const elected = state.status === 'ready' && isScenarioContext()
    ? winner(state.mapView === 'base' ? state.base.votes : state.scenario) : null;
  let geometryValid = false;
  function appendShape(path, attributes = {}) {
    const shape = document.createElementNS(svgNS, 'path');
    shape.setAttribute('d', path);
    shape.setAttribute('class', 'reference-shape');
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    $('map-shapes').append(shape);
    return shape;
  }
  if (scope === 'argentina') {
    appendShape(reference.path, { class: 'national-outline' });
    for (const province of state.geography.provinces) {
      const shape = appendShape(province.path, { 'data-unit': province.id });
      if (province.geometryValid !== true) shape.classList.add('source-observed');
      if (unit?.referenceId === province.id) {
        shape.classList.add('selected-reference');
        geometryValid = province.geometryValid === true;
        if (elected && geometryValid) shape.dataset.winner = elected.id;
      }
    }
  } else {
    const shape = appendShape(reference.path);
    geometryValid = scope === 'rosales' && state.geography?.partidos.find(p => p.id === 'rosales')?.geometryValid === true;
    if (elected && geometryValid && !deep) shape.dataset.winner = elected.id;
  }
  $('view-base').disabled = !isScenarioContext() || state.status !== 'ready';
  $('view-scenario').disabled = !isScenarioContext() || state.status !== 'ready';
  $('view-base').setAttribute('aria-pressed', String(state.mapView === 'base'));
  $('view-scenario').setAttribute('aria-pressed', String(state.mapView === 'scenario'));
  const winnerLabel = elected && geometryValid ? `${state.mapView === 'base' ? 'Base' : 'Escenario'}: ${elected.name} encabeza los votos` : deep ? 'Inspección de la muestra base · sin escenario local' : elected && scope === 'buenos-aires' ? `${elected.name} encabeza la muestra; mapa ancestral neutral` : scope !== 'rosales' && !unit ? 'Seleccione una unidad de reparto, no un agregado' : 'Sin ganador representable en esta referencia';
  text('map-winner-label', winnerLabel);
  text('map-color-note', scope === 'argentina' ? 'Color = agrupación con más votos; borde claro = unidad seleccionada sin color de ganador.' : 'Color = agrupación con más votos · no intensidad');
  text('map-description', `${winnerLabel}. Los datos son ficticios. ${deep ? 'No se dispone de geometría propia para esta unidad.' : ''}`);
  text('geometry-note', deep ? 'Sin geometría de esta unidad: se conserva únicamente el contorno neutral del partido. No se inventan puntos ni polígonos.' : scope === 'argentina' ? 'Referencias CNE/IGN, marco continental. Solo el distrito seleccionado y con geometría válida recibe color; las referencias observadas permanecen neutrales. No acredita cobertura electoral ni territorio completo.' : scope === 'buenos-aires' ? 'Límite de la maqueta: sin vinculación validada de polígonos por sección electoral. Se conserva el contorno provincial neutral y la selección textual, sin inventar ocho polígonos.' : 'Cartografía CNE / IGN de referencia. No acredita equivalencia electoral histórica ni distribuye el supuesto entre unidades menores.');
}

function renderInspection() {
  const deep = !isBroadScope() && state.nodeId !== 'rosales';
  const node = state.fixture?.nodes?.[state.nodeId];
  text('inspection-heading', deep ? node.label : 'Inspeccionar el territorio');
  text('inspection-note', deep ? 'Solo se inspeccionan votos de la muestra base, sin bancas ni transferencia local. El supuesto del partido se conserva al volver; cambiar la base lo restablece.' : 'La transferencia solo modifica el agregado del partido. No se distribuye entre circuitos, establecimientos ni mesas.');
  $('inspection-return').hidden = !deep;
  $('inspection-children').replaceChildren();
  $('inspection-results').replaceChildren();
  $('inspection-results').hidden = true;
  if (isBroadScope()) {
    text('inspection-heading', selectedUnit() ? 'Unidad de reparto seleccionada' : 'Seleccionar una unidad de reparto');
    text('inspection-note', state.scope === 'argentina' ? 'El editor modifica solo la provincia o CABA seleccionada. El panorama suma sus repartos independientes, nunca votos nacionales agrupados.' : 'El editor modifica solo la sección y categoría seleccionadas. Diputados y senadores no se mezclan; los partidos no sustituyen la sección electoral.');
    return;
  }
  if (!node) return;
  for (const childId of node.childIds ?? []) {
    const child = state.fixture.nodes[childId];
    const button = element('button', 'Inspeccionar ' + child.label, { type: 'button' });
    button.addEventListener('click', () => inspectTerritory(childId));
    $('inspection-children').append(button);
  }
  if (deep) {
    $('inspection-results').hidden = false;
    try {
      const base = baselineVotes(state.fixture, state.year, state.nodeId);
      const counts = element('div', null, { class: 'inspection-votes' });
      for (const party of PARTIES) counts.append(element('span', `${party.name}: ${format(base.votes[party.id])}`));
      $('inspection-results').append(counts, element('p', `Total de la muestra ${state.year}: ${format(base.total)} votos positivos ficticios. Sin cálculo de bancas.`));
    } catch (error) { $('inspection-results').append(element('p', error.message)); }
  }
}

function renderComparison() {
  $('comparison-body').replaceChildren();
  text('scenario-total', '');
  text('base-total', '');
  if (!isScenarioContext() || !state.base) return;
  text('base-total', format(state.base.total));
  const ready = state.status === 'ready' && state.scenario && state.allocation;
  if (ready) text('scenario-total', format(Object.values(state.scenario).reduce((sum, n) => sum + n, 0)));
  for (const party of PARTIES) {
    const row = element('tr', null, { 'data-party': party.id });
    const name = element('th', null, { scope: 'row' });
    const nameContents = element('span', null, { class: 'party-cell' });
    nameContents.append(element('i', null, { class: 'party-marker', 'aria-hidden': 'true' }), element('span', party.name));
    name.append(nameContents);
    row.append(name, element('td', format(state.base.votes[party.id]), { 'data-field': 'base-votes' }));
    row.append(element('td', ready ? format(state.scenario[party.id]) : '—', ready ? { 'data-field': 'scenario-votes' } : {}));
    const delta = ready ? state.scenario[party.id] - state.base.votes[party.id] : null;
    row.append(element('td', ready ? `${delta > 0 ? '+' : ''}${format(delta)}` : '—'));
    row.append(element('td', percent(state.base.votes[party.id] / state.base.total * 100)));
    row.append(element('td', ready ? percent(state.scenario[party.id] / state.base.total * 100) : '—'));
    row.append(element('td', state.baseAllocation ? String(state.baseAllocation.seats[party.id]) : '—', state.baseAllocation ? { 'data-field': 'base-seats' } : {}));
    row.append(element('td', ready ? String(state.allocation.seats[party.id]) : '—', ready ? { 'data-field': 'scenario-seats' } : {}));
    $('comparison-body').append(row);
  }
}

function renderAllocation() {
  $('allocation-status').dataset.status = state.status;
  const messages = {
    loading: 'Cargando muestras y método…',
    ready: 'Asignación completa · supuesto de total fijo',
    draft: 'Cambios sin aplicar. Aplique la transferencia para calcular el escenario.',
    invalid: 'Transferencia inválida. No se conserva el resultado del escenario anterior.',
    blocked: state.reason || 'No se cumplen los requisitos del cálculo.',
    'context-only': state.scope === 'argentina' ? 'Seleccione una provincia o CABA para calcular con padrón y bancas ficticios.' : 'Seleccione una sección electoral y categoría para calcular con bancas ficticias.',
    'inspection-only': 'Inspección de votos base, sin reparto de bancas en circuitos, establecimientos o mesas.',
    unavailable: 'No se pudieron cargar las muestras. No hay resultados disponibles. Recargue la página para reintentar.',
  };
  text('allocation-status', messages[state.status]);
  $('seat-strip').replaceChildren();
  $('seat-summary').replaceChildren();
  $('award-trace').replaceChildren();
  $('quotient-body').replaceChildren();
  $('quotient-evidence').hidden = true;
  $('draw-status').hidden = true;
  text('renewal-count', '');
  text('impact-heading', isBroadScope() ? 'Bancas de la unidad seleccionada' : 'Impacto en la renovación');
  text('retained-note', isBroadScope() ? 'Composición restante de la cámara y convocatoria no verificadas. Este reparto no establece una mayoría de la cámara completa.' : 'Sin composición de las 9 bancas que continúan. No se calcula una mayoría del concejo completo de 18.');
  text('allocation-evidence', 'No hay un escenario calculado. Las bancas y la traza permanecen vacías.');
  if (state.base) {
    for (const party of PARTIES) {
      const baseline = state.baseAllocation?.seats[party.id];
      const scenario = state.status === 'ready' ? state.allocation?.seats[party.id] : undefined;
      const delta = baseline !== undefined && scenario !== undefined ? scenario - baseline : null;
      const summary = element('span', null, { 'data-party': party.id });
      const values = element('span', null, { class: 'seat-change' });
      values.append(element('span', baseline === undefined ? '—' : String(baseline), { 'data-field': 'base-impact' }),
        element('span', '→', { 'aria-hidden': 'true' }),
        element('strong', scenario === undefined ? '—' : String(scenario), { 'data-field': 'scenario-impact' }),
        element('span', delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`, { 'data-field': 'seat-delta' }));
      summary.append(element('i', null, { class: 'party-marker', 'aria-hidden': 'true' }), element('span', party.name), values);
      $('seat-summary').append(summary);
    }
  }
  if (state.status !== 'ready' || !state.allocation) return;
  const seatCount = state.context.seatsToFill;
  const canDraw = seatCount <= MAX_DRAW_SEATS && seatCount * PARTIES.length <= MAX_DRAW_WORK;
  text('renewal-count', String(seatCount));
  if (!canDraw) {
    $('draw-status').hidden = false;
    $('draw-status').dataset.status = 'limited';
    text('draw-status', `Dibujo limitado a ${MAX_DRAW_SEATS} bancas y ${MAX_DRAW_WORK} posiciones. El resultado exacto de ${seatCount} bancas permanece disponible en el resumen y la tabla.`);
  }
  for (const party of PARTIES) {
    for (let count = 0; canDraw && count < state.allocation.seats[party.id]; count++) {
      const seat = element('span', null, { class: 'seat-cell', 'data-party': party.id });
      $('seat-strip').append(seat);
    }
  }
  const output = state.allocation.output;
  if (state.context.level === 'national') {
    const excluded = output.results.filter(result => result.excludedByThreshold).map(result => PARTIES.find(party => party.id === result.listId).name);
    text('allocation-evidence', `D’Hondt por distrito, Código Electoral Nacional, arts. 160–161. Supuestos ficticios: padrón ${format(output.padron)}; umbral del ${output.thresholdPercent} % del padrón = ${decimal(output.thresholdVotes)} votos, no del total positivo. Votos modelados: ${format(output.totalVotes)}; bancas: ${seatCount}. Listas excluidas por umbral: ${excluded.length ? excluded.join(', ') : 'ninguna'}. Cobertura: ${format(output.coverage.listedVotes)} de ${format(output.coverage.basisVotes)} votos. Los cocientes y las asignaciones se detallan debajo; el panorama suma distritos independientes, sin repartir votos nacionales agrupados.`);
    if (output.quotientTable.length <= MAX_DRAW_WORK) {
      $('quotient-evidence').hidden = false;
      for (const quotient of output.quotientTable) {
        const row = element('tr', null);
        row.append(element('th', PARTIES.find(p => p.id === quotient.listId).name, { scope: 'row' }), element('td', String(quotient.divisor)), element('td', decimal(quotient.quotient)));
        $('quotient-body').append(row);
      }
    } else {
      $('allocation-evidence').append(element('p', `La tabla de ${output.quotientTable.length} cocientes supera el límite de dibujo de ${MAX_DRAW_WORK} posiciones y no se despliega. Esto no anula la asignación exacta.`));
    }
  } else {
    const divisorNote = state.context.level === 'pba_municipal' ? `${seatCount} bancas renovadas, no 18 bancas totales` : `${seatCount} bancas supuestas de esta sección y categoría, no una cámara provincial agregada`;
    text('allocation-evidence', `Ley 5109, arts. 109–110. Votos positivos modelados: ${format(output.validVotes)}. Divisor: ${divisorNote}. Cuociente inicial: ${decimal(output.initialCuociente)}; cuociente aplicado: ${decimal(output.cuociente)} (valores mostrados redondeados; el núcleo utiliza el valor completo). Cobertura: ${format(output.coverage.listedVotes)} de ${format(output.coverage.basisVotes)} votos, sin votos no modelados. ${output.halvingIterations} reducciones del cuociente. Las ${seatCount} asignaciones se detallan a continuación.`);
  }
  for (const award of output.seatAwards) {
    const party = PARTIES.find(p => p.id === award.listId);
    const ruleLabels = { cuociente_division: 'división por el cuociente', largest_remainder: 'residuo', dhondt_quotient: 'cociente D’Hondt' };
    const rule = ruleLabels[award.awardedBy] ?? award.awardedBy;
    const valueLabels = { votes: 'votos', cuociente: 'cuociente', remainder: 'residuo', quotient: 'cociente', divisor: 'divisor' };
    const item = `${party?.name ?? 'Agrupación no modelada'}: ${rule}; ${Object.entries(award.values ?? {}).map(([key, value]) => `${valueLabels[key] ?? key}: ${typeof value === 'number' ? decimal(value) : value}`).join(', ')}${award.tieBreak ? `; ${award.tieBreak.rule} (${award.tieBreak.citation})` : ''}.`;
    $('award-trace').append(element('li', item));
  }
}

function renderOverview() {
  const definition = state.contexts?.contexts[state.scope];
  const visible = Boolean(state.fixture && definition && isBroadScope());
  $('unit-overview').hidden = !visible;
  $('unit-overview-body').replaceChildren();
  $('overview-party-totals').replaceChildren();
  text('overview-base-total', '');
  text('overview-scenario-total', '');
  if (!visible) return;
  const totals = { base: 0, scenario: 0, validBase: 0, validScenario: 0 };
  const parties = Object.fromEntries(PARTIES.map(p => [p.id, { base: 0, scenario: 0 }]));
  for (const unit of definition.units) {
    let base = null;
    let scenario = null;
    let reason = '';
    try {
      const sample = unitBaseline(state.contexts, state.scope, unit.id, state.year, state.category);
      base = allocateScenario(sample.votes, sample.context);
      if (unit.id === state.unitId) {
        if (state.status === 'ready') scenario = state.allocation;
        else reason = state.reason || (state.status === 'draft' ? 'Cambios sin aplicar.' : 'El escenario de esta unidad está bloqueado.');
      } else scenario = base;
    } catch (error) { reason = error.message; }
    if (base) {
      totals.base += base.input.seatsToFill;
      totals.validBase++;
      for (const party of PARTIES) parties[party.id].base += base.seats[party.id];
    }
    if (scenario) {
      totals.scenario += scenario.input.seatsToFill;
      totals.validScenario++;
      for (const party of PARTIES) parties[party.id].scenario += scenario.seats[party.id];
    }
    const row = element('tr', null, { 'data-unit': unit.id });
    if (unit.id === state.unitId) row.dataset.selected = 'true';
    const unitCell = element('th', null, { scope: 'row' });
    const button = element('button', 'Seleccionar ' + unit.label, { type: 'button' });
    button.addEventListener('click', () => {
      state.unitId = unit.id;
      $('allocation-unit').value = unit.id;
      useBaseline();
      // Rendering replaces the activated row; retain its local keyboard position.
      const replacement = [...$('unit-overview-body').children].find(row => row.dataset.unit === unit.id);
      replacement?.querySelector('button')?.focus({ preventScroll: true });
    });
    unitCell.append(button);
    row.append(unitCell, element('td', base ? String(base.input.seatsToFill) : '—', { 'data-field': 'base-seats' }), element('td', scenario ? String(scenario.input.seatsToFill) : '—', { 'data-field': 'scenario-seats' }));
    for (const party of PARTIES) row.append(element('td', `${base ? base.seats[party.id] : '—'} → ${scenario ? scenario.seats[party.id] : '—'}`, { 'data-party': party.id }));
    row.append(element('td', reason || (unit.id === state.unitId ? 'Unidad seleccionada' : 'Base sin transferencia'), { 'data-field': 'reason' }));
    $('unit-overview-body').append(row);
  }
  const baseComplete = totals.validBase === definition.units.length;
  const scenarioComplete = totals.validScenario === definition.units.length;
  $('unit-overview').dataset.status = baseComplete && scenarioComplete ? 'complete' : 'incomplete';
  text('overview-base-total', baseComplete ? format(totals.base) : '— (incompleto)');
  text('overview-scenario-total', scenarioComplete ? format(totals.scenario) : '— (incompleto)');
  for (const party of PARTIES) {
    const item = element('div', null, { 'data-party': party.id });
    item.append(element('span', party.name), element('strong', baseComplete ? String(parties[party.id].base) : '—', { 'data-field': 'base-seats' }), element('span', '→', { 'aria-hidden': 'true' }), element('strong', scenarioComplete ? String(parties[party.id].scenario) : '—', { 'data-field': 'scenario-seats' }));
    $('overview-party-totals').append(item);
  }
  text('unit-overview-note', `${definition.units.length} repartos independientes de ${state.scope === 'argentina' ? 'diputados nacionales' : state.category === 'diputados-provinciales' ? 'diputados provinciales' : 'senadores provinciales'}. Base completa: ${totals.validBase}/${definition.units.length}; escenario completo: ${totals.validScenario}/${definition.units.length}. Solo cambia la unidad seleccionada; filas bloqueadas permanecen con su motivo. No se reparten votos agrupados.`);
}

function configureUnitControls() {
  const broad = isBroadScope();
  const definition = state.contexts?.contexts[state.scope];
  $('allocation-unit-field').hidden = !broad;
  $('scenario-category-field').hidden = !broad;
  $('municipal-category').hidden = broad;
  $('allocation-unit').replaceChildren(element('option', 'Seleccione una unidad', { value: '' }));
  $('scenario-category').replaceChildren();
  for (const category of definition?.categories ?? []) $('scenario-category').append(element('option', category.label, { value: category.id }));
  for (const unit of definition?.units ?? []) $('allocation-unit').append(element('option', unit.label, { value: unit.id }));
  $('scenario-category').value = state.category;
  $('allocation-unit').value = state.unitId;
}

function renderAssumptions() {
  $('scenario-assumptions').hidden = !isBroadScope();
  let assumption = 'Supuestos ficticios: votos, padrón y bancas. Los años son etiquetas ilustrativas, no calendarios ni convocatorias reales.';
  const unit = selectedUnit();
  if (unit && state.context) {
    assumption = `${unit.label}: ${state.context.seatsToFill} bancas ficticias`;
    if (state.context.level === 'national') assumption += `, padrón ficticio ${format(state.context.padron)}, umbral del ${state.context.thresholdPercent} % del padrón`;
    else assumption += `. Referencia de pertenencia: ${unit.referencePartidoCount} partidos; no es cobertura de resultados ingeridos`;
    assumption += '. Votos y bancas son supuestos; los años son ilustrativos, no una renovación verificada.';
  }
  text('scenario-assumptions', assumption);
}

function renderCapabilities() {
  $('capability-facts').replaceChildren();
  $('capability-sources').replaceChildren();
  const policy = state.capabilities;
  if (!policy) {
    text('capability-summary', 'No se pudo cargar la evidencia de capacidades. No se infiere disponibilidad ni cobertura.');
    return;
  }
  text('capability-summary', 'Votus ya permite cálculos manuales. Integración pendiente de la base histórica de Simulación; cobertura de la base alojada desconocida. Esta maqueta no amplía la ingestión real.');
  const statusLabels = { available: 'Disponible', pending: 'Pendiente', limited: 'Limitado', snapshot: 'Observación local', unverified: 'No verificado', prototype: 'Solo prototipo' };
  for (const fact of policy.facts) {
    const article = element('article', null, { 'data-capability': fact.id, 'data-status': fact.status });
    article.append(element('span', statusLabels[fact.status], { class: 'capability-status' }), element('h3', fact.title), element('p', fact.detail));
    $('capability-facts').append(article);
    const sources = element('div', null);
    sources.append(element('strong', fact.title));
    if (fact.sources.length) {
      const list = element('ul', null);
      for (const path of fact.sources) list.append(element('li', path));
      sources.append(list);
    } else sources.append(element('p', 'Condición de esta maqueta, no un diagnóstico de producción.'));
    $('capability-sources').append(sources);
  }
  text('capability-snapshot', `Revisión local fechada ${policy.checkedAt}. Sin consulta de base de datos ni API: cobertura alojada desconocida. Referencia de origen: ${policy.legislativeReference.partidos} partidos y ${policy.legislativeReference.sections} secciones PBA, consistente en las fuentes archivadas 2023/2025. No verifica parámetros ni composición de 2027.`);
}

function renderMobileReading() {
  const label = selectedUnit()?.label ?? state.fixture?.nodes?.[state.nodeId]?.label ?? 'Contexto pendiente';
  text('mobile-scenario-context', `${label} · ${state.year} · muestra ficticia`);
  text('mobile-scenario-reading', state.status === 'ready'
    ? `${state.context.seatsToFill} bancas calculadas; ${format(state.amount)} votos transferidos. Total fijo, no pronóstico.`
    : $('allocation-status').textContent);
}

function render() {
  configureUnitControls();
  const editable = isEditable();
  for (const id of ['donor', 'target', 'amount', 'transfer-submit', 'reset-base', 'sweep-maximum', 'sweep-step', 'sweep-submit']) $(id).disabled = !editable;
  $('territory').disabled = !state.fixture;
  $('base-year').disabled = !state.fixture;
  $('allocation-unit').disabled = !state.fixture || !isBroadScope();
  $('scenario-category').disabled = !state.fixture || !isBroadScope();
  text('amount-note', editable ? `Disponibles: ${format(state.base.votes[$('donor').value])} · enteros no negativos.` : 'Seleccione una unidad de reparto con parámetros completos.');
  text('scope-note', state.scope === 'argentina' ? 'Diputados nacionales: reparto independiente por provincia o CABA. Seleccione una unidad con parámetros ficticios; el resumen nacional suma repartos, nunca un total de votos argentino.' : state.scope === 'buenos-aires' ? 'Diputados y senadores provinciales: reparto independiente por sección electoral. Seleccione una sección y categoría; no se mezclan cámaras ni se reparten votos de partidos como una sola provincia.' : state.nodeId !== 'rosales' ? 'Unidad de inspección de la muestra ficticia. El partido completo de Coronel Rosales es la unidad del escenario municipal.' : 'Escenario municipal del partido de Coronel Rosales. Muestra ficticia de concejales; nueve bancas de renovación, sin convocatoria real.');
  text('transfer-note', state.status === 'ready' ? state.amount === 0 ? 'Base exacta: sin transferencia aplicada.' : `Aplicado: ${format(state.amount)} votos de ${PARTIES.find(p => p.id === $('donor').value).name} a ${PARTIES.find(p => p.id === $('target').value).name}. Total fijo.` : state.status === 'draft' ? 'Cambios sin aplicar; no se muestra el escenario anterior.' : 'Sin transferencia aplicada en este contexto.');
  text('results-note', isScenarioContext() ? state.status === 'ready' ? 'Base ficticia y supuesto aplicado. Porcentajes sobre el total positivo modelado; no incluyen blancos ni nulos.' : 'Solo la base está disponible. Las celdas del escenario no representan ceros ni una asignación anterior.' : 'Sin escenario de reparto en este contexto. Los votos de niveles profundos se muestran en la inspección del mapa.');
  renderMap();
  renderInspection();
  renderComparison();
  renderAllocation();
  renderAssumptions();
  renderOverview();
  renderCapabilities();
  renderMobileReading();
}

function markDraft() {
  clearSamples();
  if (!isEditable()) return;
  state.status = 'draft';
  state.scenario = null;
  state.allocation = null;
  state.reason = '';
  text('transfer-error', '');
  render();
}

$('transfer-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!isEditable()) return;
  clearSamples();
  try {
    const result = transferVotes(state.base.votes, $('donor').value, $('target').value, $('amount').value);
    const allocation = allocateScenario(result.votes, state.context);
    state.scenario = result.votes;
    state.amount = result.amount;
    state.allocation = allocation;
    state.status = 'ready';
    text('transfer-error', '');
  } catch (error) {
    state.scenario = null;
    state.allocation = null;
    state.status = /empate|mayoría|cobertura|asignación/i.test(error.message) ? 'blocked' : 'invalid';
    state.reason = error.message;
    text('transfer-error', error.message);
  }
  render();
});
for (const id of ['donor', 'target']) $(id).addEventListener('change', markDraft);
$('amount').addEventListener('input', markDraft);
$('reset-base').addEventListener('click', () => useBaseline());
$('territory').addEventListener('change', () => {
  state.scope = $('territory').value;
  state.nodeId = state.scope;
  state.unitId = '';
  state.category = state.contexts?.contexts[state.scope]?.categories[0]?.id ?? 'concejales';
  useBaseline();
});
$('allocation-unit').addEventListener('change', () => { state.unitId = $('allocation-unit').value; useBaseline(); });
$('scenario-category').addEventListener('change', () => { state.category = $('scenario-category').value; useBaseline(); });
$('base-year').addEventListener('change', () => { state.year = $('base-year').value; useBaseline(); });
$('inspection-return').addEventListener('click', returnToParent);
for (const view of ['base', 'scenario']) $('view-' + view).addEventListener('click', () => { state.mapView = view; renderMap(); });
for (const id of ['sweep-maximum', 'sweep-step']) $(id).addEventListener('input', clearSamples);

$('sweep-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!isEditable()) return;
  clearSamples();
  try {
    const donor = $('donor').value;
    const target = $('target').value;
    const plan = sensitivityPlan(state.base.votes, donor, target, $('sweep-maximum').value, $('sweep-step').value, state.context);
    const samples = plan.amounts.map(amount => {
      try {
        const transferred = transferVotes(state.base.votes, donor, target, String(amount));
        return { amount, allocation: allocateScenario(transferred.votes, state.context), error: null };
      } catch (error) { return { amount, allocation: null, error: error.message }; }
    });
    state.samples = samples;
    const valid = samples.filter(s => s.allocation).length;
    $('sweep-status').dataset.status = 'ready';
    text('sweep-status', `${samples.length} muestras: ${valid} válidas y ${samples.length - valid} bloqueadas.`);
    text('sweep-note', `${plan.workload} posiciones de cálculo. Cero y máximo incluidos una sola vez; el último intervalo puede ser más corto. No se infiere un umbral exacto entre puntos, una probabilidad ni un pronóstico.`);
    for (const sample of samples) {
      const row = element('tr', null);
      row.append(element('td', format(sample.amount), { 'data-field': 'amount' }));
      for (const party of PARTIES) row.append(element('td', sample.allocation ? String(sample.allocation.seats[party.id]) : '—'));
      row.append(element('td', sample.error ?? 'Asignación completa'));
      $('sweep-body').append(row);
    }
  } catch (error) {
    $('sweep-status').dataset.status = 'blocked';
    text('sweep-status', error.message);
  }
});

function connectDialog(prefix) {
  const dialog = $(prefix + '-dialog');
  const opener = $(prefix + '-open');
  opener.addEventListener('click', () => dialog.showModal());
  $(prefix + '-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus({ preventScroll: true }));
}
connectDialog('method');
connectDialog('navigation');

async function readLocal(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar ' + path);
  return response.json();
}

function validateContexts(fixture) {
  if (fixture?.version !== 1 || fixture.sourceKind !== 'demonstration' || fixture.official !== false) throw new Error('El archivo de escenarios no declara su carácter ficticio.');
  for (const [scope, level, count, categories] of [
    ['argentina', 'national', 24, ['diputados-nacionales']],
    ['buenos-aires', 'pba_provincial', 8, ['diputados-provinciales', 'senadores-provinciales']],
  ]) {
    const definition = fixture.contexts?.[scope];
    if (definition?.level !== level || !Array.isArray(definition.units) || definition.units.length !== count || !Array.isArray(definition.categories) || definition.categories.map(item => item.id).join('|') !== categories.join('|')) throw new Error('La estructura de unidades o categorías no está completa.');
    const ids = new Set();
    for (const unit of definition.units) {
      if (typeof unit.id !== 'string' || !unit.id || typeof unit.label !== 'string' || !unit.label || ids.has(unit.id)) throw new Error('Las unidades deben tener identidad y nombre únicos.');
      ids.add(unit.id);
    }
  }
}

function validateCapabilities(policy) {
  const statuses = ['available', 'pending', 'limited', 'snapshot', 'unverified', 'prototype'];
  if (policy?.version !== 1 || !Number.isFinite(Date.parse(policy.checkedAt)) || policy.liveDatabaseCoverage !== 'unknown' || !Array.isArray(policy.facts) || !policy.facts.length || !policy.legislativeReference) throw new Error('No hay una revisión de capacidades válida.');
  for (const fact of policy.facts) {
    if (!statuses.includes(fact.status) || typeof fact.id !== 'string' || typeof fact.title !== 'string' || typeof fact.detail !== 'string' || !Array.isArray(fact.sources) || fact.sources.some(path => typeof path !== 'string')) throw new Error('La revisión contiene una capacidad inválida.');
  }
}

try {
  const [fixture, references, geography, contexts, capabilities] = await Promise.all([
    readLocal('./assets/demo-results.json'), readLocal('./assets/reference-paths.json'), readLocal('./assets/winner-reference-paths.json'),
    readLocal('./assets/scenario-contexts.json'), readLocal('./assets/capability-policy.json'),
  ]);
  if (!fixture.nodes?.rosales || !fixture.nodes?.argentina || !fixture.nodes?.['buenos-aires'] || !references.rosales?.path || !Array.isArray(geography.partidos)) throw new Error('La estructura de las referencias no es válida.');
  validateContexts(contexts);
  validateCapabilities(capabilities);
  state.fixture = fixture;
  state.contexts = contexts;
  state.capabilities = capabilities;
  state.references = references;
  state.geography = geography;
  useBaseline();
} catch {
  state.fixture = null;
  state.contexts = null;
  state.capabilities = null;
  state.base = null;
  state.context = null;
  state.scenario = null;
  state.allocation = null;
  state.status = 'unavailable';
  clearSamples();
  render();
}
