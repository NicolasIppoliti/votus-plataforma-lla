import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPreviewServer} from './serve.mjs';
const server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
try{
 const r=await fetch(url+'assets/demo-results.json');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json/);
 const original=await readFile('../territorial-exploration-prototype/assets/demo-results.json');assert.deepEqual(Buffer.from(await r.arrayBuffer()),original);
 for(const name of ['reference-paths.json','winner-reference-paths.json','plex-sans.woff2','plex-mono.woff2','plex-mono-semibold.woff2','evidence-model.js','evidence-policy.json','simulation-model.js','kernel.js'])assert.equal((await fetch(url+'assets/'+name)).status,200,name);
 assert.equal((await fetch(url,{method:'POST'})).status,404);
 assert.equal((await fetch(url+'assets/../../../AGENTS.md')).status,404);
 console.log('PASS isolated read-only asset entry and unsafe request refusal');
}finally{await new Promise(resolve=>server.close(resolve));}
