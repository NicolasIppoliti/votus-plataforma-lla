import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';

const require = createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const mode = process.argv[2] || 'all';
assert.ok(['coverage', 'ranking', 'votes', 'winners', 'all'].includes(mode));
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1276, height: 892 } });
const page = await context.newPage();
const errors = [], external = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url()); });
const fixture = await (await page.request.get(url + 'assets/demo-results.json')).json();
const policy = await (await page.request.get(url + 'assets/comparison-policy.json')).json();
const geography = await (await page.request.get(url + 'assets/winner-reference-paths.json')).json();
const partyNames = { a: 'Alianza A', b: 'Alianza B', c: 'Lista C', d: 'Lista D' };
const palette = { a: 'rgb(101, 229, 242)', b: 'rgb(170, 192, 241)', c: 'rgb(239, 197, 140)', d: 'rgb(118, 149, 152)' };
const integer = value => new Intl.NumberFormat('es-AR').format(value);
const signedVotes = value => (value > 0 ? '+' : '') + integer(value) + ' votos';
const sum = votes => Object.values(votes).reduce((total, value) => total + value, 0);
let category = 'national-deputies', yearA = '2023', yearB = '2025', party = 'a';
const nav = page.getByRole('region', { name: 'Navegador territorial', exact: true });

function pair(id) {
  if (yearA === yearB) return { status: 'same-year' };
  if (policy.overrides[id]) return { status: policy.overrides[id].status };
  const a = fixture.results[yearA][category][id], b = fixture.results[yearB][category][id];
  if (!a || !b || a.status === 'missing' || b.status === 'missing' || !a.votes || !b.votes) return { status: 'missing' };
  if (a.status !== 'complete' || b.status !== 'complete') return { status: 'partial' };
  if (!sum(a.votes) || !sum(b.votes)) return { status: 'zero' };
  return { status: 'matched', a: a.votes, b: b.votes };
}
function delta(id) {
  const p = pair(id);
  return (p.b[party] / sum(p.b) - p.a[party] / sum(p.a)) * 100;
}
function winner(votes) {
  const max = Math.max(...Object.values(votes));
  const leaders = Object.keys(votes).filter(id => votes[id] === max);
  return leaders.length === 1 ? leaders[0] : null;
}
async function select(id) {
  await page.getByLabel('Territorio', { exact: true }).selectOption(id);
  await expect(page.locator('#map-a')).toHaveAttribute('data-scope', id);
}
async function open(id) {
  await nav.getByRole('button', { name: 'Abrir ' + fixture.nodes[id].label, exact: true }).click();
  await expect(page.locator('#map-a')).toHaveAttribute('data-scope', id);
}
async function reset() {
  category = 'national-deputies'; yearA = '2023'; yearB = '2025'; party = 'a';
  assert.equal((await page.goto(url)).status(), 200);
  await expect(page.locator('#comparison-status')).toHaveAttribute('data-status', 'matched');
}
async function coverageFor(id) {
  const children = fixture.nodes[id].childIds;
  const counts = {};
  for (const child of children) { const status = pair(child).status; counts[status] = (counts[status] || 0) + 1; }
  const element = page.locator('#child-coverage');
  await expect(element).toBeVisible();
  await expect(element).toHaveAttribute('data-total', String(children.length));
  await expect(element).toHaveAttribute('data-comparable', String(counts.matched || 0));
  if (children.length) await expect(element).toContainText(`${counts.matched || 0} de ${children.length}`);
  else { await expect(element).toContainText(/sin siguiente nivel/i); await expect(element).not.toContainText('0 %'); }
  const excluded = Object.entries(counts).filter(([status]) => status !== 'matched');
  await expect(page.locator('#coverage-reasons [data-status]')).toHaveCount(excluded.length);
  for (const [status, count] of excluded) await expect(page.locator(`#coverage-reasons [data-status="${status}"]`)).toHaveAttribute('data-count', String(count));
}
async function coverage() {
  await reset(); await coverageFor('buenos-aires');
  const before = await page.locator('#child-coverage').innerText();
  await page.getByLabel('Filtrar territorios de la tabla', { exact: true }).fill('Rosales');
  await expect(page.locator('#child-comparison-body tr:visible')).toHaveCount(1);
  assert.equal(await page.locator('#child-coverage').innerText(), before);
  await page.getByLabel('Buscar en el siguiente nivel', { exact: true }).fill('Rosales');
  assert.equal(await page.locator('#child-coverage').innerText(), before);
  await select('argentina'); await coverageFor('argentina');
  assert.equal(pair('province-catamarca').status, 'matched', 'Ties remain numerically comparable');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('d'); party = 'd'; await coverageFor('argentina');
  await page.getByLabel('Categoría B', { exact: true }).selectOption('concejales');
  await expect(page.locator('#child-coverage')).toHaveAttribute('data-comparable', '0');
  await expect(page.locator('#coverage-reasons [data-status="category-mismatch"]')).toHaveAttribute('data-count', '24');
  await page.getByLabel('Categoría B', { exact: true }).selectOption('national-deputies');
  await page.getByLabel('Elección B', { exact: true }).selectOption('2023'); yearB = '2023'; await coverageFor('argentina');
  await page.getByLabel('Elección B', { exact: true }).selectOption('2025'); yearB = '2025';
  await select('rosales');
  for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) { await open(id); await coverageFor(id); }
  checks.push('whole-child-coverage-exclusive-reasons-search-independent-ties-terminal');
}
async function rankingFor(id, direction) {
  const labelOrder = (a, b) => fixture.nodes[a].label.localeCompare(fixture.nodes[b].label, 'es') || a.localeCompare(b);
  const expected = [...fixture.nodes[id].childIds].sort((a, b) => {
    const ma = pair(a).status === 'matched', mb = pair(b).status === 'matched';
    if (ma !== mb) return ma ? -1 : 1;
    return ma ? (direction === 'delta-desc' ? delta(b) - delta(a) : delta(a) - delta(b)) || labelOrder(a, b) : labelOrder(a, b);
  });
  await page.getByLabel('Ordenar territorios', { exact: true }).selectOption(direction);
  assert.deepEqual(await page.locator('#child-comparison-body tr').evaluateAll(rows => rows.map(row => row.dataset.nodeId)), expected);
  for (const child of expected.filter(child => pair(child).status !== 'matched')) {
    const row = page.locator(`#child-comparison-body [data-node-id="${child}"]`);
    await expect(row).toBeVisible(); await expect(row.locator('[data-field="delta"]')).toHaveText('');
  }
}
async function ranking() {
  await reset(); await rankingFor('buenos-aires', 'delta-desc'); await rankingFor('buenos-aires', 'delta-asc');
  await select('argentina');
  for (const group of Object.keys(partyNames)) { party = group; await page.getByLabel('Agrupación', { exact: true }).selectOption(group); await rankingFor('argentina', 'delta-desc'); await rankingFor('argentina', 'delta-asc'); }
  await page.getByRole('button', { name: 'Intercambiar A y B', exact: true }).click(); [yearA, yearB] = [yearB, yearA]; await rankingFor('argentina', 'delta-desc');
  const share = await page.locator('#map-a .child-shape').evaluateAll(shapes => shapes.map(shape => shape.getAttribute('style')));
  const total = await page.locator('#child-coverage').innerText();
  await page.getByLabel('Filtrar territorios de la tabla', { exact: true }).fill('Catamarca');
  await expect(page.locator('#child-comparison-body tr:visible')).toHaveCount(1);
  assert.equal(await page.locator('#child-coverage').innerText(), total);
  assert.deepEqual(await page.locator('#map-a .child-shape').evaluateAll(shapes => shapes.map(shape => shape.getAttribute('style'))), share);
  checks.push('exact-selected-group-pp-ranking-both-orders-swap-blocked-retained');
}
async function voteFigures(id) {
  const p = pair(id);
  await expect(page.locator('#delta-votes')).toHaveText(signedVotes(p.b[party] - p.a[party]));
  for (const group of Object.keys(partyNames)) await expect(page.locator(`#party-comparison-body [data-party="${group}"] [data-field="votes-delta"]`)).toHaveText(signedVotes(p.b[group] - p.a[group]));
  for (const child of fixture.nodes[id].childIds) {
    const childPair = pair(child);
    await expect(page.locator(`#child-comparison-body [data-node-id="${child}"] [data-field="votes-delta"]`)).toHaveText(childPair.status === 'matched' ? signedVotes(childPair.b[party] - childPair.a[party]) : '');
  }
}
async function votes() {
  await reset();
  for (const group of Object.keys(partyNames)) { party = group; await page.getByLabel('Agrupación', { exact: true }).selectOption(group); await voteFigures('buenos-aires'); }
  await page.getByRole('button', { name: 'Intercambiar A y B', exact: true }).click(); [yearA, yearB] = [yearB, yearA]; await voteFigures('buenos-aires');
  await page.getByLabel('Categoría B', { exact: true }).selectOption('concejales'); await expect(page.locator('#delta-votes')).toHaveText('');
  await page.getByLabel('Categoría A', { exact: true }).selectOption('concejales'); category = 'concejales'; await select('rosales'); await voteFigures('rosales');
  for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) { await open(id); await voteFigures(id); }
  await page.getByLabel('Elección B', { exact: true }).selectOption(yearA); await expect(page.locator('#delta-votes')).toHaveText('');
  checks.push('absolute-signed-vote-delta-detail-party-children-swap-council-clearing');
}
async function winnerChildren(id, references) {
  for (const side of ['a', 'b']) for (const reference of references) {
    const p = pair(reference.id), leader = p.status === 'matched' ? winner(p[side]) : null;
    const eligible = reference.geometryValid && leader;
    const shape = page.locator(`#map-${side} [data-node-id="${reference.id}"]`);
    const fill = await shape.evaluate(element => getComputedStyle(element).fill);
    assert.equal(fill, eligible ? palette[leader] : 'rgb(24, 43, 54)', `${id}/${side}/${reference.id} truthful categorical fill`);
    assert.equal(await shape.getAttribute('data-value'), null, 'Categorical winners never retain quantitative share values');
    if (eligible) await expect(shape).toHaveAttribute('aria-label', new RegExp(partyNames[leader]));
    else if (reference.geometryValid && p.status === 'matched') await expect(shape).toHaveAttribute('aria-label', /empate/i);
  }
}
async function winners() {
  await reset();
  const button = page.getByRole('button', { name: 'Ganadores', exact: true });
  await button.press('Enter'); await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#winner-legend')).toBeVisible();
  await expect(page.locator('#share-legend')).not.toBeVisible(); await expect(page.locator('#change-legend')).not.toBeVisible();
  for (const group of Object.keys(partyNames)) await expect(page.locator('#winner-legend')).toContainText(partyNames[group]);
  await expect(page.locator('#map-a')).toHaveAttribute('data-scale', 'categorical');
  await expect(page.locator('#map-b')).toHaveAttribute('data-scale', 'categorical');
  await winnerChildren('buenos-aires', geography.partidos);
  const fills = await page.locator('#map-a .child-shape, #map-b .child-shape').evaluateAll(shapes => shapes.map(shape => shape.getAttribute('style')));
  await page.getByLabel('Agrupación', { exact: true }).selectOption('d'); party = 'd';
  assert.deepEqual(await page.locator('#map-a .child-shape, #map-b .child-shape').evaluateAll(shapes => shapes.map(shape => shape.getAttribute('style'))), fills);
  await page.getByRole('button', { name: 'Acercar mapas', exact: true }).click();
  assert.equal(await page.locator('#camera-a').getAttribute('transform'), await page.locator('#camera-b').getAttribute('transform'));
  await select('argentina'); await winnerChildren('argentina', geography.provinces);
  await open('province-catamarca');
  for (const side of ['a', 'b']) { await expect(page.locator('#winner-' + side)).toContainText(/empate/i); assert.equal(await page.locator(`#map-${side} .reference-outline`).evaluate(element => getComputedStyle(element).fill), 'rgb(17, 43, 58)'); }
  await select('rosales');
  for (const side of ['a', 'b']) { const leader = winner(pair('rosales')[side]); await expect(page.locator('#winner-' + side)).toContainText(partyNames[leader]); assert.equal(await page.locator(`#map-${side} .reference-outline`).evaluate(element => getComputedStyle(element).fill), palette[leader]); }
  await page.getByRole('button', { name: 'Intercambiar A y B', exact: true }).click(); [yearA, yearB] = [yearB, yearA];
  for (const side of ['a', 'b']) await expect(page.locator('#winner-' + side)).toContainText(partyNames[winner(pair('rosales')[side])]);
  for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) { await open(id); for (const side of ['a', 'b']) { await expect(page.locator('#winner-' + side)).toContainText(partyNames[winner(pair(id)[side])]); assert.equal(await page.locator(`#map-${side} .reference-outline`).evaluate(element => getComputedStyle(element).fill), 'rgb(17, 43, 58)'); } }
  await select('argentina'); await open('province-cordoba');
  for (const side of ['a', 'b']) assert.equal(await page.locator(`#map-${side} .reference-outline`).evaluate(element => getComputedStyle(element).fill), 'rgb(17, 43, 58)');
  await select('argentina'); await page.getByLabel('Categoría B', { exact: true }).selectOption('concejales');
  assert.deepEqual(await page.locator('#map-a .child-shape, #map-b .child-shape').evaluateAll(shapes => [...new Set(shapes.map(shape => getComputedStyle(shape).fill))]), ['rgb(24, 43, 54)']);
  await expect(page.locator('#winner-a')).not.toContainText(/Alianza|Lista/);
  await expect(page.locator('#winner-b')).not.toContainText(/Alianza|Lista/);
  await reset(); await button.click(); await select('argentina');
  await mkdir('checks', { recursive: true });
  await page.screenshot({ path: 'checks/winners.png', fullPage: true });
  for (const width of [1276, 390, 320]) {
    await page.setViewportSize({ width, height: 892 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), []);
    if (width !== 1276) await page.screenshot({ path: `checks/winners-mobile-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Participación', exact: true }).click();
  await expect(page.locator('#map-a')).toHaveAttribute('data-scale', '0-100');
  await expect(page.locator('#winner-legend')).not.toBeVisible();
  await page.getByRole('button', { name: 'Cambio', exact: true }).click(); await expect(page.locator('#change-map')).toBeVisible();
  checks.push('paired-categorical-159-units-winners-ties-neutral-blocked-ancestor-swap-mobile-axe');
}
try {
  for (const [name, task] of Object.entries({ coverage, ranking, votes, winners })) if (mode === 'all' || mode === name) await task();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await mkdir('checks', { recursive: true });
  const report = { status: 'PASS', mode, checks, url, method: 'Actual served isolated Chromium entry; frozen synthetic inputs; emulated mobile, not production' };
  await writeFile(`checks/enhancements-${mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', mode, checks, message: error.message }, null, 2)); process.exitCode = 1;
} finally {
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}
