// Summarises eslint -f json output: rule -> [file:line message].
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// eslint exits 1 when it finds problems — that is the expected case here, so
// read stdout regardless of status instead of using execSync (which throws).
const run = spawnSync('npx', ['eslint', '.', '-f', 'json'], { cwd: process.cwd(), encoding: 'utf8', shell: true });
const report = JSON.parse(run.stdout || '[]');
const by = new Map();
let total = 0;
for (const file of report) {
  const rel = path.relative(process.cwd(), file.filePath).replace(/\\/g, '/');
  for (const m of file.messages) {
    total += 1;
    const key = `${m.ruleId || '(parse)'} [${m.severity === 2 ? 'error' : 'warn'}]`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(`${rel}:${m.line}  ${String(m.message).split('\n')[0].slice(0, 90)}`);
  }
}
const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [rule, items] of sorted) {
  console.log(`\n### ${rule}  (${items.length})`);
  for (const item of items) console.log(`   ${item}`);
}
console.log(`\nTOTAL: ${total}`);
