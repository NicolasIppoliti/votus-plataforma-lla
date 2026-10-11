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
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1040 } });
const page = await context.newPage();
const errors = [], externalRequests = [], checks = [];
const number = value => new Intl.NumberFormat('es-AR').format(value);
const decimal = value => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const parties = { a: 'Alianza A', b: 'Alianza B', c: 'Lista C', d: 'Lista D' };
let fixture, geography;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
const result = (id, year = '2025', category = 'national-deputies') => fixture.results[year]?.[category]?.[id] ?? { status: 'missing', votes: null };
const sum = entry => entry.votes ? Object.values(entry.votes).reduce((a, b) => a + b, 0) : null;
function stats(entry) {
  const total = sum(entry);
  if (entry.status === 'missing' || total === null) return { state: 'missing' };
  if (total === 0) return { state: 'zero' };
  if (entry.status === 'partial') return { state: 'partial' };
  const ordered = Object.entries(entry.votes).sort((a, b) => b[1] - a[1]);
  if (ordered[0][1] === ordered[1][1]) return { state: 'tie' };
  return { state: 'complete', winner: ordered[0][0], share: ordered[0][1] / total * 100, margin: (ordered[0][1] - ordered[1][1]) / total * 100 };
}
async function selectAnchor(id, year = '2025', category = 'national-deputies') {
  await page.getByLabel('Territorio', { exact: true }).selectOption(id);
  await assertNode(id, year, category);
}
async function assertNode(id, year = '2025', category = 'national-deputies') {
  const node = fixture.nodes[id];
  await expect(page.getByRole('region', { name: 'Detalle territorial' }).getByRole('heading', { name: node.label, exact: true })).toBeVisible();
  await expect(page.getByLabel('Elección', { exact: true })).toHaveValue(year);
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveValue(category);
  await expect(page.locator('#territory-map')).toHaveAttribute('data-scope', id);
  const entry = result(id, year, category), total = sum(entry);
  if (total !== null && entry.status !== 'missing') await expect(page.locator('#total-votes')).toHaveText(number(total));
  else await expect(page.locator('#total-votes')).toHaveText('');
  await expect(page.getByRole('status', { name: 'Estado de selección' })).toContainText(node.label);
}
async function toggleExact(open) {
  const button = page.getByRole('button', { name: open ? 'Mostrar resultados exactos' : 'Ocultar resultados exactos', exact: true });
  if (await button.count() && await button.isEnabled()) await button.click();
}
async function assertExact(id, year, category = 'national-deputies') {
  const entry = result(id, year, category), total = sum(entry);
  const table = page.getByRole('table', { name: 'Resultados de demostración', exact: true });
  if (entry.status === 'missing') {
    await expect(table).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Mostrar resultados exactos', exact: true })).toBeDisabled();
    return;
  }
  await toggleExact(true);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  for (const [index, id] of Object.keys(parties).entries()) {
    await expect(rows.nth(index).getByRole('rowheader')).toContainText(parties[id]);
    await expect(rows.nth(index).getByRole('cell').nth(0)).toHaveText(number(entry.votes[id]));
    await expect(rows.nth(index).getByRole('cell').nth(1)).toHaveText(total > 0 ? `${decimal(entry.votes[id] / total * 100)} %` : '—');
  }
  await expect(table.locator('tfoot')).toContainText(number(total));
}
async function assertChildren(id, year = '2025', category = 'national-deputies') {
  const node = fixture.nodes[id];
  const table = page.getByRole('table', { name: 'Resultados por territorio', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(node.childIds.length);
  for (const child of node.childIds) {
    const row = table.locator(`tr[data-node-id="${child}"]`), entry = result(child, year, category), computed = stats(entry);
    await expect(row).toHaveAttribute('data-result-state', computed.state);
    if (computed.state === 'complete') {
      await expect(row).toContainText(parties[computed.winner]);
      await expect(row).toContainText(`${decimal(computed.share)} %`);
      await expect(row).toContainText(`${decimal(computed.margin)} pp`);
    }
    const shape = page.locator(`#child-geographies [data-node-id="${child}"]`);
    if (await shape.count()) {
      const reference = [...geography.provinces, ...geography.partidos].find(item => item.id === child);
      if (reference && !reference.geometryValid) await expect(row).toContainText('Cartografía observada');
      if (reference?.geometryValid && computed.state === 'complete') await expect(shape).toHaveAttribute('data-winner', computed.winner);
      else await expect(shape).not.toHaveAttribute('data-winner', /^[abcd]$/);
    }
  }
}
async function assertAxe(label) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), label).toEqual([]);
}
async function capture(name) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
  await page.screenshot({ path: `${output}${name}`, fullPage: true });
}
try {
  const response = await page.goto(url);
  expect(response.status(), 'Actual served prototype exists').toBe(200);
  await expect(page.getByRole('heading', { name: 'Exploración territorial', exact: true })).toBeVisible();
  await expect(page.getByLabel('Categoría', { exact: true }), 'Stable national electoral context before winner implementation').toHaveValue('national-deputies');
  await expect(page.getByRole('region', { name: 'Ganadores por territorio', exact: true })).toBeVisible();
  const demoResponse = await context.request.get(`${url}assets/demo-results.json`);
  expect(demoResponse.status()).toBe(200);
  fixture = await demoResponse.json();
  const mapResponse = await context.request.get(`${url}assets/winner-reference-paths.json`);
  expect(mapResponse.status()).toBe(200);
  geography = await mapResponse.json();
  expect(geography.provinces.length).toBe(24);
  expect(geography.partidos.length).toBe(135);
  expect(new Set(geography.provinces.map(item => item.id)).size).toBe(24);
  expect(new Set(geography.partidos.map(item => item.id)).size).toBe(135);
  expect(geography.partidos.filter(item => !item.geometryValid).length).toBe(2);
  expect(geography.source.featureCount).toBe(538);
  expect(geography.source.invalidFeatureCount).toBe(22);
  expect(geography.source.polygonCount).toBe(1976);
  expect(geography.source.ringCount).toBe(2213);
  expect(geography.source.referenceOnly).toBe(true);
  expect(fixture.nodes.argentina.childIds.length).toBe(24);
  expect(fixture.nodes['buenos-aires'].childIds.length).toBe(135);
  for (const [id, node] of Object.entries(fixture.nodes)) {
    expect(new Set(node.childIds).size, `unique children/${id}`).toBe(node.childIds.length);
    for (const child of node.childIds) expect(fixture.nodes[child]?.parentId, `parent identity/${child}`).toBe(id);
    const ancestors = new Set([id]);
    let parent = node.parentId;
    while (parent) {
      expect(ancestors.has(parent), `no cycles/${id}`).toBe(false);
      ancestors.add(parent);
      expect(fixture.nodes[parent], `valid ancestor/${id}`).toBeTruthy();
      parent = fixture.nodes[parent].parentId;
    }
  }
  checks.push('actual-entry-stable-category-and-complete-reference-inventory');
  await mkdir(output, { recursive: true });
  for (const [year, categories] of Object.entries(fixture.results)) {
    for (const [category, entries] of Object.entries(categories)) {
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.votes) {
          expect(Object.keys(entry.votes).sort()).toEqual(Object.keys(parties));
          expect(Object.values(entry.votes).every(v => Number.isSafeInteger(v) && v >= 0)).toBe(true);
        }
        expect(['complete', 'partial', 'missing']).toContain(entry.status);
        if (entry.status === 'missing') expect(entry.votes).toBeNull();
        if (entry.coverage) {
          expect(Number.isSafeInteger(entry.coverage.reported) && Number.isSafeInteger(entry.coverage.total)).toBe(true);
          expect(entry.coverage.reported >= 0 && entry.coverage.total >= entry.coverage.reported).toBe(true);
        }
        if (entry.aggregation === 'children') {
          expect(fixture.nodes[id].childIds.length).toBeGreaterThan(0);
          if (entry.status === 'complete') for (const child of fixture.nodes[id].childIds) expect(entries[child]?.status, `complete partition ${year}/${category}/${id}/${child}`).toBe('complete');
          for (const party of Object.keys(parties)) expect(entry.votes[party], `same-context child sum ${year}/${category}/${id}/${party}`).toBe(fixture.nodes[id].childIds.reduce((value, child) => value + (entries[child]?.votes?.[party] ?? 0), 0));
        }
        if (entry.votes && entry.aggregation === 'aggregate' && fixture.nodes[id].childIds.length) {
          for (const party of Object.keys(parties)) {
            const knownChildVotes = fixture.nodes[id].childIds.reduce((value, child) => value + (entries[child]?.votes?.[party] ?? 0), 0);
            expect(knownChildVotes, `known child containment ${year}/${category}/${id}/${party}`).toBeLessThanOrEqual(entry.votes[party]);
          }
        }
      }
    }
  }
  checks.push('integer-fixtures-and-explicit-same-context-child-aggregation');
  for (const scope of ['argentina', 'buenos-aires', 'rosales']) {
    await selectAnchor(scope);
    await assertChildren(scope);
    for (const year of ['2025', '2023']) {
      await page.getByLabel('Elección', { exact: true }).selectOption(year);
      await assertNode(scope, year);
      await assertExact(scope, year);
    }
    await page.getByLabel('Elección', { exact: true }).selectOption('2025');
    await toggleExact(false);
    await assertAxe(`desktop/${scope}`);
    await capture(`desktop-${scope}.png`);
    checks.push(`${scope}-winner-table-shares-margins-exact-results-both-years-axe`);
  }
  await selectAnchor('argentina');
  await expect(page.locator('#child-geographies [data-node-id]')).toHaveCount(24);
  const polar = page.getByRole('img', { name: 'Extensión completa de la referencia argentina', exact: true });
  await expect(polar).toBeVisible();
  await expect(polar).toHaveAttribute('data-components', '1980');
  await expect(polar.locator('path')).toHaveAttribute('d', /M.{300}/);
  for (const state of ['tie', 'missing', 'partial', 'zero']) {
    const child = fixture.nodes.argentina.childIds.find(id => stats(result(id)).state === state);
    expect(child, `reachable ${state} child fixture`).toBeTruthy();
    await expect(page.getByRole('table', { name: 'Resultados por territorio', exact: true }).locator(`tr[data-node-id="${child}"]`)).toHaveAttribute('data-result-state', state);
    const mapShape = page.locator(`#child-geographies [data-node-id="${child}"]`);
    if (await mapShape.count()) await expect(mapShape).not.toHaveAttribute('data-winner', /^[abcd]$/);
  }
  checks.push('full-national-reference-and-distinct-tie-missing-partial-zero-no-winner-fills');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('a');
  const before = await page.locator('#total-votes').textContent();
  const winners = await page.locator('#child-geographies [data-winner]').evaluateAll(elements => elements.map(e => [e.getAttribute('data-node-id'), e.getAttribute('data-winner')]));
  await page.getByLabel('Agrupación', { exact: true }).selectOption('b');
  expect(await page.locator('#total-votes').textContent()).toBe(before);
  expect(await page.locator('#child-geographies [data-winner]').evaluateAll(elements => elements.map(e => [e.getAttribute('data-node-id'), e.getAttribute('data-winner')]))).toEqual(winners);
  await page.getByRole('button', { name: 'Acercar mapa', exact: true }).click();
  await assertNode('argentina');
  await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
  await page.getByLabel('Agrupación', { exact: true }).selectOption('all');
  checks.push('party-highlight-and-camera-never-rewrite-winners-or-denominator');
  const children = page.getByRole('region', { name: 'Ganadores por territorio', exact: true });
  await children.getByRole('button', { name: 'Explorar Buenos Aires', exact: true }).focus();
  await page.keyboard.press('Enter');
  await assertNode('buenos-aires');
  await expect(page.locator('#child-geographies [data-node-id]')).toHaveCount(135);
  await children.getByRole('button', { name: 'Explorar Coronel Rosales', exact: true }).click();
  await assertNode('rosales');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('c');
  for (const id of ['demo-circuit-01', 'demo-school-01-01', 'demo-table-01-01-01']) {
    await children.getByRole('button', { name: `Explorar ${fixture.nodes[id].label}`, exact: true }).click();
    await assertNode(id);
    await expect(page.getByLabel('Agrupación', { exact: true })).toHaveValue('c');
    await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope', 'rosales');
    await expect(page.locator('#child-geographies [data-node-id]')).toHaveCount(0);
    await assertExact(id, '2025');
    await toggleExact(false);
  }
  await expect(page.getByText('Sin ubicación territorial propia', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Elección', { exact: true }).selectOption('2023');
  await assertNode('demo-table-01-01-01', '2023');
  await page.getByRole('navigation', { name: 'Recorrido territorial' }).getByRole('button', { name: 'Ir a Argentina', exact: true }).click();
  await assertNode('argentina', '2023');
  await expect(page.getByLabel('Agrupación', { exact: true })).toHaveValue('c');
  await page.getByLabel('Elección', { exact: true }).selectOption('2025');
  await page.getByLabel('Agrupación', { exact: true }).selectOption('all');
  await assertNode('argentina');
  checks.push('keyboard-reference-to-deep-list-drilldown-to-mesa-and-breadcrumb-return');
  await page.getByLabel('Categoría', { exact: true }).selectOption('concejales');
  await selectAnchor('rosales', '2025', 'concejales');
  await assertNode('rosales', '2025', 'concejales');
  await assertExact('rosales', '2025', 'concejales');
  await toggleExact(false);
  await children.getByRole('button', { name: `Explorar ${fixture.nodes['demo-circuit-01'].label}`, exact: true }).click();
  await assertNode('demo-circuit-01', '2025', 'concejales');
  await assertExact('demo-circuit-01', '2025', 'concejales');
  await page.getByLabel('Territorio', { exact: true }).selectOption('argentina');
  await assertNode('argentina', '2025', 'concejales');
  await expect(page.locator('#child-geographies [data-winner]')).toHaveCount(0);
  await page.getByLabel('Categoría', { exact: true }).selectOption('national-deputies');
  await assertNode('argentina');
  checks.push('category-preserved-with-authored-council-demo-and-unavailable-other-territories');
  await page.getByRole('button', { name: 'Ver evidencia', exact: true }).click();
  const evidence = page.getByRole('dialog', { name: 'Evidencia del prototipo' });
  await expect(evidence).toContainText('fictici');
  await expect(evidence).toContainText('CNE');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ver evidencia', exact: true })).toBeFocused();
  checks.push('evidence-source-reference-and-fictional-result-boundaries');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Navegación principal' })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const scope of ['argentina', 'buenos-aires', 'rosales']) {
      await selectAnchor(scope);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile overflow/${width}/${scope}`).toBe(true);
      await assertAxe(`mobile/${width}/${scope}`);
    }
    await selectAnchor('argentina');
    await capture(`mobile-${width}.png`);
    checks.push(`mobile-${width}-navigation-three-scopes-no-overflow-axe`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
  expect(await page.evaluate(() => document.getAnimations().filter(a => ['running', 'pending'].includes(a.playState)).length)).toBe(0);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  checks.push('reduced-motion-no-runtime-errors-offline-only');
  await page.setViewportSize({ width: 1600, height: 1040 });
  await capture('desktop.png');
  const report = { status: 'PASS', checks, testUrl: url, method: 'local Chromium, emulated mobile; fictional results/deep hierarchy; reference geography only; no production checks' };
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', completedChecks: checks, message: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
