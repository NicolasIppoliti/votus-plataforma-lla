import {createRequire} from 'node:module';
import {createPreviewServer} from './serve.mjs';
const require=createRequire('/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/package.json');
const {chromium,expect}=require('@playwright/test');
const s=createPreviewServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r));
const b=await chromium.launch(), c=await b.newContext(), p=await c.newPage();
try {
  await p.route('**/assets/demo-results.json',r=>r.fulfill({status:503,body:'{}'}));
  await p.goto('http://127.0.0.1:'+s.address().port);
  await expect(p.locator('#evidence-status')).toHaveAttribute('data-state','unavailable');
  await p.unroute('**/assets/demo-results.json');
  await p.locator('#retry').focus(); await p.keyboard.press('Enter');
  await expect(p.locator('#positive-votes')).toHaveText('49.300');
  await expect(p.locator('#selected-heading')).toBeFocused();
  console.log('PASS actual-entry keyboard retry restores logical selection focus');
} catch(error) {console.log('FAIL '+error.stack);process.exitCode=1;}
finally{await c.close();await b.close();await new Promise(r=>s.close(r));}
