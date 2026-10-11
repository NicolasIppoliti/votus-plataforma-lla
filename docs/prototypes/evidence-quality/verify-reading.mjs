import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createPreviewServer} from './serve.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const {chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fixture=JSON.parse(await readFile(root+'../territorial-exploration-prototype/assets/demo-results.json'));
const immutable=JSON.parse(await readFile(root+'checks/immutable-inputs.json'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1424,height:1120}}),page=await context.newPage();
const checks=[],errors=[],external=[];
function observe(p){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});}
observe(page);
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function select(id,value,p=page){await p.locator('#'+id).selectOption(value);}
async function inspect(id){
  await page.locator('#territory-body tr[data-node="'+id+'"]').getByRole('button',{name:'Inspeccionar '+fixture.nodes[id].label,exact:true}).click();
  await expect(page.locator('#reading-scope')).toHaveText(fixture.nodes[id].label);
}
async function noApproval(p=page){
  const text=await p.locator('#reading-guide').innerText();
  assert.doesNotMatch(text,/apto para|habilitad[oa] para|calidad certificada|confianza.*%|UNTRUSTED_/i);
  await expect(p.locator('#can-interpret')).not.toHaveText('');
  await expect(p.locator('#cannot-claim')).not.toHaveText('');
}
async function blocked(p=page){
  await noApproval(p);
  for(const id of ['can-interpret','cannot-claim','reading-origin-reason','reading-impact'])
    assert.doesNotMatch(await p.locator('#'+id).innerText(),/49[.,]300|48[.,]800|2\/2|23\/24|100%|UNTRUSTED_/);
  await expect(p.locator('#territory-body tr[data-node]')).toHaveCount(0);
}
async function limits(id){
  const row=page.locator('#territory-body tr[data-node="'+id+'"]');
  await row.locator('[data-field="limits"] summary').click();
  return row.locator('[data-field="limits"]');
}
let failure;
try{
  await check('E5 real entry practical reading is selection-bound and does not approve downstream data',async()=>{
    assert.equal((await page.goto(url)).status(),200);
    await expect(page.getByRole('region',{name:'Qué permite esta evidencia',exact:true})).toBeVisible();
    await expect(page.locator('#reading-scope')).toHaveText('Coronel Rosales');
    await expect(page.locator('#can-interpret')).toContainText(/fictici|demostración/);
    await expect(page.locator('#cannot-claim')).toContainText(/oficial/);
    await expect(page.locator('#reading-impact')).toContainText(/compar|simul/i);
    await expect(page.locator('#reading-origin-reason')).toContainText(/sin faltantes|no hay faltantes/i);
    await noApproval();
    await expect(page.locator('#positive-votes')).toHaveText('49.300');
  });
  await check('E6 child limits are reachable by keyboard and do not turn missing geometry into missing votes',async()=>{
    const row=page.locator('#territory-body tr[data-node="demo-circuit-01"]');
    const summary=row.locator('[data-field="limits"] summary');
    await summary.focus();await page.keyboard.press('Enter');
    await expect(row.locator('[data-field="limits"] details')).toHaveAttribute('open','');
    await expect(summary).toBeFocused();
    await expect(row.locator('[data-field="reason"]')).toContainText(/sin faltantes|no hay faltantes/i);
    await expect(row.locator('[data-field="impact"]')).toContainText(/ubicación propia|referencia/i);
    for(const id of ['demo-circuit-01','demo-school-01-01','demo-table-01-01-01']){
      await inspect(id);await noApproval();
      await expect(page.locator('#reading-impact')).toContainText(/ubicación propia|referencia/i);
      await expect(page.locator('#territory-map')).toHaveAttribute('data-reference-scope','rosales');
    }
  });
  await check('E5/E6 missing and partial explanations state unknown cause; zero and tie stay complete',async()=>{
    await select('category','national-deputies');await select('territory','argentina');
    const missing=await limits('province-chaco');
    await expect(missing.locator('[data-field="reason"]')).toContainText('Motivo de origen no informado');
    await expect(missing.locator('[data-field="impact"]')).toContainText(/no|sin/i);
    const partial=await limits('province-chubut');
    await expect(partial.locator('[data-field="reason"]')).toContainText('Motivo de origen no informado');
    for(const id of ['province-chaco','province-chubut']){
      await inspect(id);
      await expect(page.locator('#reading-origin-reason')).toContainText('Motivo de origen no informado');
      await noApproval();
      await select('territory','argentina');
    }
    for(const id of ['province-ciudad-autonoma-de-buenos-aires','province-catamarca']){
      await inspect(id);await expect(page.locator('#evidence-status')).toHaveAttribute('data-state','complete');
      await expect(page.locator('#reading-origin-reason')).toContainText(/sin faltantes|no hay faltantes/i);
      await noApproval();await select('territory','argentina');
    }
  });
  await check('E5 selected record overrides node metadata and filters never rewrite practical reading',async()=>{
    await select('category','concejales');
    for(const id of ['argentina','buenos-aires']){
      await select('territory',id);
      await expect(page.locator('#reading-origin-reason')).toContainText('Motivo de origen no informado');
      await expect(page.locator('#coverage-percent')).toHaveText('—');
      await expect(page.locator('#coverage-ratio')).toHaveText('0/1');
    }
    await select('category','national-deputies');await select('territory','argentina');
    const original=await page.locator('#reading-guide').innerText();
    await page.locator('#territory-search').fill('zzzz-no-territorio');
    assert.equal(await page.locator('#reading-guide').innerText(),original);
    await page.locator('#territory-search').fill('');
    await select('availability-filter','partial');
    assert.equal(await page.locator('#reading-guide').innerText(),original);
    await select('availability-filter','all');
    await inspect('buenos-aires');
    await expect(page.locator('#reading-impact')).toContainText(/geometr|referencia/i);
    await expect(page.locator('#evidence-status')).toHaveAttribute('data-state','complete');
  });
  await check('E5 unknown/internal/simulated states replace all guidance without stale figures or approval',async()=>{
    await select('territory','rosales');await select('category','concejales');
    await select('evidence-mode','verified');await blocked();
    await expect(page.locator('#can-interpret')).toContainText(/código|capacidad/i);
    await expect(page.locator('#cannot-claim')).toContainText(/cobertura|permis/i);
    await select('source-kind','internal');await blocked();
    await expect(page.locator('#reading-guide')).toContainText(/no.*aleatori/i);
    await expect(page.locator('#reading-guide')).toContainText(/sin muestra|no.*muestra/i);
    await select('source-kind','official');await select('evidence-mode','demonstration');
    await page.getByText('Casos de consulta',{exact:true}).click();
    for(const [value,state]of [['empty','empty'],['denied','denied'],['unavailable','unavailable'],['truncated','truncated'],['malformed','error']]){
      await select('consultation-case',value);
      await expect(page.locator('#evidence-status')).toHaveAttribute('data-state',state);
      await expect(page.locator('#reading-guide')).toContainText(/simulad|caso de diseño/i);
      await blocked();
    }
    await select('consultation-case','normal');
    await expect(page.locator('#positive-votes')).toHaveText('49.300');
    await expect(page.locator('#reading-origin-reason')).toContainText(/sin faltantes|no hay faltantes/i);
  });
  await check('E6 free source notes/unknown reason keys are never rendered as originating diagnoses',async()=>{
    const c=await browser.newContext(),p=await c.newPage();observe(p);
    const hostile=structuredClone(fixture);
    for(const year of ['2023','2025'])for(const category of ['concejales','national-deputies'])
      for(const record of Object.values(hostile.results[year][category])){
        record.note='UNTRUSTED_NOTE';record.cause='UNTRUSTED_CAUSE';record.missingReason='UNTRUSTED_MISSING_REASON';
      }
    await p.route('**/assets/demo-results.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(hostile)}));
    try{
      await p.goto(url);await select('category','national-deputies',p);await select('territory','argentina',p);
      const row=p.locator('#territory-body tr[data-node="province-chaco"]');
      await row.locator('[data-field="limits"] summary').click();
      await expect(row.locator('[data-field="reason"]')).toContainText('Motivo de origen no informado');
      await row.getByRole('button',{name:'Inspeccionar Chaco',exact:true}).click();
      assert.doesNotMatch(await p.locator('main').innerText(),/UNTRUSTED_/);
    }finally{await c.close();}
  });
  await check('E5 local loading/error/503 guidance clears old text and real retry restores it',async()=>{
    const c=await browser.newContext(),p=await c.newPage();observe(p);
    await p.route('**/assets/demo-results.json',r=>r.fulfill({status:503,body:'{}'}));
    try{
      await p.goto(url);await expect(p.locator('#evidence-status')).toHaveAttribute('data-state','unavailable');
      await blocked(p);assert.doesNotMatch(await p.locator('#reading-guide').innerText(),/motivo.*ingesta.*fall/i);
      await p.unroute('**/assets/demo-results.json');await p.locator('#retry').focus();await p.keyboard.press('Enter');
      await expect(p.locator('#positive-votes')).toHaveText('49.300');
      await expect(p.locator('#selected-heading')).toBeFocused();await noApproval(p);
    }finally{await c.close();}
  });
  await check('E7 desktop/390/320 reading and expandable limits are usable, without serious/critical axe violations',async()=>{
    for(const width of [1424,390,320]){
      const c=await browser.newContext({viewport:{width,height:1120},reducedMotion:'reduce'}),p=await c.newPage();observe(p);
      try{
        await p.goto(url);await expect(p.locator('#reading-guide')).toBeVisible();
        const summary=p.locator('#territory-body tr[data-node="demo-circuit-01"] [data-field="limits"] summary');
        await summary.focus();await p.keyboard.press('Enter');
        await expect(p.locator('#territory-body tr[data-node="demo-circuit-01"] [data-field="impact"]')).toBeVisible();
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        const result=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        assert.deepEqual(result.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
        await p.screenshot({path:root+'checks/reading-'+width+'.png',fullPage:true});
      }finally{await c.close();}
    }
  });
  await check('E7 no unexpected errors/external traffic/storage;139 immutable inputs unchanged',async()=>{
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
    for(const [path,hash]of Object.entries(immutable))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,path);
  });
}catch(error){failure=error;console.log('FAIL '+error.stack);}
finally{
  await writeFile(root+'checks/reading-report.json',JSON.stringify({status:failure?'FAIL':'PASS',checks,error:failure?.stack,time:new Date().toISOString(),errors,external,limits:['Only a fictional sample and dated code snapshot; no live source binding','Manual contrast/full WCAG/physical devices/hosted coverage remain unverified']},null,2));
  await context.close();await browser.close();await new Promise(r=>server.close(r));
}
if(failure)process.exitCode=1;
