import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fixture = JSON.parse(await readFile(root + '../territorial-exploration-prototype/assets/demo-results.json'));
const policy = JSON.parse(await readFile(root + 'assets/evidence-policy.json'));
const immutable = JSON.parse(await readFile(root + 'checks/immutable-inputs.json'));
const fmt = number => new Intl.NumberFormat('es-AR').format(number);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1424, height: 1120 } });
const page = await context.newPage();
const checks = [], errors = [], external = [];
function observe(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('request', request => {
    if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url());
  });
}
observe(page);
async function check(name, action) { await action(); checks.push(name); console.log('PASS: ' + name); }
async function select(id, value, target = page) { await target.locator('#' + id).selectOption(value); }
async function state(value, target = page) {
  await expect(target.locator('#evidence-status')).toHaveAttribute('data-state', value);
}
async function masked(target = page) {
  for (const id of ['coverage-ratio', 'coverage-percent', 'positive-votes'])
    assert.doesNotMatch(await target.locator('#' + id).innerText(), /\d/, id + ' must clear numbers');
  await expect(target.locator('#territory-body tr[data-node]')).toHaveCount(0);
  await expect(target.locator('#territory-map [data-availability]')).toHaveCount(0);
}
async function inspect(id) {
  await page.locator('#territory-body tr[data-node="' + id + '"]')
    .getByRole('button', { name: 'Inspeccionar ' + fixture.nodes[id].label, exact: true }).click();
  await expect(page.locator('#territory-map')).toHaveAttribute('data-scope', id);
}
async function sample(id, year = '2025', category = 'concejales') {
  const record = fixture.results[year][category][id];
  await state(record.status);
  await expect(page.locator('#coverage-ratio')).toHaveText(record.coverage.reported + '/' + record.coverage.total);
  if (record.votes === null) assert.doesNotMatch(await page.locator('#positive-votes').innerText(), /\d/);
  else await expect(page.locator('#positive-votes')).toHaveText(fmt(Object.values(record.votes).reduce((a,b) => a+b,0)));
  const unit = policy.demonstration.coverageUnits[id];
  if (unit && record.coverage.total > 0) {
    await expect(page.locator('#coverage-unit')).toHaveText(unit.label);
    const shown = Number((await page.locator('#coverage-percent').innerText()).replace('%','').replace(',','.'));
    assert.ok(Math.abs(shown - record.coverage.reported / record.coverage.total * 100) <= 0.051);
  } else {
    assert.doesNotMatch(await page.locator('#coverage-percent').innerText(), /\d/);
    await expect(page.locator('#coverage-reason')).toContainText('no se calcula un porcentaje');
  }
}
async function axe(target) {
  const result = await new AxeBuilder({ page: target }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(result.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({
    id:v.id, targets:v.nodes.map(n => n.target),
  })), []);
}
let failure;
try {
  await check('E1 actual entry, typed demo coverage and separate geographic quality', async () => {
    const response = await page.goto(url);
    assert.equal(response.status(),200,'The real isolated Evidence entry must exist');
    await expect(page.getByRole('heading',{name:'Evidencia y calidad de datos',exact:true})).toBeVisible();
    await sample('rosales');
    await expect(page.locator('#coverage-percent')).toHaveText('100%');
    await expect(page.locator('#geometry-status')).toBeVisible();
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(2);
    await expect(page.locator('#boundary-facts')).toContainText('denominador');
    await expect(page.locator('#boundary-facts')).toContainText('lectura');
    assert.match(await page.locator('main').innerText(),/fictici/);
    await select('base-year','2023'); await sample('rosales','2023'); await select('base-year','2025');
  });
  await check('E2 circuit/establishment/mesa entry navigation, neutral ancestor and keyboard focus', async () => {
    for (const id of ['demo-circuit-01','demo-school-01-01','demo-table-01-01-01']) {
      await inspect(id); await sample(id);
      await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope','rosales');
      await expect(page.locator('#territory-map [data-availability]')).toHaveCount(0);
      await expect(page.locator('#selected-heading')).toBeFocused();
    }
    await select('territory','rosales');
    await expect(page.locator('#territory-map')).toHaveAttribute('data-scope','rosales');
    await page.locator('#territory-body tr[data-node="demo-circuit-01"] button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#selected-heading')).toBeFocused();
  });
  await check('E2 all24 provinces: missing, zero, tied and untyped partial remain distinct', async () => {
    await select('category','national-deputies'); await select('territory','argentina');
    await sample('argentina','2025','national-deputies');
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(24);
    await expect(page.locator('#territory-map [data-availability]')).toHaveCount(17);
    assert.match(await page.locator('main').innerText(),/no.*suma/i);
    for (const id of ['province-catamarca','province-chaco','province-chubut','province-ciudad-autonoma-de-buenos-aires']) {
      await inspect(id); await sample(id,'2025','national-deputies');
      if (id.endsWith('buenos-aires')) await expect(page.locator('#positive-votes')).toHaveText('0');
      await select('territory','argentina');
    }
    for (const id of ['buenos-aires','province-cordoba','province-corrientes','province-entre-rios',
      'province-misiones','province-san-juan','province-tucuman']) {
      await expect(page.locator('#territory-body tr[data-node="' + id + '"]')).toHaveCount(1);
      await expect(page.locator('#territory-map [data-node="' + id + '"][data-availability]')).toHaveCount(0);
    }
  });
  await check('E2 PBA135 records vs133 valid/2 observed geometries; filters do not alter aggregate', async () => {
    await select('territory','buenos-aires'); await sample('buenos-aires','2025','national-deputies');
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(135);
    await expect(page.locator('#territory-map [data-availability]')).toHaveCount(133);
    for (const id of ['section-gid-30530','section-gid-30533']) {
      await expect(page.locator('#territory-body tr[data-node="' + id + '"] [data-field="status"]')).toContainText(/complet/i);
      await expect(page.locator('#territory-map [data-node="' + id + '"][data-availability]')).toHaveCount(0);
    }
    await select('territory','argentina'); await select('availability-filter','partial');
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(1);
    await expect(page.locator('#coverage-ratio')).toHaveText('23/24');
    await expect(page.locator('#shown-count')).toContainText('1');
    await select('availability-filter','all'); await page.locator('#territory-search').fill('zzzz-no-unidad');
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(0);
    await state('partial'); await expect(page.locator('#coverage-ratio')).toHaveText('23/24');
    await page.locator('#territory-search').fill('');
    await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(24);
  });
  await check('E1 typed denominator applies to a selected record, not a node ID alone', async () => {
    await select('category','concejales');
    for (const id of ['argentina','buenos-aires']) {
      await select('territory',id); await state('missing');
      await expect(page.locator('#coverage-ratio')).toHaveText('0/1');
      assert.doesNotMatch(await page.locator('#coverage-percent').innerText(),/\d/,
        'Generic missing0/1 cannot inherit province/partido units from a national-deputies record');
      await expect(page.locator('#coverage-reason')).toContainText('no se calcula un porcentaje');
    }
    await select('territory','rosales');
  });
  await check('E3 safe demo provenance, native dialog Escape/focus and trapped Tab', async () => {
    await select('territory','rosales'); await select('category','concejales');
    const opener = page.getByRole('button',{name:'Ver trazabilidad',exact:true});
    await opener.click();
    const dialog = page.getByRole('dialog',{name:'Trazabilidad de la evidencia',exact:true});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#design-fingerprint')).toContainText(policy.demonstration.fingerprint);
    assert.match(await dialog.innerText(),/muestra de diseño/i);
    assert.doesNotMatch(await dialog.innerText(),/source_url|archived_path|https?:|\/Users\//);
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
    const method = page.getByRole('button',{name:'Cómo interpretar la evidencia',exact:true});
    await method.click();
    const md = page.getByRole('dialog',{name:'Método y estados',exact:true});
    await expect(md).toBeVisible(); await page.keyboard.press('Tab');
    for (let step=0;step<4;step++) {
      assert.equal(await md.evaluate(d => d.contains(document.activeElement) || document.activeElement === document.body),true,
        'Native modal may traverse browser chrome but must not focus an inert background control');
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Escape'); await expect(method).toBeFocused();
  });
  await check('E3 unknown hosted coverage and opt-in internal clear official numbers/provenance', async () => {
    await select('evidence-mode','verified'); await state('unknown'); await masked();
    const main = await page.locator('main').innerText();
    assert.match(main,/no.*consultad|sin.*consult/i); assert.match(main,/desconocid|no verificada/i);
    assert.doesNotMatch(main,/49[.,]300|100%/);
    await select('source-kind','internal'); await state('unavailable'); await masked();
    assert.match(await page.locator('main').innerText(),/no.*aleatori/i);
    await select('evidence-mode','demonstration'); await state('unavailable'); await masked();
    await select('source-kind','official'); await sample('rosales');
  });
  await check('E3 five labelled consultation cases clear numbers, rows and provenance', async () => {
    await page.getByText('Casos de consulta',{exact:true}).click();
    for (const [value,expected] of [['empty','empty'],['denied','denied'],['unavailable','unavailable'],
      ['truncated','truncated'],['malformed','error']]) {
      await select('consultation-case',value); await state(expected); await masked();
      assert.match(await page.locator('main').innerText(),/caso de diseño/i);
      if (await page.locator('#provenance-open').isEnabled()) {
        await page.locator('#provenance-open').click();
        assert.doesNotMatch(await page.locator('#provenance-dialog').innerText(),new RegExp(policy.demonstration.fingerprint));
        await page.keyboard.press('Escape');
      }
    }
    await select('consultation-case','normal'); await sample('rosales');
  });
  await check('E4 actual-entry HTTP/malformed/unsafe/unknown-party failures and reload retry', async () => {
    const cases = [
      ['503 fixture','/assets/demo-results.json',null,503],
      ['malformed JSON','/assets/demo-results.json','{invalid',200],
      ['unsafe vote','/assets/demo-results.json',f => {f.results['2025'].concejales.rosales.votes.a=Number.MAX_SAFE_INTEGER+1;}],
      ['unknown party','/assets/demo-results.json',f => {f.results['2025'].concejales.rosales.votes.e=100;}],
      ['missing party','/assets/demo-results.json',f => {delete f.results['2025'].concejales.rosales.votes.d;}],
      ['invalid coverage','/assets/demo-results.json',f => {f.results['2025'].concejales.rosales.coverage.reported=3;}],
      ['missing record','/assets/demo-results.json',f => {delete f.results['2023']['national-deputies']['province-chaco'];}],
      ['missing policy','/assets/evidence-policy.json',null,503],
      ['missing reference','/assets/winner-reference-paths.json',null,503],
    ];
    for (const [name,path,mutation,status=200] of cases) {
      const c=await browser.newContext({viewport:{width:1280,height:900}}), p=await c.newPage(); observe(p);
      await p.route('**'+path,route => {
        const changed=typeof mutation==='function'?structuredClone(fixture):null;
        if(changed)mutation(changed);
        return route.fulfill({status,contentType:'application/json',body:changed?JSON.stringify(changed):mutation??'{}'});
      });
      try {
        await p.goto(url); await expect(p.locator('#evidence-status')).toHaveAttribute('data-state',/error|unavailable/);
        await masked(p); await p.unroute('**'+path);
        await p.getByRole('button',{name:'Reintentar carga',exact:true}).click();
        await expect(p.locator('#positive-votes')).toHaveText('49.300');
        await expect(p.locator('#selected-heading')).toBeFocused();
      } catch(error) {throw new Error(name+': '+error.message);}
      finally {await c.close();}
    }
  });
  await check('E4 desktop/320/390 accessibility and dialog geometry', async () => {
    await page.getByText('Casos de consulta',{exact:true}).click(); await axe(page);
    await page.screenshot({path:root+'checks/delivery-workbench.png',fullPage:true});
    for(const width of [320,390]) {
      const c=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}), p=await c.newPage(); observe(p);
      try {
        await p.goto(url); await expect(p.locator('#positive-votes')).toHaveText('49.300');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,'No page-level overflow');
        await axe(p); await p.locator('#method-open').click(); await expect(p.locator('#method-dialog')).toBeVisible();
        assert.equal(await p.locator('#method-dialog').evaluate(d => d.getBoundingClientRect().width<=innerWidth),true);
        await p.keyboard.press('Escape'); await expect(p.locator('#method-open')).toBeFocused();
        await p.screenshot({path:root+'checks/mobile-'+width+'.png',fullPage:true});
      } finally {await c.close();}
    }
  });
  await check('E4 no browser errors/external traffic/storage;139 immutable inputs unchanged', async () => {
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    assert.deepEqual(await page.evaluate(() => ({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
    assert.equal(Object.keys(immutable).length,139);
    for(const [path,expected] of Object.entries(immutable))assert.equal(sha(await readFile(path)),expected,path);
  });
} catch(error) {
  failure=error; console.log('FAIL: '+error.stack);
  await page.screenshot({path:root+'checks/parent-failure.png',fullPage:true}).catch(() => {});
} finally {
  await writeFile(root+'checks/report.json',JSON.stringify({
    status:failure?'FAIL':'PASS',checks,error:failure?.stack,errors,external,time:new Date().toISOString(),
    limits:['No physical devices/native select popup certification','No screen-reader/full WCAG audit',
      'No hosted coverage/permissions/official archive bytes queried','Fictional numerical coverage; dated code snapshot'],
  },null,2));
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}
if(failure)process.exitCode=1;
