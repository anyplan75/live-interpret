#!/usr/bin/env node
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
const dir = path.join(root, '.agent-upload', 'gz');
for (const [b64Name, dest] of Object.entries(map)) {
  const b64 = fs.readFileSync(path.join(dir, b64Name), 'utf8').trim();
  const buf = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  fs.writeFileSync(path.join(root, dest), buf);
  console.log('wrote', dest, buf.length);
}
