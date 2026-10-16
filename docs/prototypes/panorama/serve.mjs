import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const shared=new Map();
for(const name of ['demo-results.json','reference-paths.json','winner-reference-paths.json','plex-sans.woff2','plex-mono.woff2','plex-mono-semibold.woff2'])
  shared.set(name,fileURLToPath(new URL('../territorial-exploration/assets/'+name,import.meta.url)));
shared.set('evidence-model.js',fileURLToPath(new URL('../evidence-quality/evidence-model.js',import.meta.url)));
shared.set('evidence-policy.json',fileURLToPath(new URL('../evidence-quality/assets/evidence-policy.json',import.meta.url)));
for(const name of ['simulation-model.js','kernel.js'])shared.set(name,fileURLToPath(new URL('../seat-simulation/'+name,import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.woff2':'font/woff2'};
export function createPreviewServer(){
  return createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const name=pathname.startsWith('/assets/')?pathname.slice(8):'';
      const file=shared.get(name)??resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if((!shared.has(name)&&!file.startsWith(root.endsWith(sep)?root:root+sep))||!types[extname(file)]||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end('Not found');return;}
      const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Prototype not created yet');}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const server=createPreviewServer();server.listen(Number(process.argv[2]??0),'127.0.0.1',()=>console.log(`Panorama prototype: http://127.0.0.1:${server.address().port}/`));
}
