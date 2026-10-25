// Dead-export audit: finds exported names that no other file references.
//
// Conservative by design (a missed dead export is fine; a wrong "dead" verdict
// deletes live code): a name counts as used if it appears as a whole word
// anywhere outside its declaring file, tests and strings included; default
// exports and re-exports (`export { x }`) are skipped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'release') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(path.join(root, 'src')),
  ...walk(path.join(root, 'electron')),
  ...walk(path.join(root, 'scripts'))
];
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const findings = [];
for (const [file, text] of sources) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  // Strip comments before scanning: this script's own docstring contains
  // `export function foo`, which would otherwise be reported as a declaration.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const declared = [];
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.push(m[1]);
  }
  for (const name of declared) {
    const pattern = new RegExp(`(^|[^\\w$])${name}([^\\w$]|$)`, 'm');
    let usedElsewhere = false;
    for (const [other, otherText] of sources) {
      if (other === file) continue;
      if (pattern.test(otherText)) { usedElsewhere = true; break; }
    }
    if (!usedElsewhere) findings.push({ rel, name });
  }
}

if (!findings.length) {
  console.log('no unreferenced exports found');
} else {
  console.log(`unreferenced exports (${findings.length}):`);
  for (const { rel, name } of findings) console.log(`  ${rel}  ->  ${name}`);
}
