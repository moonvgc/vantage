// Syntax-checks every Electron main-process file, replacing the hand-maintained
// `node --check` chain in package.json that silently missed new files
// (electron/lib/errorKind.js). Node-side walk keeps cmd/PowerShell/bash portable.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'electron');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(cjs|js|mjs)$/.test(entry) ? [full] : [];
  });
}

const files = walk(target).sort();
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (result.status === 0) console.log(`ok   ${relative}`);
  else {
    failures.push(relative);
    console.error(`FAIL ${relative}\n${result.stderr.trim()}`);
  }
}

console.log(`\n${files.length - failures.length}/${files.length} electron files parsed`);
if (failures.length) process.exit(1);
