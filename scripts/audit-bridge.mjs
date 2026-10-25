// Diffs what the renderer calls on the preload bridge against what
// contextBridge.exposeInMainWorld exposes.
//
// Why: calling a bridge method the preload never exposed throws `x is not a
// function` at RUNTIME only — build, lint and tests stay green, and the dev mock
// (src/devMock.js) implements methods the real preload lacks, so the gap appears
// only in the packaged app (that is how `deleteAccount` broke the delete button).
//
// Usage: node scripts/audit-bridge.mjs [repoRoot]
// Exit 1 when the renderer calls a method that is not exposed (crash class).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const bridge = 'valorant';
const preloadPath = join(root, 'electron', 'preload.cjs');
const srcDir = join(root, 'src');

const IDENT = '[A-Za-z_$][\\w$]*';

// Strings and comments are stripped before scanning, so prose cannot look like
// a call: the URL 'valorant-api.com' in a string literal would otherwise match
// the `api` alias plus `.com` and report a phantom missing method.
function stripNonCode(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return ['.js', '.jsx'].includes(extname(full)) ? [full] : [];
  });
}

// `contextBridge.exposeInMainWorld('valorant', { name: () => ... })` — the keys
// sit at two-space indent inside the object literal.
function exposedMethods(source) {
  const names = new Set();
  for (const line of source.split('\n')) {
    const match = line.match(/^ {2}([A-Za-z_$][\w$]*)\s*:/);
    if (match) names.add(match[1]);
  }
  return names;
}

// Aliases (`const api = window.valorant`, or one alias derived from another via
// the `bridge()` helper) are resolved to a fixpoint.
//
// The initializer MUST reference the bare bridge, not `window.valorant.method(...)`:
// otherwise `const response = await window.valorant.renameAccount(x)` looks like an
// alias and `response.ok` / `response.data` become phantom "missing method" reports.
// Declarations are matched one line at a time for the same reason — multi-line
// initializers are not guessed at.
function collectAliases(text) {
  const aliases = new Set();
  const aliasLines = new Set();
  const lines = text.split('\n');
  const bareBridge = new RegExp(`window\\.${bridge}(?!\\s*\\.\\s*${IDENT})`);

  for (let pass = 0; pass < 5; pass += 1) {
    let grew = false;
    lines.forEach((line, index) => {
      const declared = line.match(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(.+)$`));
      if (!declared) return;
      const [, name, initializer] = declared;
      if (aliases.has(name)) return;
      const fromBridge = bareBridge.test(initializer);
      const fromAlias = [...aliases].some((alias) => new RegExp(`\\b${alias}\\s*\\(`).test(initializer));
      if (fromBridge || fromAlias) {
        aliases.add(name);
        aliasLines.add(index + 1);
        grew = true;
      }
    });
    if (!grew) break;
  }
  return { aliases, aliasLines };
}

function calledMethods(files, sources, aliases) {
  const names = new Set();
  const direct = new RegExp(`window\\s*\\.\\s*${bridge}\\s*\\??\\.\\s*(${IDENT})`, 'g');
  for (const file of files) {
    const text = sources.get(file);
    for (const match of text.matchAll(direct)) names.add(match[1]);
    for (const alias of aliases) {
      const viaAlias = new RegExp(`\\b${alias}\\s*\\??\\.\\s*(${IDENT})`, 'g');
      for (const match of text.matchAll(viaAlias)) names.add(match[1]);
    }
  }
  return names;
}

const files = walk(srcDir);
const sources = new Map(files.map((file) => [file, stripNonCode(readFileSync(file, 'utf8'))]));

const allText = [...sources.values()].join('\n');
const { aliases } = collectAliases(allText);
const exposed = exposedMethods(readFileSync(preloadPath, 'utf8'));
const called = calledMethods(files, sources, aliases);

const missing = [...called].filter((name) => !exposed.has(name)).sort();
const unused = [...exposed].filter((name) => !called.has(name)).sort();

console.log(`preload bridge: '${bridge}'  (${preloadPath})`);
console.log(`exposed: ${exposed.size}   called by renderer: ${called.size}`);
console.log(`aliases resolved: ${[...aliases].map((name) => `${bridge} -> ${name}`).join(', ') || '(none)'}`);

if (unused.length) {
  console.log(`\nNOTE  exposed but never called (${unused.length}): ${unused.join(', ')}`);
  console.log('      dead surface, not a crash — delete the bridge entry and its ipcMain handler together.');
}

if (missing.length) {
  console.log(`\nFAIL  called but NOT exposed (${missing.length}): ${missing.join(', ')}`);
  console.log('      these throw "<method> is not a function" at runtime in the packaged app.');
  process.exit(1);
}

console.log('\nOK    every bridge method the renderer calls is exposed.');
