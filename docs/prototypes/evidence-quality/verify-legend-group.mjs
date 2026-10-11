import {createRequire} from 'node:module';
import {createPreviewServer} from './serve.mjs';
const require=createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const {chromium,expect}=require('@playwright/test');
const s=createPreviewServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));
const b=await chromium.launch(),c=await b.newContext(),p=await c.newPage();
try{
  await p.goto('http://127.0.0.1:'+s.address().port);
  await expect(p.locator('#positive-votes')).toHaveText('49.300');
  await expect(p.getByRole('group',{name:'Estados de disponibilidad',exact:true})).toBeVisible();
  console.log('PASS actual-entry map legend has a supported accessible group name');
}catch(error){console.log('FAIL '+error.stack);process.exitCode=1;}
finally{await c.close();await b.close();await new Promise(r=>s.close(r));}
