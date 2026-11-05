// Builds dist/worker.mjs: one module with the Worker, its schema and every file in public/ (for uploading through the
// Cloudflare API without wrangler). `npm run deploy` (wrangler) does not need this: it serves public/ as static assets.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root = new URL('../', import.meta.url);
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', json: 'application/json' };
const files = {};
(function walk(dir, base) {
  for (const f of readdirSync(dir)) {
    const p = dir + '/' + f; if (statSync(p).isDirectory()) { walk(p, base + f + '/'); continue; }
    const buf = readFileSync(p), ext = f.split('.').pop();
    files['/' + base + f] = { t: TYPES[ext] || 'application/octet-stream', b: buf.toString('base64'), e: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' };
  }
})(new URL('public', root).pathname, '');
let worker = readFileSync(new URL('src/worker.mjs', root), 'utf8');
const schema = readFileSync(new URL('src/schema.mjs', root), 'utf8').replace('export const SCHEMA', 'const SCHEMA');
worker = worker.replace(/^import \{ SCHEMA \} from '\.\/schema\.mjs';\n/m, schema + '\n');
// the file table is gzipped and unpacked once per isolate, which keeps the upload small
const packed = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 }).toString('base64');
const assets = `const __PACKED = '${packed}';
const __bin = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
let __files = null;
async function __table() {
  if (!__files) __files = new Response(new Blob([__bin(__PACKED)]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  return __files;
}
globalThis.__DUES_ASSETS = { async fetch(req) {
  const p = new URL(req.url).pathname, f = (await __table())[p];
  if (!f) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  if (req.headers.get('If-None-Match') === f.e) return new Response(null, { status: 304, headers: { ETag: f.e } });
  return new Response(__bin(f.b), { headers: { 'Content-Type': f.t, ETag: f.e, 'Cache-Control': f.t.startsWith('text/html') ? 'no-cache' : 'public, max-age=300' } });
} };
`;
mkdirSync(new URL('dist', root), { recursive: true });
writeFileSync(new URL('dist/worker.mjs', root), assets + worker);
console.log('dist/worker.mjs', Math.round((assets + worker).length / 1024) + ' KB,', Object.keys(files).length, 'files');
