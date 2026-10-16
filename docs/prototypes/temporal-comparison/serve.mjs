import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const referenceRoot = fileURLToPath(new URL('../territorial-exploration/assets/', import.meta.url));
const referenceFiles = new Set(['demo-results.json', 'reference-paths.json', 'winner-reference-paths.json', 'plex-sans.woff2', 'plex-mono.woff2', 'plex-mono-semibold.woff2']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export function createPreviewServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const referenceName = pathname.startsWith('/assets/') ? pathname.slice('/assets/'.length) : '';
      const file = referenceFiles.has(referenceName) ? resolve(referenceRoot, referenceName) : resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if ((!file.startsWith(root) && !referenceFiles.has(referenceName)) || !types[extname(file)]) {
        response.writeHead(404).end('Not found');
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(content);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Prototype not created yet');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1', () => console.log(`Comparison prototype: http://127.0.0.1:${server.address().port}`));
}
