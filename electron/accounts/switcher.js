import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { captureLiveCredentials, getRiotClientRoot, KEEP_ON_SWITCH, loadAccount, managedPaths, markLoginRejected, syncLiveLoginIntoSavedAccount } from './accountStore.js';
import { isAccountLive, refreshSwitchedAccount, waitForSignInOutcome } from './accountService.js';
import { accountEvents } from './events.js';
import { isGameRunning, launchGameWhenReady, launchRiotClient, runningGame, runningImages } from './riotClient.js';
import { planPlay, resolveGame } from './play.js';
import { backupsToPrune } from '../lib/housekeeping.js';

const exec = promisify(execFile);
// Everything that holds the Riot session files open or would relaunch the client: the games first
// (so they do not respawn a client), then League's own client, then Riot Client in all its names —
// newer builds run as "Riot Client.exe" next to RiotClientServices.exe.
const processes = [
  'VALORANT-Win64-Shipping.exe', 'VALORANT.exe',
  'League of Legends.exe', 'LeagueClientUxRender.exe', 'LeagueClientUx.exe', 'LeagueClient.exe', 'LeagueCrashHandler64.exe',
  'LoR.exe', 'LoR_Launcher.exe',
  'Riot Client.exe', 'RiotClientUxRender.exe', 'RiotClientUx.exe', 'RiotClientServices.exe', 'RiotClientCrashHandler.exe'
];
// taskkill's "no such process" exit code. Its MESSAGE is localised ("nicht gefunden" on German
// Windows), so the code is what decides — matching the English text made every switch fail there.
const TASKKILL_NOT_FOUND = 128;
const riotRoot = getRiotClientRoot();
let switchInProgress = false;

