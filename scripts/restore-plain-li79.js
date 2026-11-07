#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = process.cwd();
const dir = path.join(root, 'scripts', 'li79-plain');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const row of manifest) {
  let b64 = '';
  if (row.parts === 1) {
    b64 = fs.readFileSync(path.join(dir, `${row.base}.b64`), 'utf8').trim();
  } else {
    for (let i = 0; i < row.parts; i += 1) {
      b64 += fs.readFileSync(path.join(dir, `${row.base}.${i}.b64`), 'utf8').trim();
    }
  }
  const body = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  const dest = path.join(root, row.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  console.log('restored', row.path, body.length);
}
const remove = [
  'broadcast/renderer/renderer.payload.0.b64',
  'broadcast/renderer/renderer.payload.1.b64',
  'test/read-source.js',
  '전체구조안내서-2.md',
  '전체구조안내서-3.md',
  '전체구조안내서-4.md',
  'scripts/expand-li79-gz.js',
  'scripts/expand-engine-hex.js',
  'scripts/restore-plain-li79.js',
  '.github/workflows/restore-plain-li79.yml',
];
for (const rel of remove) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('removed', rel);
  }
}
for (const rel of ['scripts/li79-gz', 'scripts/li79-plain']) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('removed', rel);
  }
}
console.log('done');
