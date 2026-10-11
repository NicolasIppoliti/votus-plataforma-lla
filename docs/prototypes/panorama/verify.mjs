import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from './serve.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const{chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fixture=JSON.parse(await readFile(root+'../territorial-exploration-prototype/assets/demo-results.json'));
const geography=JSON.parse(await readFile(root+'../territorial-exploration-prototype/assets/winner-reference-paths.json'));
const policy=JSON.parse(await readFile(root+'../evidence-quality-prototype/assets/evidence-policy.json'));
const baseline=JSON.parse(await readFile(root+'checks/immutable-inputs.json'));
const fmt=n=>new Intl.NumberFormat('es-AR').format(n);
const parties={a:{name:'Alianza A',color:'#65e5f2'},b:{name:'Alianza B',color:'#aac0f1'},c:{name:'Lista C',color:'#efc58c'},d:{name:'Lista D',color:'#769598'}};
const kinds={country:'authored_province_aggregates',province:'authored_partido_aggregates',partido:'authored_circuits'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1424,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
const checks=[],errors=[],external=[],accessibility=[],faults=[];
function observe(p){p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});}
observe(page);
async function check(name,fn){await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function select(id,value,p=page){await p.locator('#'+id).selectOption(value);}
async function ready(p=page){await expect(p.locator('#territory')).toBeEnabled();}
async function inspect(id,p=page){
 const node=fixture.nodes[id];const parent=node.level==='province'?'argentina':'buenos-aires';
 await select('territory',parent,p);await p.locator('#territory-search').fill(node.label);
 await p.locator('#territory-body tr[data-node="'+id+'"]').getByRole('button',{name:'Inspeccionar '+node.label,exact:true}).click();
 await expect(p.locator('#selected-heading')).toHaveText(node.label);await expect(p.locator('#selected-heading')).toBeFocused();
}
function oracle(id,year,category){
 const r=fixture.results[year][category][id],node=fixture.nodes[id],votes=r.votes?Object.values(r.votes):[];
 const total=r.votes?votes.reduce((a,b)=>a+b,0):null,max=total===null?null:Math.max(...votes);
 const winners=total>0?Object.keys(r.votes).filter(k=>r.votes[k]===max):[];
 const sorted=[...votes].sort((a,b)=>b-a),typed=policy.demonstration.coverageUnits[id];
 const unit=typed?.kind===kinds[node.level]&&r.coverage.total===node.childIds.length?typed:null;
 return{r,total,winners,share:total>0?100*max/total:null,margin:total>0?100*(sorted[0]-sorted[1])/total:null,unit};
}
async function approx(id,expected,p=page){
 const value=await p.locator('#'+id).innerText();const n=Number(value.replace(/[^\d,.-]/g,'').replace(',','.'));
 assert.ok(Number.isFinite(n)&&Math.abs(n-expected)<=0.051,id+': '+value+' vs '+expected);
}
async function selection(id,year,category,p=page){
 const o=oracle(id,year,category);
 await expect(p.locator('#evidence-status')).toHaveAttribute('data-state',o.r.status);
 await expect(p.locator('#positive-votes')).toHaveText(o.total===null?'—':fmt(o.total));
 await expect(p.locator('#coverage-ratio')).toHaveText(fmt(o.r.coverage.reported)+'/'+fmt(o.r.coverage.total));
 if(o.unit){await expect(p.locator('#coverage-unit')).toContainText(o.unit.label);await approx('coverage-percent',100*o.r.coverage.reported/o.r.coverage.total,p);}
 else await expect(p.locator('#coverage-percent')).toHaveText('—');
 if(o.total===null||o.total===0||o.winners.length>1){
  await expect(p.locator('#leader-share')).toHaveText('—');await expect(p.locator('#lead-margin')).toHaveText('—');
  if(o.winners.length>1)await expect(p.locator('#leader-name')).toContainText(/empate/i);
 }
 else{
  await approx('leader-share',o.share,p);await approx('lead-margin',o.margin,p);
  await expect(p.locator('#leader-name')).toContainText(parties[o.winners[0]].name);
 }
 return o;
}
async function masked(p=page){
 for(const id of ['positive-votes','leader-share','lead-margin','coverage-ratio','coverage-percent'])await expect(p.locator('#'+id)).toHaveText('—');
 assert.doesNotMatch(await p.locator('#leader-name').innerText(),/Alianza A|Alianza B|Lista C|Lista D/);
 assert.equal(await p.locator('#map-shapes [data-winner]').count(),0);
 assert.doesNotMatch(await p.locator('#insights-list').innerText(),/27[.,]400[.,]000|49[.,]300|23\/24|135\/135|UNTRUSTED_/);
}
let failure;
try{
 await check('P1 actual default Panorama entry and explicitly fictional partial aggregate',async()=>{
  assert.equal((await page.goto(url)).status(),200);await ready();
  await expect(page.getByRole('heading',{name:'Panorama',exact:true,level:1})).toBeVisible();
  await expect(page.locator('#selected-heading')).toHaveText('Argentina');
  await selection('argentina','2025','national-deputies');
  assert.match(await page.locator('main').innerText(),/demostración|fictici/i);
  assert.match(await page.locator('main').innerText(),/independiente|no.*suma/i);
  assert.match(await page.locator('main').innerText(),/provisori|provisional|parcial|votos.*disponibles/i);
 });
 await check('P2 full provincial and partido reference sets, palette eligibility and retained observed geometry',async()=>{
  for(const[rootId,shapes]of[['argentina',geography.provinces],['buenos-aires',geography.partidos]]){
   await select('territory',rootId);await select('category','national-deputies');
   assert.equal(await page.locator('#map-shapes path[data-node]').count(),shapes.length);
   for(const shape of shapes){
    const path=page.locator('#map-shapes path[data-node="'+shape.id+'"]');const o=oracle(shape.id,'2025','national-deputies');
    const winner=o.r.status==='complete'&&o.total>0&&o.winners.length===1&&shape.geometryValid?o.winners[0]:null;
    assert.equal(await path.getAttribute('data-winner'),winner,shape.id);
    if(winner)assert.equal((await path.evaluate(e=>getComputedStyle(e).fill)),await page.evaluate(hex=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=hex;return c.fillStyle},parties[winner].color).then(hex=>{const v=hex.slice(1);return `rgb(${parseInt(v.slice(0,2),16)}, ${parseInt(v.slice(2,4),16)}, ${parseInt(v.slice(4,6),16)})`;}),shape.id);
   }
  }
  await expect(page.locator('#map-legend')).toHaveAttribute('role','group');
  await expect(page.locator('#map-legend')).toHaveAccessibleName(/.+/);
 });
 await check('P2 actual map keyboard navigation and breadcrumbs restore logical selection focus',async()=>{
  await select('territory','argentina');
  await page.locator('#map-shapes path[data-node="buenos-aires"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#selected-heading')).toHaveText('Buenos Aires');await expect(page.locator('#selected-heading')).toBeFocused();
  await page.locator('#map-shapes path[data-node="rosales"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#selected-heading')).toHaveText('Coronel Rosales');await expect(page.locator('#selected-heading')).toBeFocused();
  await page.locator('#breadcrumbs').getByRole('button',{name:'Argentina',exact:true}).press('Enter');
  await expect(page.locator('#selected-heading')).toHaveText('Argentina');await expect(page.locator('#selected-heading')).toBeFocused();
 });
 await check('P2 complete zero/tie, absent vector and untyped partial remain different outcomes',async()=>{
  for(const id of ['province-ciudad-autonoma-de-buenos-aires','province-catamarca','province-chaco','province-chubut']){
   await inspect(id);await selection(id,'2025','national-deputies');
   if(id.includes('chaco'))assert.match(await page.locator('#leader-name').innerText(),/sin|no|—/i);
   if(id.includes('chubut')){await expect(page.locator('#coverage-percent')).toHaveText('—');assert.match(await page.locator('main').innerText(),/parcial|provisori|votos.*disponibles/i);}
   if(id.includes('ciudad-autonoma'))assert.match(await page.locator('#leader-name').innerText(),/cero|sin votos|0/i);
  }
 });
 await check('P2 selected year/category record, generic council0/1 and fictional typed units',async()=>{
  await select('category','concejales');
  for(const id of ['argentina','buenos-aires']){await select('territory',id);await selection(id,'2025','concejales');await expect(page.locator('#coverage-percent')).toHaveText('—');}
  await select('territory','rosales');await selection('rosales','2025','concejales');
  await select('base-year','2023');await selection('rosales','2023','concejales');
  await expect(page.locator('#positive-votes')).toHaveText('48.800');
  await select('base-year','2025');await select('category','national-deputies');
 });
 await check('P2/P3 lookup/pagination preserve aggregate, child coverage and high-level end boundary',async()=>{
  await select('territory','buenos-aires');const votes=await page.locator('#positive-votes').innerText();
  await page.locator('#territory-search').fill('Coronel Rosales');await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(1);
  assert.equal(await page.locator('#positive-votes').innerText(),votes);await page.locator('#territory-search').fill('');
  await expect(page.locator('#row-count')).toContainText('135');
  if(await page.locator('#next-page').isEnabled()){const first=await page.locator('#territory-body').innerText();await page.locator('#next-page').click();assert.notEqual(await page.locator('#territory-body').innerText(),first);await page.locator('#previous-page').click();}
  await select('territory','rosales');await expect(page.locator('#territory-body tr[data-node]')).toHaveCount(0);
  assert.equal(await page.locator('#map-shapes [data-node^="demo-"]').count(),0);
  assert.match(await page.locator('main').innerText(),/exploración/i);
 });
 await check('P1/P3 real-data mode is unknown, clears fiction and never implies denied access or zero coverage',async()=>{
  await select('territory','argentina');await select('evidence-mode','unknown');
  await expect(page.locator('#evidence-status')).toHaveAttribute('data-state','unknown');await masked();
  assert.match(await page.locator('main').innerText(),/no.*consult|desconocid/i);
  await select('territory','buenos-aires');await masked();
  await select('evidence-mode','demonstration');await selection('buenos-aires','2025','national-deputies');
 });
 await check('P3 four actual sibling entries disclose no context transfer and no ineffective query/deep link',async()=>{
  await expect(page.locator('#navigation-notice')).toHaveText('Cada prototipo abre su contexto inicial; la selección no se transfiere.');
  await expect(page.getByRole('link',{name:'Saltar al contenido',exact:true})).toHaveAttribute('href','#main');
  const links=await page.locator('a[href^="http"]').evaluateAll(es=>es.map(e=>e.href));
  for(const port of [63193,65171,64232,53713]){const href=`http://127.0.0.1:${port}/`;assert.ok(links.includes(href),href);assert.equal((await fetch(href)).status,200);}
  for(const link of links.filter(x=>/^http/.test(x))){const u=new URL(link);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.search,'');assert.equal(u.hash,'');}
 });
 await check('P1/P4 real HTTP/malformed/invalid fixtures fail closed and native retry restores focus',async()=>{
  const cases=[['HTTP503','demo-results.json',null,503,'unavailable'],['malformed JSON','demo-results.json','{bad',200,'error'],
   ['unsafe vote','demo-results.json',f=>{f.results['2025']['national-deputies'].argentina.votes.a=Number.MAX_SAFE_INTEGER+1;},200,'error'],
   ['unknown party','demo-results.json',f=>{f.results['2025']['national-deputies'].argentina.votes.e=1;},200,'error'],
   ['missing party','demo-results.json',f=>{delete f.results['2025']['national-deputies'].argentina.votes.d;},200,'error'],
   ['bad coverage','demo-results.json',f=>{f.results['2025']['national-deputies'].argentina.coverage.reported=25;},200,'error'],
   ['missing record','demo-results.json',f=>{delete f.results['2023'].concejales.rosales;},200,'error'],
   ['missing policy','evidence-policy.json',null,503,'unavailable'],['missing geographic asset','winner-reference-paths.json',null,503,'unavailable']];
  for(const[name,file,mutation,status,wanted]of cases){
   const c=await browser.newContext(),p=await c.newPage();observe(p);
   await p.route('**/assets/'+file,r=>{const f=typeof mutation==='function'?structuredClone(fixture):null;if(f)mutation(f);return r.fulfill({status,contentType:'application/json',body:f?JSON.stringify(f):mutation??'{}'});});
   try{
    await p.goto(url);await expect(p.locator('#evidence-status')).toHaveAttribute('data-state',wanted);await masked(p);
    await p.unroute('**/assets/'+file);await p.locator('#retry').focus();await p.keyboard.press('Enter');
    await expect(p.locator('#positive-votes')).toHaveText('27.400.000');await expect(p.locator('#selected-heading')).toBeFocused();faults.push({name,status:'PASS'});
   }catch(e){throw new Error(name+': '+e.message);}finally{await c.close();}
  }
 });
 await check('P3 untrusted notes and arbitrary originating causes never become recommendations/provenance',async()=>{
  const c=await browser.newContext(),p=await c.newPage();observe(p);const hostile=structuredClone(fixture);
  for(const node of Object.values(hostile.nodes)){node.note='UNTRUSTED_NODE';node.cause='UNTRUSTED_INGESTION';}
  for(const y of ['2023','2025'])for(const category of ['concejales','national-deputies'])for(const r of Object.values(hostile.results[y][category])){r.note='UNTRUSTED_NOTE';r.cause='UNTRUSTED_CAUSE';r.missingReason='UNTRUSTED_REASON';}
  await p.route('**/assets/demo-results.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(hostile)}));
  try{await p.goto(url);await ready(p);assert.doesNotMatch(await p.locator('main').innerText(),/UNTRUSTED_/);await inspect('province-chaco',p);assert.doesNotMatch(await p.locator('main').innerText(),/UNTRUSTED_/);}finally{await c.close();}
 });
 await check('P4 desktop/320/390 responsive and reduced-motion bounds with complete axe findings retained',async()=>{
  for(const width of [1424,320,390]){const c=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),p=await c.newPage();observe(p);
   try{await p.goto(url);await ready(p);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Overflow '+width);
    const a=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();accessibility.push({width,violations:a.violations,incomplete:a.incomplete});
    assert.deepEqual(a.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
    await p.screenshot({path:root+'checks/view-'+width+'.png',fullPage:true});
   }finally{await c.close();}
  }
 });
 await check('P4 no unexpected browser errors/requests/storage and147 start input hashes unchanged',async()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.deepEqual(await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,indexedDB:await indexedDB.databases(),cache:await caches.keys()})),{local:0,session:0,indexedDB:[],cache:[]});
  assert.deepEqual(await context.cookies(),[]);assert.equal(Object.keys(baseline.files).length,147);
  for(const[path,hash]of Object.entries(baseline.files))assert.equal(sha(await readFile(path)),hash,path);
 });
}catch(e){failure=e;console.log('FAIL '+e.stack);await page.screenshot({path:root+'checks/parent-failure.png',fullPage:true}).catch(()=>{});}
finally{
 await writeFile(root+'checks/report.json',JSON.stringify({status:failure?'FAIL':'PASS_WITH_LIMITATION',checks,error:failure?.stack,errors,external,faults,accessibility,time:new Date().toISOString(),priorEvidenceOriginalStatus:baseline.priorEvidenceOriginalStatus,priorEvidenceOriginalDivergences:baseline.priorEvidenceOriginalDivergences,limits:['Fictional vectors and percentages, no real coverage/permissions queried','Manual contrast/full WCAG/physical/native popup/other browser verification not certified','Existing sibling links reset selection','Old Evidence original gate remains failed for two external ETL changes']},null,2));
 await context.close();await browser.close();await new Promise(r=>server.close(r));
}
if(failure)process.exitCode=1;
