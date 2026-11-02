import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Build first. This creates an offline app with its compiled JS and CSS embedded.
const output = process.argv[2] || 'Tracegrade.html';
const root = process.cwd();
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Run npm run build before creating the portable app.');
let html = readFileSync(resolve(dist, 'index.html'), 'utf8');
html = html.replace(/<script\b([^>]*?)src="([^"]+)"([^>]*)><\/script>/g, (_, before, src) => {
  const js = readFileSync(resolve(dist, src.replace(/^\//, '')), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readFileSync(resolve(dist, href.replace(/^\//, '')), 'utf8')}</style>`);
html = html.replace(/<link\b[^>]*rel="icon"[^>]*>/g, '');
writeFileSync(resolve(output), html);
console.log(JSON.stringify({ file: resolve(output), bytes: Buffer.byteLength(html) }));
