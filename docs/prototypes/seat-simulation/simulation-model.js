import { allocateSeats } from './kernel.js';

export const PARTIES = [
  { id: 'a', name: 'Alianza A', color: '#65e5f2' },
  { id: 'b', name: 'Alianza B', color: '#aac0f1' },
  { id: 'c', name: 'Lista C', color: '#efc58c' },
  { id: 'd', name: 'Lista D', color: '#769598' },
];
export const RENEWAL_SEATS = 9;
export const TOTAL_SEATS = 18;
export const MAX_SAMPLES = 21;
export const MAX_WORK = 600;
export const MAX_DRAW_SEATS = 60;
export const MAX_DRAW_WORK = 600;
export const MUNICIPAL_CONTEXT = { level: 'pba_municipal', seatsToFill: RENEWAL_SEATS, councilTotal: TOTAL_SEATS };

export function safeInteger(text, label) {
  if (!/^\d+$/.test(String(text))) throw new Error(`${label}: ingrese un número entero no negativo.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error(`${label}: el número supera el límite admitido.`);
  return value;
}

function checkedVotes(record) {
  if (record?.status !== 'complete' || !record.votes) throw new Error('La muestra no tiene resultados completos para esta unidad.');
  if (!Number.isSafeInteger(record.coverage?.reported) || !Number.isSafeInteger(record.coverage?.total) || record.coverage.total <= 0 || record.coverage.reported !== record.coverage.total) throw new Error('La cobertura de esta unidad está incompleta.');
  const votes = {};
  for (const party of PARTIES) {
    if (typeof record.votes[party.id] !== 'number') throw new Error('La muestra debe contener votos enteros para todas las agrupaciones.');
    votes[party.id] = safeInteger(record.votes[party.id], 'Votos de ' + party.name);
  }
  if (Object.keys(record.votes).some(id => !PARTIES.some(p => p.id === id))) throw new Error('La muestra contiene una agrupación no modelada.');
  const total = Object.values(votes).reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('El total de votos no es un entero positivo válido.');
  return { votes, total };
}

export function baselineVotes(fixture, year, nodeId = 'rosales') {
  return checkedVotes(fixture?.results?.[year]?.concejales?.[nodeId]);
}

export function unitBaseline(fixture, scope, unitId, year, category) {
  const definition = fixture?.contexts?.[scope];
  const unit = definition?.units.find(item => item.id === unitId);
  if (!unit || !definition.categories.some(item => item.id === category)) throw new Error('La unidad o categoría no está definida en esta muestra.');
  const record = unit.samples?.[year]?.[category];
  const base = checkedVotes(record);
  if (!Number.isSafeInteger(record.seatsToFill) || record.seatsToFill <= 0) throw new Error('Las bancas de la muestra deben ser un entero positivo.');
  const context = { level: definition.level, seatsToFill: record.seatsToFill };
  if (definition.level === 'national') {
    if (!Number.isSafeInteger(record.padron) || record.padron <= 0 || record.thresholdPercent !== 3) throw new Error('El escenario nacional requiere padrón positivo y umbral supuesto del 3 % del padrón.');
    context.padron = record.padron;
    context.thresholdPercent = record.thresholdPercent;
  }
  return { ...base, context, unit, category };
}

export function transferVotes(base, donor, target, text) {
  if (!PARTIES.some(p => p.id === donor) || !PARTIES.some(p => p.id === target)) throw new Error('Seleccione dos agrupaciones disponibles.');
  if (donor === target) throw new Error('El origen y el destino deben ser agrupaciones distintas.');
  const amount = safeInteger(text, 'Votos a transferir');
  if (amount > base[donor]) throw new Error('La transferencia supera los votos disponibles de la agrupación de origen.');
  const votes = { ...base };
  votes[donor] -= amount;
  votes[target] += amount;
  if (!Number.isSafeInteger(votes[target])) throw new Error('El resultado supera el límite numérico admitido.');
  return { votes, amount };
}

function hasConvention(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.basis === 'simulation_convention') return true;
  return Object.values(value).some(hasConvention);
}

export function allocateScenario(votes, context = MUNICIPAL_CONTEXT) {
  if (!['pba_municipal', 'pba_provincial', 'national'].includes(context.level) || !Number.isSafeInteger(context.seatsToFill) || context.seatsToFill <= 0) throw new Error('Contexto de reparto inválido.');
  const total = Object.values(votes).reduce((sum, n) => sum + n, 0);
  const input = {
    level: context.level, isProjection: true, seatsToFill: context.seatsToFill,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    lists: PARTIES.map(p => ({ listId: p.id, listName: p.name, votes: votes[p.id] })),
  };
  if (context.level === 'national') {
    input.totalVotes = total;
    input.padron = context.padron;
    input.threshold = { value: context.thresholdPercent, basis: 'padron' };
  } else {
    input.voteTotals = { kind: 'valid_votes_only', validVotes: total };
    if (context.level === 'pba_municipal') input.councilTotal = context.councilTotal;
  }
  try {
    const output = allocateSeats(input);
    if (!output.coverage.complete || output.coverage.uncoveredVotes !== 0) throw new Error('La cobertura del cálculo está incompleta.');
    const seats = Object.fromEntries(output.results.map(r => [r.listId, context.level === 'national' ? r.seats : r.totalSeats]));
    if (output.seatAwards.length !== context.seatsToFill || Object.values(seats).reduce((sum, value) => sum + value, 0) !== context.seatsToFill) {
      throw new Error('No se obtuvo una asignación completa de las bancas.');
    }
    if (hasConvention(output.seatAwards) || hasConvention(output.tieBreaks) || hasConvention(output.seatCap)) {
      throw new Error('El empate decisivo requiere una regla que esta demostración no puede resolver. No se asignan bancas por identificador.');
    }
    return { input, output, seats };
  } catch (error) {
    if (/MAYORIA|majority/i.test(error.message)) throw new Error('El supuesto de mayoría especial no está implementado; la asignación queda bloqueada.');
    throw error;
  }
}

export function sensitivityPlan(base, donor, target, maximumText, stepText, context = MUNICIPAL_CONTEXT) {
  const maximum = safeInteger(maximumText, 'Transferencia máxima');
  const step = safeInteger(stepText, 'Paso de muestreo');
  if (step === 0) throw new Error('El paso de muestreo debe ser mayor que cero.');
  transferVotes(base, donor, target, maximumText);
  const count = Math.floor(maximum / step) + 1 + (maximum % step === 0 ? 0 : 1);
  const workload = count * context.seatsToFill * PARTIES.length;
  // Check limits before materializing any array or iterating over samples.
  if (count > MAX_SAMPLES || workload > MAX_WORK) {
    throw new Error(`La selección requiere ${count} muestras y ${workload} posiciones de cálculo. Límite: ${MAX_SAMPLES} muestras y ${MAX_WORK} posiciones. Aumente el paso o reduzca el máximo.`);
  }
  const amounts = [];
  for (let index = 0; index < count; index++) amounts.push(Math.min(index * step, maximum));
  return { amounts, workload };
}
