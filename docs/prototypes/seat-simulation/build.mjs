import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo='/Users/nicolasmateoippoliti/dev/votus-plataforma-lla';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire(repo+'/apps/web/package.json');
const esbuild=require('esbuild');
const result=await esbuild.build({stdin:{contents:'export { allocateSeats } from "./domain/seat-allocation/allocate.ts";',resolveDir:repo+'/apps/web/src',sourcefile:'external-prototype-entry.js'},bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:root+'kernel.js',metafile:true,minify:false,legalComments:'eof'});
const paths=Object.keys(result.metafile.inputs).filter(p=>!p.endsWith('external-prototype-entry.js')).map(p=>resolve(p));
for(const sibling of ['territorial-exploration-prototype','temporal-comparison-prototype']){
 for(const name of ['index.html','prototype.css','prototype.js','README.md'])paths.push(resolve(root,'..',sibling,name));
}
for(const name of ['assets/demo-results.json','assets/reference-paths.json','assets/winner-reference-paths.json','assets/plex-sans.woff2','assets/plex-mono.woff2','assets/plex-mono-semibold.woff2','APPROVED-DESIGN.md','generate-demo-results.mjs'])paths.push(resolve(root,'../territorial-exploration-prototype',name));
paths.push(resolve(root,'../temporal-comparison-prototype/assets/comparison-policy.json'));
const manifest={};for(const path of paths)manifest[path]=createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile(root+'checks/frozen-inputs.json',JSON.stringify(manifest,null,2));
await writeFile(root+'checks/kernel-build.json',JSON.stringify({esbuildVersion:esbuild.version,builtAt:new Date().toISOString(),entry:repo+'/apps/web/src/domain/seat-allocation/allocate.ts',outputHash:createHash('sha256').update(await readFile(root+'kernel.js')).digest('hex'),sources:Object.keys(result.metafile.inputs)},null,2));
console.log(`Bundled unchanged kernel; ${paths.length} read-only input/source fingerprints retained.`);
