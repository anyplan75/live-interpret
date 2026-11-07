#!/usr/bin/env node
/**
 * Expand LI-79 large sources from gzip+base64 sidecars under scripts/li79-gz/.
 * Accepts either NAME.b64 or NAME.0.b64+NAME.1.b64 (concatenated).
 * Run from the repo root after fetching branch cursor/fix-pipeline-start-delay-117f.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = process.cwd();
const map = {
  'docs__js__desk-client.js.b64': 'docs/js/desk-client.js',
  'broadcast__lib__engine.js.b64': 'broadcast/lib/engine.js',
  'broadcast__main.js.b64': 'broadcast/main.js',
  'broadcast__renderer__renderer.js.b64': 'broadcast/renderer/renderer.js',
  'guide.md.b64': '전체구조안내서.md',
};
const dir = path.join(root, 'scripts', 'li79-gz');
function readB64(b64Name) {
  const full = path.join(dir, b64Name);
  if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8').trim();
  const base = b64Name.replace(/\.b64$/, '');
  const parts = [];
  for (let i = 0; ; i++) {
    const p = path.join(dir, `${base}.${i}.b64`);
    if (!fs.existsSync(p)) break;
    parts.push(fs.readFileSync(p, 'utf8').trim());
  }
  if (!parts.length) throw new Error('missing ' + b64Name);
  return parts.join('');
}
for (const [b64Name, dest] of Object.entries(map)) {
  const b64 = readB64(b64Name);
  const buf = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  fs.writeFileSync(path.join(root, dest), buf);
  console.log('wrote', dest, buf.length);
}
