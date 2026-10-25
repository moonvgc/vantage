import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRiotClientRoot, listAccounts, markLoginRejected, syncLiveLoginIntoSavedAccount } from './accountStore.js';
import { getSessionTokens } from '../riot/auth.js';
import { accountEvents } from './events.js';

// Watches the running Riot Client for the two things that decide whether a saved login keeps working:
//
// 1. A SIGN-OUT inside the Riot Client. Riot then deletes the "stay signed in" session on its server
//    (the client logs "reason code: RSO_AUTH_DELETE"), so the copy this app saved is dead from that
//    second on — measured: a login saved at 12:26:23 was rejected after a sign-out at 12:26:35. The
//    account that was signed in just before is marked expired and the user is told why.
// 2. A new or renewed login (the user signed in in the client, or Riot rotated the token): copied into
//    the matching saved account straight away, which also revives an account marked expired.

const LOG_DIR = () => path.join(getRiotClientRoot(), 'Logs', 'Riot Client Logs');
const SETTINGS_FILE = () => path.join(getRiotClientRoot(), 'Data', 'RiotGamesPrivateSettings.yaml');

export function countSignOuts(text) {
  return (String(text).match(/reason code: RSO_AUTH_DELETE/g) ?? []).length;
}

async function newestLog() {
  try {
    const names = (await fs.readdir(LOG_DIR())).filter((name) => name.endsWith('.log'));
    let best = null;
    for (const name of names) {
      const file = path.join(LOG_DIR(), name);
      const info = await fs.stat(file).catch(() => null);
      if (info && (!best || info.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: info.mtimeMs, size: info.size };
    }
    return best;
  } catch { return null; }
}

async function readFrom(file, offset, end) {
  if (end <= offset) return '';
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(end - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}

export function createSignOutWatch() {
  let lastLivePuuid = null;
  let log = null; // { file, offset }
  let lastSettingsHash = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      let livePuuid = null;
      try { livePuuid = (await getSessionTokens()).puuid ?? null; } catch { /* client closed or at sign-in */ }

      // New log lines since the last tick. The first look starts at the END of the current file so old
      // history is not replayed; a newer file (client restarted) is read from its start.
      const newest = await newestLog();
      let fresh = '';
      if (newest) {
        if (!log) log = { file: newest.file, offset: newest.size };
        else if (newest.file !== log.file) log = { file: newest.file, offset: 0 };
        if (newest.size < log.offset) log.offset = 0;
        fresh = await readFrom(log.file, log.offset, newest.size).catch(() => '');
        log.offset = newest.size;
      }

      if (countSignOuts(fresh) > 0 && lastLivePuuid) {
        const account = (await listAccounts()).find((entry) => entry.puuid === lastLivePuuid);
        if (account) {
          await markLoginRejected(account.label).catch(() => {});
          accountEvents.emit('signed-out', { label: account.label });
        }
        lastLivePuuid = null;
      }

      if (livePuuid) {
        lastLivePuuid = livePuuid;
        // Only when the login file actually changed: a rotation or a new sign-in.
        const text = await fs.readFile(SETTINGS_FILE(), 'utf8').catch(() => '');
        const hash = createHash('sha256').update(text).digest('hex');
        if (text && hash !== lastSettingsHash) {
          const before = (await listAccounts()).find((entry) => entry.puuid === livePuuid)?.login?.state;
          const label = await syncLiveLoginIntoSavedAccount().catch(() => null);
          if (label) {
            lastSettingsHash = hash;
            // Only worth telling the window when it changes what it shows (an expired account revived).
            if (before !== 'ok') accountEvents.emit('login-saved', { label });
          }
        }
      }
    } finally {
      busy = false;
    }
  }

  return { tick };
}

export function startSignOutWatch(intervalMs = 8_000) {
  const watch = createSignOutWatch();
  watch.tick().catch(() => {});
  const timer = setInterval(() => { watch.tick().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
