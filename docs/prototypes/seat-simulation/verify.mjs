import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from './serve.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const {chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const server=createPreviewServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1424,height:1120}});
const page=await ctx.newPage(); const checks=[],errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});
const fmt=n=>new Intl.NumberFormat('es-AR').format(n);
const ids=['a','b','c','d'];
const original={a:21482,b:18736,c:6924,d:2158};
const initialSeats={a:4,b:4,c:1,d:0}, movedSeats={a:5,b:3,c:1,d:0};
async function allocations(votes,seats){
 await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','ready');
 for(const id of ids){
  const row=page.locator(`#comparison-body [data-party="${id}"]`);
  await expect(row.locator('[data-field="base-votes"]')).toHaveText(fmt(original[id]));
  await expect(row.locator('[data-field="scenario-votes"]')).toHaveText(fmt(votes[id]));
  await expect(row.locator('[data-field="base-seats"]')).toHaveText(String(initialSeats[id]));
  await expect(row.locator('[data-field="scenario-seats"]')).toHaveText(String(seats[id]));
 }
 await expect(page.locator('#scenario-total')).toHaveText('49.300');
 await expect(page.locator('#base-total')).toHaveText('49.300');
 await expect(page.locator('#renewal-count')).toHaveText('9');
 await expect(page.locator('#retained-note')).toContainText('Sin composición');
}
async function transfer(value,donor='b',target='a'){
 await page.getByLabel('Agrupación de origen',{exact:true}).selectOption(donor);
 await page.getByLabel('Agrupación de destino',{exact:true}).selectOption(target);
 await page.getByLabel('Votos a transferir',{exact:true}).fill(String(value));
 await page.getByRole('button',{name:'Aplicar transferencia',exact:true}).click();
}
async function screenshot(name){await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.screenshot({path:root+'checks/'+name,fullPage:true});}
async function axe(){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);}
let failure;
try {
 await mkdir(root+'checks',{recursive:true});
 const response=await page.goto(url);
 assert.equal(response.status(),200,'Actual isolated Simulation entry must exist before implementation can pass');
 await expect(page.getByRole('heading',{name:'Simulación de escenarios',exact:true})).toBeVisible();
 await expect(page.getByText('Datos de demostración',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Territorio',{exact:true})).toHaveValue('rosales');
 await expect(page.getByLabel('Muestra base',{exact:true})).toHaveValue('2025');
 const f=await page.request.get(url+'assets/demo-results.json');
 assert.equal(createHash('sha256').update(await f.body()).digest('hex'),'cf2c1db19469ddf04a12e3ab7cd2eaec954c0290421ada254b8f81eace84040f');
 await allocations(original,initialSeats);
 await expect(page.locator('#territory-map')).toHaveAttribute('data-scope','rosales');
 await expect(page.locator('#scope-note')).toContainText('partido');
 await axe();checks.push('S1 real entry, exact fictional baseline, 9 renewal/unknown retained, map and scope');
 if(process.argv.includes('s1')){await screenshot('baseline.png');}else{
 await transfer(2500);
 await allocations({a:23982,b:16236,c:6924,d:2158},movedSeats);
 await expect(page.locator('#transfer-note')).toContainText('2.500');
 await expect(page.locator('#allocation-evidence')).toContainText('5.477');
 await expect(page.locator('#territory-map [data-winner]')).toHaveAttribute('data-winner','a');
 await screenshot('scenario.png');
 await transfer(0);await allocations(original,initialSeats);
 for(const invalid of ['-1','1.5','18737','9007199254740992','']){
  await transfer(invalid);await expect(page.locator('#transfer-error')).not.toBeEmpty();
  await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','invalid');
  await expect(page.locator('#comparison-body [data-field="scenario-seats"]')).toHaveCount(0);
  await expect(page.locator('#scenario-total')).toBeEmpty();
 }
 await transfer(1,'a','a');await expect(page.locator('#transfer-error')).not.toBeEmpty();
 await page.getByRole('button',{name:'Restablecer base',exact:true}).click();
 await allocations(original,initialSeats);
 await transfer(2500);
 await page.getByLabel('Muestra base',{exact:true}).selectOption('2023');
 await expect(page.getByLabel('Votos a transferir',{exact:true})).toHaveValue('0');
 await expect(page.locator('#scenario-total')).toHaveText('48.800');
 await page.getByLabel('Muestra base',{exact:true}).selectOption('2025');await allocations(original,initialSeats);
 checks.push('S2 real transfer conservation, exact demo seats, zero/reset, invalid inputs clear outputs, base change reset');
 await page.getByText('Sensibilidad de la transferencia',{exact:true}).click();
 await page.getByLabel('Transferencia máxima',{exact:true}).fill('2500');
 await page.getByLabel('Paso de muestreo',{exact:true}).fill('800');
 await page.getByRole('button',{name:'Explorar sensibilidad',exact:true}).click();
 await expect(page.locator('#sweep-status')).toHaveAttribute('data-status','ready');
 await expect(page.locator('#sweep-body tr')).toHaveCount(5);
 assert.deepEqual(await page.locator('#sweep-body [data-field="amount"]').allTextContents(),['0','800','1.600','2.400','2.500']);
 await expect(page.locator('#sweep-note')).toContainText('180');
 await expect(page.locator('#sweep-note')).toContainText('No');
 await page.getByLabel('Transferencia máxima',{exact:true}).fill('2000');
 await page.getByLabel('Paso de muestreo',{exact:true}).fill('100');
 await page.getByRole('button',{name:'Explorar sensibilidad',exact:true}).click();
 await expect(page.locator('#sweep-status')).toHaveAttribute('data-status','blocked');
 await expect(page.locator('#sweep-body tr')).toHaveCount(0);
 await expect(page.locator('#sweep-status')).toContainText('600');
 await page.getByLabel('Transferencia máxima',{exact:true}).fill('2500');
 await page.getByLabel('Paso de muestreo',{exact:true}).fill('800');
 await page.getByRole('button',{name:'Explorar sensibilidad',exact:true}).click();
 await transfer(100);await expect(page.locator('#sweep-body tr')).toHaveCount(0);
 await page.getByLabel('Agrupación de origen',{exact:true}).selectOption('b');
 await page.getByLabel('Agrupación de destino',{exact:true}).selectOption('c');
 await page.getByLabel('Transferencia máxima',{exact:true}).fill('11812');
 await page.getByLabel('Paso de muestreo',{exact:true}).fill('5906');
 await page.getByRole('button',{name:'Explorar sensibilidad',exact:true}).click();
 await expect(page.locator('#sweep-body tr')).toHaveCount(3);
 await expect(page.locator('#sweep-status')).toContainText('2 válidas y 1 bloqueadas');
 const rejected=page.locator('#sweep-body tr').nth(1);
 await expect(rejected).toContainText('empate');
 assert.deepEqual((await rejected.locator('td').allTextContents()).slice(1,5),['—','—','—','—']);
 await page.getByRole('button',{name:'Restablecer base',exact:true}).click();
 await allocations(original,initialSeats);
 checks.push('S3 real sensitivity exact endpoints/short interval, 600 guard, stale clearing and retained mixed-validity rejection');
 for(const scope of ['argentina','buenos-aires']){
  await page.getByLabel('Territorio',{exact:true}).selectOption(scope);
  await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','context-only');
  await expect(page.getByRole('button',{name:'Aplicar transferencia',exact:true})).toBeDisabled();
  await expect(page.locator('#comparison-body [data-party]')).toHaveCount(0);
  await expect(page.locator('#scenario-total')).toBeEmpty();
  await expect(page.locator('#territory-map')).toHaveAttribute('data-scope',scope);
  await expect(page.locator('#territory-map [data-winner]')).toHaveCount(0);
  await expect(page.locator('#scope-note')).toContainText(scope==='argentina'?'provincia':'sección electoral');
 }
 await page.getByLabel('Territorio',{exact:true}).selectOption('rosales');
 const fixture=await f.json();
 let current='rosales';
 for(let depth=0;depth<3;depth++){
  current=fixture.nodes[current].childIds[0];
  await page.getByRole('button',{name:'Inspeccionar '+fixture.nodes[current].label,exact:true}).click();
  await expect(page.locator('#inspection-heading')).toHaveText(fixture.nodes[current].label);
  await expect(page.locator('#inspection-note')).toContainText('No');
  await expect(page.locator('#territory-map [data-winner]')).toHaveCount(0);
  await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope','rosales');
  await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','inspection-only');
  await expect(page.locator('#comparison-body [data-party]')).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Volver al escenario de Rosales',exact:true}).click();await allocations(original,initialSeats);
 checks.push('S1 national/provincial pools blocked and three deep inspection levels keep ancestor neutral');
 await page.getByRole('button',{name:'Ver método y límites',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Método y límites del escenario',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Método y límites del escenario',exact:true})).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Ver método y límites',exact:true})).toBeFocused();
 await page.keyboard.press('Tab'); assert.ok(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'));
 await axe();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No viewport horizontal overflow');
  await page.getByRole('button',{name:'Abrir navegación',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Navegación principal',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await axe();await screenshot(`mobile-${width}.png`);
 }
 await page.setViewportSize({width:1424,height:1120});
 await page.emulateMedia({reducedMotion:'reduce'});await axe();
 checks.push('S4 native keyboard/dialog focus, 390/320 layout, axe and reduced motion');
 // Render failures through actual entry, not by calling internal helpers.
 await page.route('**/assets/demo-results.json',r=>r.fulfill({status:503,body:'Unavailable'}));
 await page.reload();
 await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','unavailable');
 await expect(page.locator('#scenario-total')).toBeEmpty();
 await expect(page.locator('#comparison-body [data-party]')).toHaveCount(0);
 await page.unroute('**/assets/demo-results.json');
 const tied=structuredClone(fixture);tied.results['2025'].concejales.rosales.votes={a:12200,b:12200,c:12200,d:12200};
 await page.route('**/assets/demo-results.json',r=>r.fulfill({json:tied}));
 await page.reload();
 await expect(page.locator('#allocation-status')).toHaveAttribute('data-status','blocked');
 await expect(page.locator('#allocation-status')).toContainText('empate');
 await expect(page.locator('#comparison-body [data-field="scenario-seats"]')).toHaveCount(0);
 await page.unroute('**/assets/demo-results.json');await page.reload();await allocations(original,initialSeats);
 checks.push('S3 actual-entry failed input and decisive simulation-convention tie refuse guessed seats');
 const manifest=JSON.parse(await readFile(root+'checks/frozen-inputs.json','utf8'));
 for(const[path,hash]of Object.entries(manifest))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,'Frozen input/source unchanged: '+path);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const build=JSON.parse(await readFile(root+'checks/kernel-build.json','utf8'));
 assert.equal(createHash('sha256').update(await readFile(root+'kernel.js')).digest('hex'),build.outputHash,'External kernel byte identity');
 checks.push('S4 approved source/input/kernel fingerprints, no runtime errors or external requests');
 await transfer(2500);await allocations({a:23982,b:16236,c:6924,d:2158},movedSeats);await screenshot('delivery.png');
 }
 console.log(JSON.stringify({status:'PASS',url,checks},null,2));
} catch(e){failure=e;console.log(JSON.stringify({status:'FAIL',checks,error:e.stack},null,2));}
finally{await writeFile(root+'checks/report.json',JSON.stringify({status:failure?'FAIL':'PASS',time:new Date().toISOString(),checks,error:failure?.stack,errors,external},null,2));await ctx.close();await browser.close();await new Promise(r=>server.close(r));}
if(failure)process.exitCode=1;
