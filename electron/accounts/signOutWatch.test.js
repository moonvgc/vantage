import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', live: null, accounts: [] }));

vi.mock('./accountStore.js', () => ({
  getRiotClientRoot: () => state.root,
  listAccounts: vi.fn(async () => state.accounts),
  markLoginRejected: vi.fn(async () => {}),
  syncLiveLoginIntoSavedAccount: vi.fn(async () => null)
}));
vi.mock('../riot/auth.js', () => ({
  getSessionTokens: vi.fn(async () => {
    if (!state.live) throw new Error('not signed in');
    return { puuid: state.live };
  })
}));

const logDir = () => path.join(state.root, 'Logs', 'Riot Client Logs');
const logFile = () => path.join(logDir(), '2026-10-22T12-25-23_2248_Riot Client.log');

async function load() {
  vi.resetModules();
  const store = await import('./accountStore.js');
  const { accountEvents } = await import('./events.js');
  const watch = await import('./signOutWatch.js');
  return { store, accountEvents, watch };
}

beforeEach(() => {
  state.root = mkdtempSync(path.join(tmpdir(), 'signout-'));
  mkdirSync(logDir(), { recursive: true });
  mkdirSync(path.join(state.root, 'Data'), { recursive: true });
  writeFileSync(logFile(), '000001.000|   OKAY| boot\n');
  writeFileSync(path.join(state.root, 'Data', 'RiotGamesPrivateSettings.yaml'), 'psl:\n');
  state.live = 'puuid-a';
  state.accounts = [{ label: 'main', puuid: 'puuid-a', login: { state: 'ok' } }];
});

describe('countSignOuts', () => {
  it('counts the Riot Client sign-out marker', async () => {
    const { watch } = await load();
    expect(watch.countSignOuts('x\n000044.146|   OKAY| SDK: chat: chat: Commencing XMPP Logout sequence, reason code: RSO_AUTH_DELETE\n')).toBe(1);
    expect(watch.countSignOuts('reason code: FINALIZE')).toBe(0);
  });
});

describe('createSignOutWatch', () => {
  it('marks the account that was signed in when the client signs out', async () => {
    const { store, accountEvents, watch } = await load();
    const events = [];
    accountEvents.on('signed-out', (payload) => events.push(payload));
    const watcher = watch.createSignOutWatch();

    await watcher.tick(); // learns who is signed in; history before this is ignored
    state.live = null;
    appendFileSync(logFile(), '000044.146|   OKAY| SDK: chat: Commencing XMPP Logout sequence, reason code: RSO_AUTH_DELETE\n');
    await watcher.tick();

    expect(store.markLoginRejected).toHaveBeenCalledWith('main');
    expect(events).toEqual([{ label: 'main' }]);
  });

  it('does not replay sign-outs that were already in the log before it started', async () => {
    appendFileSync(logFile(), 'reason code: RSO_AUTH_DELETE\n');
    const { store, watch } = await load();
    const watcher = watch.createSignOutWatch();

    await watcher.tick();
    await watcher.tick();

    expect(store.markLoginRejected).not.toHaveBeenCalled();
  });

  it('a switch by the app (client killed, no sign-out line) marks nothing', async () => {
    const { store, watch } = await load();
    const watcher = watch.createSignOutWatch();
    await watcher.tick();
    state.live = null;
    appendFileSync(logFile(), 'chat: Commencing XMPP Logout sequence, reason code: FINALIZE\n');
    await watcher.tick();

    expect(store.markLoginRejected).not.toHaveBeenCalled();
  });

  it('saves a changed live login into its account', async () => {
    const { store, watch } = await load();
    const watcher = watch.createSignOutWatch();
    await watcher.tick();
    expect(store.syncLiveLoginIntoSavedAccount).toHaveBeenCalledTimes(1);
    await watcher.tick(); // file unchanged, but the first sync reported no label, so it is retried
    writeFileSync(path.join(state.root, 'Data', 'RiotGamesPrivateSettings.yaml'), 'psl:\n  rotated\n');
    await watcher.tick();
    expect(store.syncLiveLoginIntoSavedAccount).toHaveBeenCalledTimes(3);
  });
});
