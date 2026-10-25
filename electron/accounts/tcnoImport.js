import { promises as fs } from 'node:fs';
import path from 'node:path';
import { saveAccount } from './accountStore.js';

const tcnoRoot = path.join(process.env.APPDATA ?? '', 'TcNo Account Switcher', 'LoginCache', 'Riot Games');
const recognised = new Set(['Cookies', 'Sessions', 'RiotClientPrivateSettings.yaml', 'RiotClientSettings.yaml']);

async function exists(target) { try { await fs.access(target); return true; } catch { return false; } }
async function walk(root, relative = '') {
  const files = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target, next));
    else if (entry.isFile()) files.push({ physical: target, relative: next });
  }
  return files;
}
function labelFor(id, ids) {
  const record = Array.isArray(ids) ? ids.find((entry) => entry.id === id || entry.accountId === id) : ids?.[id];
  if (typeof record === 'string') return record;
  return record?.label ?? record?.name ?? record?.accountName ?? id;
}
function logicalPath(relative) {
  const segments = relative.split(/[\\/]/);
  if (segments[0] === 'RiotClientPrivateSettings.yaml') return path.posix.join('Data', ...segments.slice(1));
  if (segments[0] === 'RiotClientSettings.yaml') return path.posix.join('Config', ...segments.slice(1));
  const match = segments.findIndex((segment) => recognised.has(segment));
  if (match < 0) return null;
  const item = segments.slice(match);
  if (item[0] === 'RiotClientPrivateSettings.yaml') return path.posix.join('Data', ...item.slice(1));
  if (item[0] === 'RiotClientSettings.yaml') return path.posix.join('Config', ...item.slice(1));
  return path.posix.join('Data', ...item);
}

export async function findTcnoAccounts() {
  if (!await exists(tcnoRoot)) return { available: false, accounts: [] };
  let ids = {};
  try { ids = JSON.parse(await fs.readFile(path.join(tcnoRoot, 'ids.json'), 'utf8')); } catch { /* labels fall back to IDs */ }
  const entries = await fs.readdir(tcnoRoot, { withFileTypes: true });
  return {
    available: true,
    accounts: entries.filter((entry) => entry.isDirectory()).map((entry) => ({ id: entry.name, label: labelFor(entry.name, ids) }))
  };
}

export async function importTcnoAccounts(ids) {
  const detected = await findTcnoAccounts();
  const chosen = new Set(ids ?? detected.accounts.map((account) => account.id));
  const imported = [];
  for (const account of detected.accounts.filter((account) => chosen.has(account.id))) {
    const files = [];
    for (const file of await walk(path.join(tcnoRoot, account.id))) {
      const logical = logicalPath(file.relative);
      if (logical && !logical.endsWith('/lockfile')) files.push({ path: logical, content: (await fs.readFile(file.physical)).toString('base64') });
    }
    if (!files.length) continue;
    await saveAccount(account.label, { version: 1, files });
    imported.push(account.label);
  }
  return imported;
}
