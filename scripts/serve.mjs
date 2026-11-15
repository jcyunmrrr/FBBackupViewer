import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(process.argv.includes('--dist') ? 'dist' : '.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    let path = resolve(root, `.${name}`);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Invalid path');
    if (name === '/vendor/fflate.js' && !process.argv.includes('--dist')) path = resolve(root, 'node_modules/fflate/esm/browser.js');
    if (name.startsWith('/public/') && !process.argv.includes('--dist')) path = resolve(root, `.${name}`);
    if (!process.argv.includes('--dist') && ['/icon.svg', '/manifest.webmanifest', '/sw.js'].includes(name)) path = resolve(root, `public${name}`);
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(5173, '127.0.0.1', () => console.log(`Local: http://localhost:5173/`));
