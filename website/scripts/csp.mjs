// The CSP allows inline scripts only by hash: hash every inline script in the exported pages and fill them into _headers.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../out/', import.meta.url));
const pages = (await readdir(out, { recursive: true })).filter((f) => f.endsWith('.html'));

const hashes = new Set();
for (const page of pages) {
  const html = await readFile(`${out}${page}`, 'utf8');
  for (const [, body] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (body) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}

const headersPath = `${out}_headers`;
const headers = await readFile(headersPath, 'utf8');
if (!headers.includes('__INLINE_SCRIPT_HASHES__')) throw new Error('_headers is missing __INLINE_SCRIPT_HASHES__');
await writeFile(headersPath, headers.replace('__INLINE_SCRIPT_HASHES__', [...hashes].join(' ')));
console.log(`csp: ${hashes.size} inline script hash(es) from ${pages.length} pages`);
