import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';

const require = createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1276, height: 892 } });
const page = await context.newPage();
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url()); });
const number = value => new Intl.NumberFormat('es-AR').format(value);
const decimal = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const signed = value => (value > 0 ? '+' : '') + decimal(value) + ' pp';
const sum = votes => Object.values(votes).reduce((total, count) => total + count, 0);
let fixture, policy;
const nav = page.getByRole('region', { name: 'Navegador territorial', exact: true });

async function loadInputs() {
  const response = await page.request.get(url + 'assets/comparison-policy.json');
  assert.equal(response.status(), 200, 'Comparison-only fictional correspondence policy must exist at its served entry');
  policy = await response.json();
  assert.equal(policy.source.kind, 'demonstration');
  assert.equal(policy.source.historicalBoundaryStatus, 'unverified');
  assert.equal(policy.correspondence.kind, 'synthetic-only');
  assert.deepEqual(policy.correspondence.partyIds, ['a', 'b', 'c', 'd']);
  assert.equal(policy.overrides['province-mendoza'].status, 'unmapped');
  assert.deepEqual(policy.overrides['province-mendoza'].unmappedPartyIds, ['d']);
  assert.equal(policy.overrides['province-jujuy'].status, 'discontinuous');
  const fixtureResponse = await page.request.get(url + 'assets/demo-results.json');
  const bytes = await fixtureResponse.body();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'cf2c1db19469ddf04a12e3ab7cd2eaec954c0290421ada254b8f81eace84040f');
  fixture = JSON.parse(bytes.toString());
  assert.equal(Object.keys(fixture.nodes).length, 174);
  for (const year of ['2023', '2025']) for (const category of ['national-deputies', 'concejales']) for (const [id, entry] of Object.entries(fixture.results[year][category])) {
    if (entry.votes) assert.ok(Object.values(entry.votes).every(value => Number.isSafeInteger(value) && value >= 0));
    if (entry.aggregation === 'children') for (const party of ['a', 'b', 'c', 'd']) assert.equal(entry.votes[party], fixture.nodes[id].childIds.reduce((total, child) => total + fixture.results[year][category][child].votes[party], 0));
  }
}
async function node(id) {
  await expect(page.getByLabel('Territorio', { exact: true })).toHaveValue(id);
  await expect(page.locator('#map-a')).toHaveAttribute('data-scope', id);
  await expect(page.locator('#map-b')).toHaveAttribute('data-scope', id);
}
async function open(id) {
  await nav.getByRole('button', { name: 'Abrir ' + fixture.nodes[id].label, exact: true }).click();
  await node(id);
  await expect(page.locator('#navigator-title')).toBeFocused();
}
async function pair(id, category = 'national-deputies', a = '2023', b = '2025', party = 'a') {
  await node(id);
  await expect(page.locator('#comparison-status')).toHaveAttribute('data-status', 'matched');
  const left = fixture.results[a][category][id].votes, right = fixture.results[b][category][id].votes;
  await expect(page.locator('#denominator-a')).toHaveText(number(sum(left)));
  await expect(page.locator('#denominator-b')).toHaveText(number(sum(right)));
  await expect(page.locator('#votes-a')).toHaveText(number(left[party]));
  await expect(page.locator('#votes-b')).toHaveText(number(right[party]));
  await expect(page.locator('#share-a')).toHaveText(decimal(left[party] / sum(left) * 100) + ' %');
  await expect(page.locator('#share-b')).toHaveText(decimal(right[party] / sum(right) * 100) + ' %');
  await expect(page.locator('#delta-pp')).toHaveText(signed((right[party] / sum(right) - left[party] / sum(left)) * 100));
  for (const group of ['a', 'b', 'c', 'd']) {
    const row = page.locator('#party-comparison-body [data-party="' + group + '"]');
    await expect(row.locator('[data-field="votes-a"]')).toHaveText(number(left[group]));
    await expect(row.locator('[data-field="votes-b"]')).toHaveText(number(right[group]));
    await expect(row.locator('[data-field="share-a"]')).toHaveText(decimal(left[group] / sum(left) * 100) + ' %');
    await expect(row.locator('[data-field="share-b"]')).toHaveText(decimal(right[group] / sum(right) * 100) + ' %');
    await expect(row.locator('[data-field="delta"]')).toHaveText(signed((right[group] / sum(right) - left[group] / sum(left)) * 100));
  }
}
async function blocked(id, status) {
  await node(id);
  await expect(page.locator('#comparison-status')).toHaveAttribute('data-status', status);
  for (const selector of ['#denominator-a', '#denominator-b', '#votes-a', '#votes-b', '#share-a', '#share-b', '#delta-pp']) await expect(page.locator(selector)).toHaveText('');
  await expect(page.locator('#party-comparison-body [data-party]')).toHaveCount(0);
  await expect(nav).toBeVisible();
}
async function axe(label) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(report.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), [], label);
}
async function capture(name, fullPage = false) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'checks/' + name, fullPage });
}
async function run() {
  if (process.argv.includes('--policy-only')) { await loadInputs(); checks.push('served-fictional-policy-and-frozen-174-node-input'); return; }
  const response = await page.goto(url);
  assert.equal(response.status(), 200, 'Actual isolated Comparison entry must exist before implementation can pass');
  await expect(page.getByRole('heading', { name: 'Comparación electoral', exact: true })).toBeVisible();
  await expect(page.getByText('Datos de demostración', { exact: true })).toBeVisible();
  await loadInputs();
  await pair('buenos-aires');
  await expect(page.getByLabel('Elección A', { exact: true })).toHaveValue('2023');
  await expect(page.getByLabel('Elección B', { exact: true })).toHaveValue('2025');
  assert.equal(await page.locator('#map-a').getAttribute('viewBox'), await page.locator('#map-b').getAttribute('viewBox'));
  await expect(page.locator('#map-a')).toHaveAttribute('data-scale', '0-100');
  await expect(page.locator('#map-b')).toHaveAttribute('data-scale', '0-100');
  const box = await nav.boundingBox();
  assert.ok(box.x > 800 && box.y < 650, 'Next-level navigator stays discoverable in existing right panel');
  assert.ok((await nav.getByRole('button', { name: 'Abrir Adolfo Alsina', exact: true }).boundingBox()).height >= 44);
  await axe('Initial paired maps');
  await mkdir('checks', { recursive: true });
  await capture('desktop.png');
  checks.push('actual-entry-paired-fixed-scale-and-side-specific-arithmetic');
  for (const group of ['a', 'b', 'c', 'd']) { await page.getByLabel('Agrupación', { exact: true }).selectOption(group); await pair('buenos-aires', 'national-deputies', '2023', '2025', group); }
  await page.getByLabel('Agrupación', { exact: true }).selectOption('a');
  await page.getByRole('button', { name: 'Intercambiar A y B', exact: true }).click();
  await pair('buenos-aires', 'national-deputies', '2025', '2023');
  await page.getByRole('button', { name: 'Intercambiar A y B', exact: true }).click();
  await pair('buenos-aires');
  await page.getByRole('button', { name: 'Acercar mapas', exact: true }).click();
  assert.equal(await page.locator('#camera-a').getAttribute('transform'), await page.locator('#camera-b').getAttribute('transform'));
  await pair('buenos-aires');
  await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
  await page.getByRole('button', { name: 'Cambio', exact: true }).click();
  await expect(page.locator('#change-map')).toBeVisible();
  await expect(page.locator('#change-map')).toHaveAttribute('data-scale', '-100-100');
  await expect(page.locator('#map-a')).not.toBeVisible();
  await pair('buenos-aires');
  await capture('change.png');
  await page.getByRole('button', { name: 'Participación', exact: true }).click();
  checks.push('all-group-denominators-swap-sign-synchronized-camera-and-difference-view');
  await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
  await page.getByLabel('Categoría A', { exact: true }).selectOption('concejales');
  await blocked('rosales', 'category-mismatch');
  await page.getByLabel('Categoría B', { exact: true }).selectOption('concejales');
  await pair('rosales', 'concejales');
  for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) {
    await open(id); await pair(id, 'concejales');
    await expect(page.locator('#map-a')).toHaveAttribute('data-reference-scope', 'rosales');
    await expect(page.locator('#map-b')).toHaveAttribute('data-reference-scope', 'rosales');
    await expect(page.locator('#map-a [data-node-id], #map-b [data-node-id]')).toHaveCount(0);
  }
  await expect(nav).toContainText('Fin del recorrido');
  await capture('mesa.png');
  await nav.getByRole('navigation', { name: 'Ruta de exploración', exact: true }).getByRole('button', { name: 'Ir a Coronel Rosales', exact: true }).click();
  await pair('rosales', 'concejales');
  await page.getByLabel('Elección B', { exact: true }).selectOption('2023');
  await blocked('rosales', 'same-year');
  await page.getByLabel('Elección B', { exact: true }).selectOption('2025');
  await pair('rosales', 'concejales');
  checks.push('same-context-council-deep-flow-mismatch-same-year-block-and-focus');
  await page.getByLabel('Territorio', { exact: true }).selectOption('buenos-aires');
  await blocked('buenos-aires', 'missing');
  const search = nav.getByRole('searchbox', { name: 'Buscar en el siguiente nivel', exact: true });
  await search.fill('Coronel Rosales');
  await expect(nav.getByRole('button', { name: /^Abrir / })).toHaveCount(1);
  await blocked('buenos-aires', 'missing');
  await open('rosales'); await pair('rosales', 'concejales');
  await nav.getByRole('button', { name: 'Volver a Buenos Aires', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(nav.getByRole('button', { name: /^Abrir / })).toHaveCount(135);
  await page.getByLabel('Categoría A', { exact: true }).selectOption('national-deputies');
  await page.getByLabel('Categoría B', { exact: true }).selectOption('national-deputies');
  await page.getByLabel('Territorio', { exact: true }).selectOption('argentina');
  await blocked('argentina', 'partial');
  await expect(page.locator('#national-reference')).toBeVisible();
  for (const [id, status] of [['province-chaco', 'missing'], ['province-chubut', 'partial'], ['province-ciudad-autonoma-de-buenos-aires', 'zero'], ['province-mendoza', 'unmapped'], ['province-jujuy', 'discontinuous']]) {
    await open(id); await blocked(id, status);
    await nav.getByRole('button', { name: 'Volver a Argentina', exact: true }).click();
  }
  checks.push('search-independent-missing-partial-zero-unmapped-discontinuous-fail-closed');
  const referenceData = await (await page.request.get(url + 'assets/winner-reference-paths.json')).json();
  assert.equal(referenceData.provinces.find(item => item.id === 'province-catamarca').geometryValid, true);
  await open('province-catamarca');
  await pair('province-catamarca');
  await expect(page.locator('#reference-note')).toContainText('Referencia geográfica independiente');
  await expect(page.locator('#reference-note')).not.toContainText('geometría de origen no válida');
  const validFillA = await page.locator('#map-a .reference-outline').getAttribute('style');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('d');
  await pair('province-catamarca', 'national-deputies', '2023', '2025', 'd');
  assert.notEqual(await page.locator('#map-a .reference-outline').getAttribute('style'), validFillA, 'Valid selected reference retains quantitative share color');
  await nav.getByRole('button', { name: 'Volver a Argentina', exact: true }).click();
  assert.equal(referenceData.provinces.find(item => item.id === 'province-cordoba').geometryValid, false);
  await open('province-cordoba');
  await pair('province-cordoba', 'national-deputies', '2023', '2025', 'd');
  await expect(page.locator('#reference-note')).toContainText('Cartografía observada');
  await expect(page.locator('#reference-note')).toContainText('geometría de origen no válida');
  const observedFills = await page.locator('#map-a .reference-outline, #map-b .reference-outline, #change-map .reference-outline').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
  await page.getByLabel('Agrupación', { exact: true }).selectOption('a');
  await pair('province-cordoba');
  assert.deepEqual(await page.locator('#map-a .reference-outline, #map-b .reference-outline, #change-map .reference-outline').evaluateAll(elements => elements.map(element => element.getAttribute('style'))), observedFills, 'Actual observed selected references stay neutral across group changes');
  await page.getByRole('button', { name: 'Cambio', exact: true }).click();
  await expect(page.locator('#change-map .reference-outline')).toHaveClass(/source-observed/);
  await page.getByRole('button', { name: 'Participación', exact: true }).click();
  checks.push('truthful-selected-reference-quality-valid-color-and-observed-neutrality');
  await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
  await nav.getByRole('button', { name: 'Abrir Circuito de demostración A', exact: true }).press('Enter');
  await pair('demo-circuit-01');
  await expect(page.locator('#navigator-title')).toBeFocused();
  await nav.getByRole('button', { name: 'Abrir Establecimiento de demostración A1', exact: true }).press('Space');
  await pair('demo-school-01-01');
  await axe('Keyboard deep flow');
  checks.push('native-keyboard-navigation-and-desktop-axe');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
    await pair('rosales');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal page overflow');
    await axe('Mobile paired maps ' + width);
    await capture('mobile-' + width + '.png', true);
    for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) await open(id);
    await axe('Mobile terminal mesa ' + width);
    checks.push('mobile-' + width + '-paired-deep-flow-no-overflow-axe');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Territorio', { exact: true }).selectOption('buenos-aires');
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => ['running', 'pending'].includes(a.playState)).length), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  checks.push('reduced-motion-offline-no-runtime-errors');
}
try {
  await run(); await mkdir('checks', { recursive: true });
  const report = { status: 'PASS', checks, url, method: 'Actual owned local Chromium; emulated mobile; synthetic-only pair correspondence; no production checks' };
  await writeFile('checks/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', checks, message: error.message }, null, 2)); process.exitCode = 1;
} finally {
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}