function backupDirectory() { return path.join(app.getPath('userData'), 'switch-backups'); }
function assertWithinRiotRoot(target) {
  const relative = path.relative(riotRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe Riot Client path refused.');
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const runningOf = (images) => processes.filter((name) => images.has(name.toLowerCase()));

// Closes only what is actually running (one language-neutral tasklist read instead of a taskkill per
// name), then waits until it is really gone: a process that is still exiting keeps the session files
// locked, and writing the next account's files into them is what used to fail half-way.
async function closeRiotProcesses() {
  const running = runningOf(await runningImages());
  for (const name of running) {
    try { await exec('taskkill', ['/F', '/T', '/IM', name], { windowsHide: true }); }
    catch (error) {
      // Already gone between the read and the kill (killing a parent with /T takes its children too).
      if (error?.code === TASKKILL_NOT_FOUND) continue;
      throw new Error(`Could not close ${name}: ${String(error.stderr || error.message).trim()}`, { cause: error });
    }
  }
  if (!running.length) return;
  for (let waited = 0; waited < 10_000; waited += 250) {
    if (!runningOf(await runningImages()).length) return;
    await sleep(250);
  }
  const left = runningOf(await runningImages());
  if (left.length) throw new Error(`Riot processes did not close: ${left.join(', ')}. Close them in Task Manager and try again.`);
}
// Empties a managed directory except the files that are not part of any login (KEEP_ON_SWITCH).
async function clearManaged(relativePath) {
  const target = path.join(riotRoot, relativePath);
  assertWithinRiotRoot(target);
  let entries;
  try { entries = await fs.readdir(target, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const logical = path.posix.join(relativePath, entry.name);
    if (KEEP_ON_SWITCH.has(logical)) continue;
    await fs.rm(path.join(target, entry.name), { recursive: true, force: true });
  }
}

async function writeBundle(credentials) {
  for (const relativePath of managedPaths) await clearManaged(relativePath);
  for (const file of credentials.files) {
    const target = path.join(riotRoot, file.path);
    assertWithinRiotRoot(target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.content, 'base64'));
  }
}
async function backupLiveCredentials(prefix = 'before-switch') {
  const backup = await captureLiveCredentials();
  await fs.mkdir(backupDirectory(), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable, so switching is disabled.');
  await fs.writeFile(path.join(backupDirectory(), `${prefix}-${Date.now()}.vam`), safeStorage.encryptString(JSON.stringify(backup)));
  await pruneBackups();
}

// A backup is written before EVERY switch and used to never be discarded: 27 files / 245 MB in three
// days. Deliberately best-effort — failing to clean up backups must not fail the switch,
// because that backup exists precisely to protect this operation, not the other way round.
async function pruneBackups() {
  try {
    const directory = backupDirectory();
    const entries = [];
    for (const name of await fs.readdir(directory)) {
      const info = await fs.stat(path.join(directory, name)).catch(() => null);
      if (info) entries.push({ name, mtimeMs: info.mtimeMs });
    }
    for (const name of backupsToPrune(entries)) await fs.rm(path.join(directory, name), { force: true }).catch(() => {});
  } catch { /* housekeeping is never fatal */ }
}
async function clearLiveSession() {
  await writeBundle({ version: 1, files: [] });
  const marker = path.join(riotRoot, 'VamAccountId.instance');
  assertWithinRiotRoot(marker);
  await fs.rm(marker, { force: true });
}

export async function openRiotSignIn() {
  if (switchInProgress) throw new Error('Another account switch is still in progress. Wait for it to finish before adding an account manually.');
  switchInProgress = true;
  try {
    try { await backupLiveCredentials('before-manual-sign-in'); }
    catch (error) { if (!/session data is missing/i.test(error.message)) throw error; }
    await closeRiotProcesses();
    // The account being signed out of keeps its newest (rotated) login — see syncLiveLoginIntoSavedAccount.
    await syncLiveLoginIntoSavedAccount().catch(() => null);
    await clearLiveSession();
    await launchRiotClient();
  } finally {
    switchInProgress = false;
  }
}

// Only performSwitch's post-launch refresh sets this, so a failure before the credentials are
// touched (loadAccount, backupLiveCredentials, writeBundle) stays a plain failure, never a move.
const hasMoved = (error) => error?.switchedAccountMoved === true;

// Shared body: the caller owns the re-entrancy flag so PLAY can switch without tripping the
// guard its own entry point sets.
//
// This function deliberately REJECTS when the post-launch refresh fails: PLAY's guarantee is that
// a switch waits for the new session to be readable, and swallowing the failure would let PLAY
// launch against a client possibly sitting at Riot's sign-in screen. switchToAccount converts that
// failure into a reported move; PLAY keeps the throw.
async function performSwitch(label, { launchAfterSignIn = null } = {}) {
  await loadAccount(label); // fail before touching anything when the account does not exist
  await backupLiveCredentials();
  await closeRiotProcesses();
  // Riot rotated the outgoing account's token while it was signed in; its saved copy is stale until
  // the live files are copied back. Without this, switching BACK to it is rejected (invalid_grant).
  await syncLiveLoginIntoSavedAccount().catch(() => null);
  // Loaded only now: when switching to the account that was just live, the sync above refreshed it.
  const account = await loadAccount(label);
  await writeBundle(account.credentials);
  await fs.writeFile(path.join(riotRoot, 'VamAccountId.instance'), account.id, 'utf8');
  await launchRiotClient();
  // Past this point the session HAS moved: credentials written, client relaunched. The marker is
  // what lets switchToAccount tell this failure from one before the client was touched.
  try {
    const outcome = await waitForSignInOutcome(riotRoot);
    if (outcome === 'login-required') {
      // Riot rejected the saved login (it expired, or was used up before this fix existed). The client
      // is at its sign-in screen; a sign-in there is picked up and saved, and PLAY's game launched.
      await markLoginRejected(account.label).catch(() => {});
      watchForManualSignIn(account.label, launchAfterSignIn);
      const error = new Error(`Riot rejected the saved login for “${account.label}”. Sign in to it once in the Riot Client (tick “Stay signed in”) — Vantage saves it automatically${launchAfterSignIn ? ' and starts the game' : ''}.`);
      error.loginRequired = true;
      throw error;
    }
    const refreshed = await refreshSwitchedAccount(account.label);
    return { label: account.label, store: refreshed.store };
  } catch (error) {
    error.switchedAccountMoved = true;
    throw error;
  }
}

// After a rejected login: wait (in the background, up to 10 minutes) for the user to sign in by hand,
// then save that sign-in as this account and, for PLAY, start the game. The IPC call has long returned
// by then, so the outcome travels as an event.
let manualSignInWatch = null;
function watchForManualSignIn(label, game) {
  const watch = { label, game };
  manualSignInWatch = watch;
  refreshSwitchedAccount(label, 10 * 60_000)
    .then(async () => {
      if (manualSignInWatch !== watch) return;
      accountEvents.emit('signed-in', { label, game });
      if (game) {
        try { await launchGameWhenReady(game); accountEvents.emit('launched', { label, game }); }
        catch (error) { accountEvents.emit('launch-failed', { label, game, error: error.message }); }
      }
    })
    .catch((error) => { if (manualSignInWatch === watch) accountEvents.emit('sign-in-failed', { label, error: error.message }); })
    .finally(() => { if (manualSignInWatch === watch) manualSignInWatch = null; });
}

export async function switchToAccount(label) {
  if (switchInProgress) throw new Error('Another account switch is still in progress. Wait for it to finish before switching again.');
  switchInProgress = true;
  try {
    // The success shape carries `moved` too: the renderer gates the page retarget on it, so a
    // plain `{label, store}` would stop the page following the most common case — a switch that
    // works. `refreshError` is on both paths so the renderer never has to tell absent from null.
    const result = await performSwitch(label);
    return { ...result, moved: true, refreshError: null };
  } catch (error) {
    // Everything before the refresh IS the switch: credentials written, client relaunched. The
    // refresh can still legitimately fail (a slow sign-in runs past waitForCurrentAccount's 60s
    // window; a just-rotated session can be rejected), and reporting that as a failed switch left
    // the renderer on the PREVIOUS account's page while the session had moved. `moved` is what it
    // retargets on; `refreshError` warns on top; a failure BEFORE the relaunch still rejects.
    if (!hasMoved(error)) throw error;
    return {
      label, store: null, moved: true, loginRequired: Boolean(error.loginRequired),
      refreshError: error.message || 'The account moved, but its store could not be read yet.'
    };
  } finally {
    switchInProgress = false;
  }
}

// PLAY: get this account into the game, in one press. If it is already signed in it just asks
// Riot Client to start the game; otherwise it switches first, and the switch waits for the new
// session to be readable before returning, so the launch is asked for as an account the client
// is actually signed in as. This replaced a launch-only rule that refused every other row: the
// answer to "a client that is not signed in accepts a launch and drops it" is to switch, not to
// refuse — a manager exists to hold the accounts you are not currently in, so a control that
// only works on the account already open is almost always off.
export async function playAccount(label, gameId = 'valorant') {
  if (switchInProgress) throw new Error('Another account operation is still in progress. Wait for it to finish before launching.');
  switchInProgress = true;
  const game = resolveGame(gameId);
  try {
    const account = await loadAccount(label);
    const isActive = await isAccountLive(account);
    // Signed in: only the chosen game matters (Valorant open does not stop a League launch).
    // Not signed in: a switch kills every Riot process, so ANY open game is a reason to refuse.
    const gameRunning = isActive ? await isGameRunning(game.id) : Boolean(await runningGame());
    const decision = planPlay({ isActive, valorantRunning: gameRunning });
    if (decision === 'already-running') {
      return { label: account.label, game: game.id, launched: false, switched: false, reason: 'already-running' };
    }
    if (decision === 'close-game-first') {
      // Reported, not acted on: the switch would close the game open under the account signed in
      // now, and that is the user's call to make, not a mis-click's.
      return { label: account.label, game: game.id, launched: false, switched: false, reason: 'close-game-first' };
    }
    const switched = decision === 'switch-then-launch';
    if (switched) {
      try { await performSwitch(account.label, { launchAfterSignIn: game.id }); }
      catch (error) {
        // The client is at its sign-in screen; the background watch starts the game after sign-in.
        if (error.loginRequired) return { label: account.label, game: game.id, launched: false, switched: true, reason: 'login-required', message: error.message };
        throw error;
      }
    }
    // Reports success only once the game process is up: the client acknowledging a request is not
    // a game starting, and conflating the two made an earlier build report a launch that never happened.
    try { await launchGameWhenReady(game.id); }
    catch (error) {
      if (error.reason === 'needs-update') return { label: account.label, game: game.id, launched: false, switched, reason: 'needs-update', message: error.message };
      throw error;
    }
    return { label: account.label, game: game.id, launched: true, switched, reason: null };
  } finally {
    switchInProgress = false;
  }
}
