import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';

const require = createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const output = fileURLToPath(new URL('./checks/', import.meta.url));
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1276, height: 892 } });
const page = await context.newPage();
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url()); });
const format = value => new Intl.NumberFormat('es-AR').format(value);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
let fixture;
const navigator = page.getByRole('region', { name: 'Navegador territorial', exact: true });
function verifyFixtures() {
  assert.equal(fixture.source.kind, 'demonstration');
  assert.equal(Object.keys(fixture.nodes).length, 174);
  const family = ['rosales', ...Object.keys(fixture.nodes).filter(id => fixture.nodes[id].fictional)];
  assert.equal(family.length, 15);
  for (const year of ['2025', '2023']) {
    const entries = fixture.results[year].concejales;
    for (const id of family) {
      const entry = entries[id];
      assert.equal(entry.status, 'complete', 'Council demo must have a complete sample at ' + year + '/' + id);
      assert.ok(entry.votes, 'Council demo votes must not be missing');
      assert.deepEqual(Object.keys(entry.votes).sort(), ['a', 'b', 'c', 'd']);
      assert.ok(Object.values(entry.votes).every(value => Number.isSafeInteger(value) && value >= 0));
      if (fixture.nodes[id].childIds.length) {
        assert.equal(entry.aggregation, 'children');
        for (const party of ['a', 'b', 'c', 'd']) assert.equal(entry.votes[party], fixture.nodes[id].childIds.reduce((total, child) => total + entries[child].votes[party], 0));
      }
    }
    assert.deepEqual(entries.rosales.votes, year === '2025' ? { a: 21482, b: 18736, c: 6924, d: 2158 } : { a: 19540, b: 20930, c: 5690, d: 2640 });
    for (const id of Object.keys(fixture.nodes).filter(id => !family.includes(id))) {
      assert.equal(entries[id].status, 'missing');
      assert.equal(entries[id].votes, null, 'No Council data invented outside the accepted Rosales example');
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(stable({ 2023: fixture.results['2023']['national-deputies'], 2025: fixture.results['2025']['national-deputies'] }))).digest('hex');
  assert.equal(hash, '080c0bd14d33c48b863de2f3e04105ff8a6db27afd21a1a3f9addd5849a71ad2', 'Existing national results must remain unchanged');
}
async function assertNode(id, year = '2025', category = 'concejales', party = 'c') {
  await expect(page.locator('#territory-map')).toHaveAttribute('data-scope', id);
  await expect(page.getByLabel('Territorio', { exact: true })).toHaveValue(id);
  await expect(page.getByLabel('Elección', { exact: true })).toHaveValue(year);
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveValue(category);
  await expect(page.getByLabel('Agrupación', { exact: true })).toHaveValue(party);
  const entry = fixture.results[year][category][id];
  await expect(page.locator('#total-votes')).toHaveText(entry.votes ? format(Object.values(entry.votes).reduce((total, value) => total + value, 0)) : '');
}
async function openChild(id, year = '2025') {
  await navigator.getByRole('button', { name: 'Abrir ' + fixture.nodes[id].label, exact: true }).click();
  await assertNode(id, year);
  await expect(navigator.locator('#navigator-title')).toBeFocused();
}
async function axe(label) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(report.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), [], label);
}
async function capture(name, fullPage = true) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
  await page.screenshot({ path: output + name, fullPage });
}
async function run() {
  const response = await page.goto(url);
  assert.equal(response.status(), 200, 'Actual served prototype exists');
  fixture = await (await page.request.get(url + 'assets/demo-results.json')).json();
  if (process.argv.includes('--fixture-only')) {
    verifyFixtures();
    checks.push('served-council-fictional-partition-and-preserved-national-fixtures');
    return;
  }
  await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
  await page.getByLabel('Categoría', { exact: true }).selectOption('concejales');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('c');
  await assertNode('rosales');
  await expect(navigator, 'New next-level navigation must be visible beside the map').toBeVisible({ timeout: 2000 });
  await expect(navigator.getByRole('heading', { name: 'Circuitos de Coronel Rosales', exact: true })).toBeVisible();
  const navBox = await navigator.boundingBox(), mapBox = await page.getByRole('region', { name: 'Mapa territorial de referencia', exact: true }).boundingBox();
  assert.ok(navBox.x >= mapBox.x + mapBox.width - 2, 'Desktop navigator belongs in the existing right detail panel');
  const first = navigator.getByRole('button', { name: 'Abrir Circuito de demostración A', exact: true });
  const firstBox = await first.boundingBox();
  assert.ok(firstBox.height >= 44, 'Visible navigation targets are at least44px high');
  assert.ok(firstBox.y >= 0 && firstBox.y + firstBox.height <= 892, 'Circuit entry is discoverable in the initial desktop viewport');
  assert.ok(await navigator.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('#overall-outcome')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Navigation precedes result availability blocks');
  checks.push('actual-entry-visible-right-panel-circuit-navigation');
  verifyFixtures();
  checks.push('served-council-fictional-partition-and-preserved-national-fixtures');
  await mkdir(output, { recursive: true });
  await axe('Rosales Council desktop');
  await capture('navigator-desktop.png', false);
  for (const year of ['2025', '2023']) {
    await page.getByLabel('Elección', { exact: true }).selectOption(year);
    await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
    for (const [id, title] of [['demo-circuit-01', 'Establecimientos del circuito'], ['demo-school-01-01', 'Mesas del establecimiento'], ['demo-table-01-01-01', 'Mesa seleccionada']]) {
      await openChild(id, year);
      await expect(navigator.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.locator('#child-geographies [data-node-id]')).toHaveCount(0);
      await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope', 'rosales');
      if (fixture.nodes[id].childIds.length) await expect(navigator.getByRole('button', { name: /^Abrir / })).toHaveCount(2);
      else { await expect(navigator.getByRole('button', { name: /^Abrir / })).toHaveCount(0); await expect(navigator).toContainText('Fin del recorrido'); }
    }
    const route = navigator.getByRole('navigation', { name: 'Ruta de exploración', exact: true });
    for (const label of ['Coronel Rosales', 'Circuito de demostración A', 'Establecimiento de demostración A1', 'Mesa de demostración A1-1']) await expect(route).toContainText(label);
    if (year === '2025') await capture('navigator-mesa.png', false);
    await navigator.getByRole('button', { name: 'Volver a Establecimiento de demostración A1', exact: true }).click();
    await assertNode('demo-school-01-01', year);
    await route.getByRole('button', { name: 'Ir a Coronel Rosales', exact: true }).click();
    await assertNode('rosales', year);
  }
  checks.push('navigator-only-council-both-years-deep-path-back-focus-and-no-fake-geography');
  await page.getByLabel('Elección', { exact: true }).selectOption('2025');
  await page.getByLabel('Territorio', { exact: true }).selectOption('buenos-aires');
  await assertNode('buenos-aires');
  const search = navigator.getByRole('searchbox', { name: 'Buscar en el siguiente nivel', exact: true });
  await expect(search).toBeVisible();
  const winnerAttrs = await page.locator('#child-geographies [data-node-id]').evaluateAll(elements => elements.map(element => [element.getAttribute('data-node-id'), element.getAttribute('data-winner')]));
  await search.fill('Coronel Rosales');
  await expect(navigator.getByRole('button', { name: /^Abrir / })).toHaveCount(1);
  await assertNode('buenos-aires');
  assert.deepEqual(await page.locator('#child-geographies [data-node-id]').evaluateAll(elements => elements.map(element => [element.getAttribute('data-node-id'), element.getAttribute('data-winner')])), winnerAttrs);
  await search.fill('nombre inexistente 123');
  await expect(navigator).toContainText('No hay coincidencias');
  await expect(navigator.getByRole('button', { name: /^Abrir / })).toHaveCount(0);
  await search.fill('Adolfo Alsina');
  const missingId = Object.keys(fixture.nodes).find(id => fixture.nodes[id].label === 'Adolfo Alsina');
  await openChild(missingId);
  await expect(navigator).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar resultados exactos', exact: true })).toBeDisabled();
  await expect(navigator.getByRole('button', { name: 'Volver a Buenos Aires', exact: true })).toBeVisible();
  await navigator.getByRole('button', { name: 'Volver a Buenos Aires', exact: true }).click();
  await assertNode('buenos-aires');
  await expect(navigator.getByRole('button', { name: /^Abrir / })).toHaveCount(135);
  checks.push('navigator-search-independent-and-no-data-navigation-remains-available');
  await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
  await navigator.getByRole('button', { name: 'Abrir Circuito de demostración A', exact: true }).focus();
  await page.keyboard.press('Enter');
  await assertNode('demo-circuit-01');
  await expect(navigator.locator('#navigator-title')).toBeFocused();
  await navigator.getByRole('button', { name: 'Abrir Establecimiento de demostración A1', exact: true }).focus();
  await page.keyboard.press('Space');
  await assertNode('demo-school-01-01');
  await axe('Council deep navigation keyboard');
  checks.push('native-button-keyboard-focus-and-desktop-axe');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
    for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) {
      await openChild(id);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
      await axe('mobile/' + width + '/' + id);
    }
    await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
    await capture('navigator-mobile-' + width + '.png');
    checks.push('mobile-' + width + '-navigator-only-deep-flow-and-axe');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Territorio', { exact: true }).selectOption('rosales');
  await openChild('demo-circuit-01');
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => ['running', 'pending'].includes(animation.playState)).length), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  checks.push('reduced-motion-and-offline-runtime');
}
try {
  await run();
  await mkdir(output, { recursive: true });
  const report = { status: 'PASS', checks, url, method: 'Owned local Chromium, mobile emulation; fictional Council fixtures, reference geography only; no app checks' };
  await writeFile(output + 'navigator-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', checks, message: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await page.close();
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
