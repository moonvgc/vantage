// Dead-CSS audit: lists class selectors defined in src/styles.css that no source
// file references.
//
// Every string literal / template fragment under src/ is the haystack (dynamic
// names like `acct${sel ? ' sel' : ''}` are the norm), and a class counts as used
// if its name appears there even loosely — false "used" is safe, false "dead"
// would delete live styling. Output is grouped by file section and must be
// reviewed by hand before anything is deleted.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

// ---- collect class selectors from the stylesheet ----
// Strip comments first so class-looking text inside them is not counted.
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = new Map(); // class -> [line numbers]
withoutComments.split('\n').forEach((line, index) => {
  const lineNumber = index + 1;
  const selectorPart = line.split('{')[0];
  if (!selectorPart) return;
  for (const match of selectorPart.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    const name = match[1];
    if (!selectors.has(name)) selectors.set(name, []);
    selectors.get(name).push(lineNumber);
  }
});

// ---- haystack: every string literal / template fragment under src/ ----
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(entry) ? [full] : [];
  });
}

const sourceFiles = walk(path.join(root, 'src'));
const haystack = sourceFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

const dead = [];
for (const [name, lines] of selectors) {
  // Word-boundary-ish: the class name must appear as a standalone token.
  const pattern = new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}([^\\w-]|$)`);
  if (!pattern.test(haystack)) dead.push({ name, lines });
}

console.log(`classes defined in styles.css: ${selectors.size}`);
console.log(`source files scanned: ${sourceFiles.length}`);
console.log(`\nNOT referenced anywhere in src/ (${dead.length}):`);
for (const { name, lines } of dead.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  .${name}  (line${lines.length > 1 ? 's' : ''} ${lines[0]}${lines.length > 1 ? `, +${lines.length - 1}` : ''})`);
}
