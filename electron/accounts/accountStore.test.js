import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyError } from '../lib/errorKind.js';

// accountStore imports electron's app/safeStorage, so the module is exercised against a real
// throwaway directory with both of them stubbed. state is hoisted because vi.mock's factory runs
// before the file body.
const state = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, '')
  }
}));

const CREDENTIALS = { version: 1, files: [{ path: 'Data/foo', contents: 'AAAA' }] };

let dir;
let store;

// The stale-temp sweep runs once per process, so every test needs a fresh module graph rather
// than a shared one.
async function loadStore() {
  vi.resetModules();
  return import('./accountStore.js');
}

function accountsDir() { return path.join(dir, 'accounts'); }
function tempFiles() { return readdirSync(accountsDir()).filter((name) => name.endsWith('.tmp')); }

function renameRefusal(code = 'EPERM') {
  const error = new Error(`${code}: operation not permitted, rename`);
  error.code = code;
  return error;
}

function seedTempFile(name, ageMs) {
  mkdirSync(accountsDir(), { recursive: true });
  const file = path.join(accountsDir(), name);
  writeFileSync(file, 'stale');
  const stamp = new Date(Date.now() - ageMs);
  utimesSync(file, stamp, stamp);
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sapphire-store-'));
  state.userData = dir;
});

afterEach(() => {
  vi.restoreAllMocks();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('writeEncrypted rename handling', () => {
  it('retries a transient rename refusal and saves successfully', async () => {
    store = await loadStore();
    const realRename = fs.rename.bind(fs);
    let attempts = 0;
    let refusals = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      attempts += 1;
      // Refuse once, the way Windows does while a scanner holds a handle.
      if (refusals === 0) { refusals += 1; throw renameRefusal(); }
      return realRename(from, to);
    });

    await store.saveAccount('main', CREDENTIALS, { accountName: 'main#1' });

    // saveAccount writes the account blob and then the index, so it performs two renames; the
    // refused one was retried and the save still completed.
    expect(refusals).toBe(1);
    expect(attempts).toBe(3);
    expect(tempFiles()).toEqual([]);
    const saved = await store.loadAccount('main');
    expect(saved.credentials).toEqual(CREDENTIALS);
    expect(saved.accountName).toBe('main#1');
  });

  it('gives up after the retry budget and leaves no temp file behind', async () => {
    store = await loadStore();
    let attempts = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async () => { attempts += 1; throw renameRefusal(); });

    let failure = null;
    try { await store.saveAccount('main', CREDENTIALS); } catch (error) { failure = error; }

    // 1 initial attempt + 3 retries.
    expect(attempts).toBe(4);
    expect(failure).not.toBeNull();
    expect(tempFiles()).toEqual([]);
    expect(existsSync(path.join(accountsDir(), 'index.vam'))).toBe(false);
  });

  it('keeps a refused write classifiable as a file-system error for the UI', async () => {
    store = await loadStore();
    vi.spyOn(fs, 'rename').mockImplementation(async () => { throw renameRefusal(); });

    let failure = null;
    try { await store.saveAccount('main', CREDENTIALS); } catch (error) { failure = error; }

    expect(failure.message).toMatch(/EPERM/);
    expect(classifyError(failure.message)).toBe('fs-error');
    expect(failure.cause?.code).toBe('EPERM');
  });

  it('does not retry a failure that is not a transient lock', async () => {
    store = await loadStore();
    let attempts = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async () => { attempts += 1; throw renameRefusal('ENOSPC'); });

    await expect(store.saveAccount('main', CREDENTIALS)).rejects.toThrow(/ENOSPC/);
    expect(attempts).toBe(1);
  });
});

describe('stale temp file sweep', () => {
  it('removes a temp file left by an earlier crash', async () => {
    store = await loadStore();
    const stale = seedTempFile('index.vam.crashed-run.tmp', 60 * 60 * 1000);

    await store.saveAccount('main', CREDENTIALS);

    expect(existsSync(stale)).toBe(false);
    expect(tempFiles()).toEqual([]);
  });

  it('leaves a temp file young enough to belong to a write still in flight', async () => {
    store = await loadStore();
    const fresh = seedTempFile('index.vam.in-flight.tmp', 0);

    await store.saveAccount('main', CREDENTIALS);

    expect(existsSync(fresh)).toBe(true);
  });

  it('runs once, so a file seeded after the first write survives', async () => {
    store = await loadStore();
    await store.saveAccount('main', CREDENTIALS);
    const later = seedTempFile('index.vam.after-first-write.tmp', 60 * 60 * 1000);

    await store.saveAccount('second', CREDENTIALS);

    expect(existsSync(later)).toBe(true);
  });
});

describe('renameAccount', () => {
  it('retries the same way and moves the index entry with the blob', async () => {
    store = await loadStore();
    await store.saveAccount('main', CREDENTIALS, { accountName: 'main#1' });

    const realRename = fs.rename.bind(fs);
    let attempts = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      attempts += 1;
      if (attempts === 1) throw renameRefusal();
      return realRename(from, to);
    });

    await store.renameAccount('main', 'smurf');

    expect(attempts).toBeGreaterThan(1);
    expect((await store.listAccounts()).map((account) => account.label)).toEqual(['smurf']);
    expect((await store.loadAccount('smurf')).credentials).toEqual(CREDENTIALS);
  });
});

describe('loginPuuid', () => {
  // Shape of a real Riot Client 2026 private-settings file (values invented).
  const jwt = (payload) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;
  const bundle = (yaml) => ({ version: 1, files: [{ path: 'Data/RiotGamesPrivateSettings.yaml', content: Buffer.from(yaml).toString('base64') }] });
  const signedIn = (puuid) => bundle([
    'psl:',
    '    authorization:',
    '        riot-client:',
    `            id_token: "${jwt({ sub: puuid })}"`,
    '            is_dpop_bound: false',
    '            refresh_token: "eyJraWQiOiJzMSIsImFsZyI6IkVTMjU2In0.refresh.token"',
    'rso-authenticator:',
    '    tdid:',
    '        name: "tdid"'
  ].join('\n'));

  it('reads the PUUID of a persisted login from its id_token', async () => {
    store = await loadStore();
    expect(store.loginPuuid(signedIn('puuid-123'))).toBe('puuid-123');
  });

  it('returns null once the client cleared the login after a rejected token', async () => {
    store = await loadStore();
    expect(store.loginPuuid(bundle('psl:\n    authorization:\n        riot-client: null\n'))).toBeNull();
    expect(store.loginPuuid({ version: 1, files: [] })).toBeNull();
  });
});
