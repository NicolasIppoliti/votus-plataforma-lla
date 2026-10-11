import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';
import { allocateSeats } from './kernel.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/';
const require = createRequire(repo + 'apps/web/package.json');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fixture = JSON.parse(await readFile(root + 'assets/scenario-contexts.json'));
const policy = JSON.parse(await readFile(root + 'assets/capability-policy.json'));
const ids = ['a', 'b', 'c', 'd'];
const fmt = n => new Intl.NumberFormat('es-AR').format(n);
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1424, height: 1120 } });
const page = await context.newPage();
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url());
});
function allocation(record, level, votes = record.votes) {
  const total = Object.values(votes).reduce((sum, n) => sum + n, 0);
  const input = {
    level, isProjection: true, seatsToFill: record.seatsToFill,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    lists: ids.map(id => ({ listId: id, listName: id, votes: votes[id] })),
    ...(level === 'national'
      ? { totalVotes: total, padron: record.padron, threshold: { value: record.thresholdPercent, basis: 'padron' } }
      : { voteTotals: { kind: 'valid_votes_only', validVotes: total } }),
  };
  const output = allocateSeats(input);
  return { total, output, seats: Object.fromEntries(output.results.map(result => [
    result.listId, level === 'national' ? result.seats : result.totalSeats,
  ])) };
}
async function select(scope, unitId, category, year = '2025') {
  await page.getByLabel('Territorio', { exact: true }).selectOption(scope);
  await page.getByLabel('Muestra base', { exact: true }).selectOption(year);
  if (scope === 'buenos-aires') await page.getByLabel('Categoría del escenario', { exact: true }).selectOption(category);
  await page.getByLabel('Unidad de reparto', { exact: true }).selectOption(unitId);
}
async function figures(record, level, votes = record.votes) {
  const base = allocation(record, level);
  const scenario = allocation(record, level, votes);
  await expect(page.locator('#allocation-status')).toHaveAttribute('data-status', 'ready');
  for (const id of ids) {
    const row = page.locator(`#comparison-body [data-party="${id}"]`);
    await expect(row.locator('[data-field="base-votes"]')).toHaveText(fmt(record.votes[id]));
    await expect(row.locator('[data-field="scenario-votes"]')).toHaveText(fmt(votes[id]));
    await expect(row.locator('[data-field="base-seats"]')).toHaveText(String(base.seats[id]));
    await expect(row.locator('[data-field="scenario-seats"]')).toHaveText(String(scenario.seats[id]));
  }
  await expect(page.locator('#base-total')).toHaveText(fmt(base.total));
  await expect(page.locator('#scenario-total')).toHaveText(fmt(scenario.total));
  await expect(page.locator('#renewal-count')).toHaveText(String(record.seatsToFill));
}
async function transfer(amount, donor = 'b', target = 'a') {
  await page.getByLabel('Agrupación de origen', { exact: true }).selectOption(donor);
  await page.getByLabel('Agrupación de destino', { exact: true }).selectOption(target);
  await page.getByLabel('Votos a transferir', { exact: true }).fill(String(amount));
  await page.getByRole('button', { name: 'Aplicar transferencia', exact: true }).click();
}
async function axe() {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id), []);
}
async function screenshot(name) {
  await page.screenshot({ path: root + 'checks/' + name, fullPage: true });
}
let failure;
try {
  const response = await page.goto(url);
  assert.equal(response.status(), 200, 'The real existing prototype entry must load');
  await page.getByLabel('Territorio', { exact: true }).selectOption('argentina');
  await expect(page.getByLabel('Unidad de reparto', { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('heading', { name: 'Qué está disponible en Votus', exact: true })).toBeVisible();
  await expect(page.locator('#capability-panel')).toContainText('Integración pendiente');
  await expect(page.locator('#capability-panel')).toContainText('2 partidos');
  await expect(page.locator('#capability-panel')).toContainText('desconocida');
  await expect(page.locator('#capability-panel')).toContainText('ya permite');
  assert.equal(policy.liveDatabaseCoverage, 'unknown');
  assert.equal(policy.officialScenarioVerified, false);
  checks.push('S5 visible verified capability/pending integration/limited registration/unknown hosted coverage');
  // Every authored unit/category/year is reached through real native controls.
  let observed = 0;
  for (const [scope, context] of Object.entries(fixture.contexts)) {
    for (const year of ['2025', '2023']) {
      for (const category of context.categories) {
        for (const unit of context.units) {
          const record = unit.samples[year][category.id];
          await select(scope, unit.id, category.id, year);
          await figures(record, context.level);
          await expect(page.getByLabel('Votos a transferir', { exact: true })).toHaveValue('0');
          await expect(page.locator('#scenario-assumptions')).toContainText('fictici');
          if (scope === 'buenos-aires') {
            await expect(page.locator('#territory-map [data-winner]')).toHaveCount(0);
            await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope', 'buenos-aires');
          }
          observed++;
        }
      }
    }
  }
  assert.equal(observed, 80);
  checks.push('S6/S7 all80 fictional district/section/chamber/year inputs reached; exact kernel seats and neutral PBA reference');
  const national = fixture.contexts.argentina;
  const first = national.units[0], record = first.samples['2025']['diputados-nacionales'];
  await select('argentina', first.id, 'diputados-nacionales');
  await expect(page.locator('#unit-overview-body [data-unit]')).toHaveCount(24);
  const nationalSeatSum = national.units.reduce((sum, unit) => sum + unit.samples['2025']['diputados-nacionales'].seatsToFill, 0);
  await expect(page.locator('#overview-base-total')).toHaveText(fmt(nationalSeatSum));
  await expect(page.locator('#overview-scenario-total')).toHaveText(fmt(nationalSeatSum));
  await expect(page.locator('#allocation-evidence')).toContainText('D’Hondt');
  await expect(page.locator('#allocation-evidence')).toContainText(fmt(record.padron));
  await expect(page.locator('#allocation-evidence')).toContainText('3');
  await transfer(2500);
  const moved = { ...record.votes, a: record.votes.a + 2500, b: record.votes.b - 2500 };
  await figures(record, 'national', moved);
  for (const unit of national.units) {
    const row = page.locator(`#unit-overview-body [data-unit="${unit.id}"]`);
    const seats = unit.samples['2025']['diputados-nacionales'].seatsToFill;
    await expect(row.locator('[data-field="base-seats"]')).toHaveText(String(seats));
    await expect(row.locator('[data-field="scenario-seats"]')).toHaveText(String(seats));
  }
  await expect(page.locator('#overview-scenario-total')).toHaveText(fmt(nationalSeatSum));
  for (const id of ids) {
    let baseSeats = 0, scenarioSeats = 0;
    for (const unit of national.units) {
      const unitRecord = unit.samples['2025']['diputados-nacionales'];
      baseSeats += allocation(unitRecord, 'national').seats[id];
      scenarioSeats += allocation(unitRecord, 'national', unit.id === first.id ? moved : unitRecord.votes).seats[id];
    }
    const aggregate = page.locator(`#overview-party-totals [data-party="${id}"]`);
    await expect(aggregate.locator('[data-field="base-seats"]')).toHaveText(String(baseSeats));
    await expect(aggregate.locator('[data-field="scenario-seats"]')).toHaveText(String(scenarioSeats));
  }
  await screenshot('scales-national.png');
  await page.getByRole('button', { name: 'Restablecer base', exact: true }).click();
  await figures(record, 'national');
  for (const invalid of ['-1', '1.5', '9007199254740992', String(record.votes.b + 1)]) {
    await transfer(invalid);
    await expect(page.locator('#allocation-status')).toHaveAttribute('data-status', 'invalid');
    await expect(page.locator('#comparison-body [data-field="scenario-seats"]')).toHaveCount(0);
    await expect(page.locator('#scenario-total')).toBeEmpty();
  }
  await page.getByRole('button', { name: 'Restablecer base', exact: true }).click();
  await transfer(2500);
  await page.getByLabel('Unidad de reparto', { exact: true }).selectOption(national.units[1].id);
  await figures(national.units[1].samples['2025']['diputados-nacionales'], 'national');
  await expect(page.getByLabel('Votos a transferir', { exact: true })).toHaveValue('0');
  checks.push('S6 district-only transfer,24 independently summed allocations, D’Hondt/padrón evidence, invalid/reset/unit-change');
  const provincial = fixture.contexts['buenos-aires'];
  const pbaUnit = provincial.units[5];
  await select('buenos-aires', pbaUnit.id, 'diputados-provinciales');
  const pbaRecord = pbaUnit.samples['2025']['diputados-provinciales'];
  await transfer(2500);
  await figures(pbaRecord, 'pba_provincial', { ...pbaRecord.votes, a: pbaRecord.votes.a + 2500, b: pbaRecord.votes.b - 2500 });
  await expect(page.locator('#unit-overview-body [data-unit]')).toHaveCount(8);
  await expect(page.locator('#scenario-assumptions')).toContainText('22');
  await expect(page.locator('#territory-map [data-winner]')).toHaveCount(0);
  await screenshot('scales-provincial.png');
  await page.getByLabel('Categoría del escenario', { exact: true }).selectOption('senadores-provinciales');
  await figures(pbaUnit.samples['2025']['senadores-provinciales'], 'pba_provincial');
  await expect(page.getByLabel('Votos a transferir', { exact: true })).toHaveValue('0');
  await page.getByLabel('Muestra base', { exact: true }).selectOption('2023');
  await figures(pbaUnit.samples['2023']['senadores-provinciales'], 'pba_provincial');
  checks.push('S7 sixth-section reference22partidos, independent chamber contexts, category/year reset, no section polygons');
  // Dynamic workload:21*7*4=588 allowed;14*11*4=616 rejected before sampling.
  await select('argentina', national.units[1].id, 'diputados-nacionales');
  await page.getByText('Sensibilidad de la transferencia', { exact: true }).click();
  await page.getByLabel('Transferencia máxima', { exact: true }).fill('2000');
  await page.getByLabel('Paso de muestreo', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Explorar sensibilidad', exact: true }).click();
  await expect(page.locator('#sweep-body tr')).toHaveCount(21);
  await expect(page.locator('#sweep-note')).toContainText('588');
  await page.getByLabel('Unidad de reparto', { exact: true }).selectOption(national.units[2].id);
  await expect(page.locator('#sweep-body tr')).toHaveCount(0);
  // This unit's B has only1241 votes: choose A to exercise workload, not overdraw.
  await page.getByLabel('Agrupación de origen', { exact: true }).selectOption('a');
  await page.getByLabel('Agrupación de destino', { exact: true }).selectOption('b');
  await page.getByLabel('Transferencia máxima', { exact: true }).fill('1300');
  await page.getByLabel('Paso de muestreo', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Explorar sensibilidad', exact: true }).click();
  await expect(page.locator('#sweep-status')).toHaveAttribute('data-status', 'blocked');
  await expect(page.locator('#sweep-status')).toContainText('616');
  await expect(page.locator('#sweep-body tr')).toHaveCount(0);
  checks.push('S6 shared bounded sensitivity dynamically uses7/11seats, resets and refuses616work');
  // Real-entry corrupt source parameters must be visible, never silently filled.
  const corrupt = structuredClone(fixture);
  delete corrupt.contexts.argentina.units[0].samples['2025']['diputados-nacionales'].padron;
  await page.route('**/assets/scenario-contexts.json', route => route.fulfill({ json: corrupt }));
  await page.reload();
  await select('argentina', first.id, 'diputados-nacionales');
  await expect(page.locator('#allocation-status')).toHaveAttribute('data-status', 'blocked');
  await expect(page.locator('#comparison-body [data-field="scenario-seats"]')).toHaveCount(0);
  await expect(page.locator('#scenario-total')).toBeEmpty();
  const blockedRow = page.locator(`#unit-overview-body [data-unit="${first.id}"]`);
  await expect(blockedRow).toContainText('padrón');
  await expect(blockedRow.locator('[data-field="scenario-seats"]')).toHaveText('—');
  await page.unroute('**/assets/scenario-contexts.json');
  for (const asset of ['scenario-contexts.json', 'capability-policy.json']) {
    await page.route('**/assets/' + asset, route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.reload();
    await expect(page.locator('#allocation-status')).toHaveAttribute('data-status', 'unavailable');
    await expect(page.locator('#scenario-total')).toBeEmpty();
    await expect(page.locator('#comparison-body [data-field="scenario-seats"]')).toHaveCount(0);
    await page.unroute('**/assets/' + asset);
  }
  await page.reload();
  await select('argentina', national.units[5].id, 'diputados-nacionales');
  checks.push('S8 actual missing-padrón blocked unit retained with dash/reason; both newasset503 fail closed');
  await axe();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No mobile viewport overflow');
    await axe();
    await screenshot('scales-mobile-' + width + '.png');
  }
  await page.setViewportSize({ width: 1424, height: 1120 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await axe();
  const immutable = JSON.parse(await readFile(root + 'checks/frozen-inputs.json'));
  for (const [path, hash] of Object.entries(immutable)) {
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, 'Original frozen source/input: ' + path);
  }
  for (const [path, hash] of Object.entries(policy.sourceHashes)) {
    assert.equal(createHash('sha256').update(await readFile(repo + path)).digest('hex'), hash, 'Fresh capability snapshot unchanged: ' + path);
  }
  const authored = JSON.parse(await readFile(root + 'checks/scales-authored-inputs.json'));
  for (const [path, hash] of Object.entries(authored)) {
    assert.equal(createHash('sha256').update(await readFile(root + path)).digest('hex'), hash, 'Authored extension input unchanged: ' + path);
  }
  const kernel = JSON.parse(await readFile(root + 'checks/kernel-build.json'));
  assert.equal(createHash('sha256').update(await readFile(root + 'kernel.js')).digest('hex'), kernel.outputHash);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  checks.push('S8 axe serious/critical390320desktop/reduced-motion; no errors/externalrequests;118frozen and12snapshot hashes/kernel identity');
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
} catch (error) {
  failure = error;
  console.log(JSON.stringify({ status: 'FAIL', checks, error: error.stack }, null, 2));
} finally {
  await writeFile(root + 'checks/scales-report.json', JSON.stringify({
    status: failure ? 'FAIL' : 'PASS', time: new Date().toISOString(), checks,
    error: failure?.stack, errors, external,
  }, null, 2));
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (failure) process.exitCode = 1;
