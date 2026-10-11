import { sampleEvidence, geometryFor, ancestors } from './assets/evidence-model.js';
import { PARTIES } from './assets/simulation-model.js';

export { PARTIES, ancestors, geometryFor };
const OVERVIEW_LEVELS = new Set(['country', 'province', 'partido']);

export function overviewChildren(assets, nodeId) {
  return assets.fixture.nodes[nodeId].childIds
    .filter(id => OVERVIEW_LEVELS.has(assets.fixture.nodes[id].level));
}

export function overviewResult(assets, nodeId, year, category) {
  const sample = sampleEvidence(assets, nodeId, year, category);
  const record = assets.fixture.results[year][category][nodeId];
  const result = { ...sample, outcome: 'missing', leader: null, share: null, margin: null, distribution: [] };
  if (sample.state === 'missing') return result;
  if (sample.totalVotes === 0) return { ...result, outcome: 'zero' };
  const distribution = PARTIES.map(party => ({
    ...party, votes: record.votes[party.id], share: 100 * record.votes[party.id] / sample.totalVotes
  })).sort((a, b) => b.votes - a.votes);
  if (distribution[0].votes === distribution[1].votes) return { ...result, outcome: 'tie', distribution };
  return {
    ...result, distribution, outcome: sample.state === 'partial' ? 'provisional' : 'winner',
    leader: distribution[0], share: distribution[0].share,
    margin: 100 * (distribution[0].votes - distribution[1].votes) / sample.totalVotes
  };
}

export function overviewShapes(assets, nodeId, year, category, mode) {
  const children = overviewChildren(assets, nodeId);
  const source = nodeId === 'argentina' ? assets.geography.provinces
    : nodeId === 'buenos-aires' ? assets.geography.partidos : [];
  const shapes = children.length && source.length ? source : [{
    id: nodeId, path: geometryFor(assets, nodeId).path,
    geometryValid: geometryFor(assets, nodeId).state === 'valid'
  }];
  return shapes.map(shape => {
    const result = mode === 'demonstration' ? overviewResult(assets, shape.id, year, category) : null;
    const eligible = result?.outcome === 'winner' && shape.geometryValid;
    return {
      ...shape, state: result?.state ?? 'unknown', outcome: result?.outcome ?? 'unknown',
      winner: eligible ? result.leader : null
    };
  });
}

export function selectionInsights(assets, nodeId, result) {
  const node = assets.fixture.nodes[nodeId];
  const geometry = geometryFor(assets, nodeId);
  const insights = [];
  if (result.state === 'missing') insights.push('Esta selección no contiene un vector de votos en la muestra. Sin datos no significa cero votos.');
  else if (result.outcome === 'zero') insights.push('La muestra contiene un vector válido de cero votos. No hay una agrupación ganadora.');
  else if (result.outcome === 'tie') insights.push('Hay un empate en el primer lugar de esta muestra. No se selecciona una agrupación por orden o identificador.');
  else if (result.state === 'partial') insights.push(`${result.leader.name} encabeza los votos presentes, pero el alcance parcial no permite afirmar un ganador definitivo.`);
  else insights.push(`${result.leader.name} tiene el primer lugar en esta muestra completa. No es un resultado oficial.`);
  insights.push(result.percent === null
    ? 'El tipo de unidad no está documentado para este registro. La relación declarada no se convierte en un porcentaje.'
    : `La cobertura corresponde a ${result.unit}; no representa padrón, participación ni mesas oficiales.`);
  if (nodeId === 'argentina') insights.push('El agregado nacional es independiente, no la suma de las provincias visibles. La búsqueda no cambia ese agregado.');
  else if (node.level === 'partido') insights.push('Panorama termina en el partido. Circuitos, establecimientos y mesas se recorren en Exploración; no se dibujan ubicaciones inventadas.');
  else if (!overviewChildren(assets, nodeId).length) insights.push('Esta provincia no tiene un desglose territorial inferior en la muestra de Panorama. No se infiere un detalle ausente.');
  if (geometry.state === 'observed') insights.push('La referencia geográfica tiene observaciones y permanece neutral. Esto no cambia la disponibilidad de los votos.');
  return insights;
}
