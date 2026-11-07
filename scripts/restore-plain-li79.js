#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const root = process.cwd();
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'cursor/fix-pipeline-li79-117f';
const onMacCi = process.env.GITHUB_ACTIONS && process.env.RUNNER_OS === 'macOS';
if (onMacCi) {
  execSync('git config user.name cursor-agent', { stdio: 'inherit' });
  execSync('git config user.email cursor-agent@users.noreply.github.com', { stdio: 'inherit' });
  execSync(`git fetch origin ${branch}`, { stdio: 'inherit' });
  execSync(`git checkout -B ${branch} origin/${branch}`, { stdio: 'inherit' });
}
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
for (const rel of ['scripts/li79-gz', 'scripts/li79-plain', '.li79-tmp']) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('removed', rel);
  }
}
const pkgPath = path.join(root, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.scripts && pkg.scripts.test && String(pkg.scripts.test).includes('restore-plain-li79')) {
    pkg.scripts.test = 'node --test test/*.js';
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log('restored package.json test script');
  }
}
if (onMacCi) {
  execSync('git add -A', { stdio: 'inherit' });
  let dirty = true;
  try {
    execSync('git diff --cached --quiet');
    dirty = false;
  } catch (_) {
    dirty = true;
  }
  if (dirty) {
    execSync('git commit -m "Restore plain LI-79 sources; drop SEF/hex helpers"', { stdio: 'inherit' });
    execSync(`git push origin HEAD:${branch}`, { stdio: 'inherit' });
    console.log('pushed', branch);
  } else {
    console.log('nothing to commit');
  }
}
console.log('done');
